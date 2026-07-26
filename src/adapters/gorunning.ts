import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import {
  KNOWN_AGGREGATOR_HOSTS,
  isGenericHomepageUrl,
} from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeGoRunningDetailUrl } from "./detail-source-url.js";
import type { GoRunningListItem } from "./gorunning-list.js";
import { parseGoRunningList } from "./gorunning-list.js";
import {
  type AdapterResult,
  type AdapterStageCounters,
  type CollectConfig,
  type DiscoveredRaceLink,
  INTER_FETCH_DELAY_MS,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  sleep,
  sourceDetailUrl,
  sourceId,
  sourceResultUrl,
  successMetadata,
  transientIdentityHint,
} from "./types.js";

// ---------------------------------------------------------------------------
// HTML parsing helpers (simple regex-based, no DOM dependency)
// ---------------------------------------------------------------------------

const DETAIL_BUDGET = 200;
const EMPTY_COUNTERS: AdapterStageCounters = {
  discoveryCandidates: 0,
  sourceDetailsFetched: 0,
  discoveredOfficialCandidates: 0,
  rejectedCandidates: 0,
  budgetSkipped: 0,
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const BASE_URL = "https://gorunning.kr";
const SOURCE_HOSTS = ["gorunning.kr", "gorunning.co.kr"] as const;
const AGGREGATOR_HOSTS = KNOWN_AGGREGATOR_HOSTS;

function withoutSelfSourceApplications(
  links: readonly DiscoveredRaceLink[],
): readonly DiscoveredRaceLink[] {
  return links.filter((link) => {
    if (link.kind !== "application") return true;
    if (isGenericHomepageUrl(link.url)) return false;
    const url = new URL(link.url);
    return !SOURCE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  });
}

function discoverDetailLinks(
  race: Race,
  detailHtml: string,
  sourcePageUrl: string,
): readonly DiscoveredRaceLink[] {
  return withoutSelfSourceApplications(
    discoverRaceLinks({
      race,
      sourceId: "gorunning",
      sourcePageUrl,
      sourceHosts: SOURCE_HOSTS,
      aggregatorHosts: AGGREGATOR_HOSTS,
      html: detailHtml,
      raceDetailContext: { present: true, sourceDetailUrl: sourcePageUrl },
    }),
  );
}

function candidateFromListItem(
  item: GoRunningListItem,
  detailUrl: string,
  listUrl: string,
): SourceDiscoveryCandidate {
  return {
    sourceId: sourceId("gorunning"),
    sourceResultUrl: sourceResultUrl(listUrl),
    sourceDetailUrl: sourceDetailUrl(detailUrl),
    identityEvidence: {
      titleHints: [transientIdentityHint(item.name)],
      dateHints: item.eventDate === "" ? [] : [transientIdentityHint(item.eventDate)],
      organizerHints: [],
    },
  };
}

function raceForDiscovery(candidate: SourceDiscoveryCandidate, now: string): Race {
  const name =
    candidate.identityEvidence.titleHints[0] ?? transientIdentityHint("source detail race");
  const eventDate = candidate.identityEvidence.dateHints[0] ?? transientIdentityHint("1900-01-01");
  return {
    name,
    eventDate,
    registrationDeadline: null,
    venue: "미상",
    courses: [],
    applicationUrl: candidate.sourceDetailUrl,
    sources: ["gorunning"],
    verified: false,
    lastVerified: null,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: computeRegistrationStatus(null, eventDate),
  };
}

export const GoRunningAdapter: SourceAdapter = {
  id: "gorunning",
  name: "GoRunning",
  baseUrl: BASE_URL,
  allowedPaths: ["/races/", "/races/monthly/", "/race/view.php"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let listHtml: string;
      if (config.fixtureDir) {
        listHtml = await readFixture(config.fixtureDir, "list.html");
      } else {
        listHtml = await fetchWithTimeout(`${BASE_URL}/races/`);
      }

      const listUrl = `${BASE_URL}/races/`;
      const items = parseGoRunningList(listHtml);
      const budget = config.detailBudget ?? DETAIL_BUDGET;
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const discoveredOfficialCandidates: DiscoveredRaceLink[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      const now = new Date().toISOString();

      for (const [index, item] of items.entries()) {
        const detailUrl = safeGoRunningDetailUrl(item.detailPath);
        if (detailUrl === null) {
          rejectedCandidates += 1;
          continue;
        }
        const candidate = candidateFromListItem(item, detailUrl, listUrl);
        discoveryCandidates.push(candidate);
        if (index >= budget) {
          budgetSkipped += 1;
          continue;
        }
        let detailHtml: string;
        try {
          detailHtml = config.fixtureDir
            ? await readFixture(config.fixtureDir, detailFixtureName(detailUrl, BASE_URL))
            : await fetchWithTimeout(detailUrl);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          rejectedCandidates += 1;
          continue;
        }
        sourceDetailsFetched += 1;
        const links = discoverDetailLinks(raceForDiscovery(candidate, now), detailHtml, detailUrl);
        if (links.length === 0) rejectedCandidates += 1;
        discoveredOfficialCandidates.push(...links);

        if (!config.fixtureDir) {
          await sleep(INTER_FETCH_DELAY_MS);
        }
      }

      const counters: AdapterStageCounters = {
        discoveryCandidates: discoveryCandidates.length,
        sourceDetailsFetched,
        discoveredOfficialCandidates: discoveredOfficialCandidates.length,
        rejectedCandidates,
        budgetSkipped,
      };

      return {
        discoveryCandidates,
        discoveredOfficialCandidates,
        metadata: successMetadata(
          id,
          discoveredOfficialCandidates.length,
          `Discovered ${discoveryCandidates.length} GoRunning source-detail candidates; fetched ${sourceDetailsFetched}; official candidates ${discoveredOfficialCandidates.length}; rejected ${rejectedCandidates}; budget skipped ${budgetSkipped}`,
        ),
        stageCounters: counters,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        discoveryCandidates: [],
        discoveredOfficialCandidates: [],
        metadata: failedMetadata(id, true, `GoRunning failed: ${message}`),
        stageCounters: EMPTY_COUNTERS,
      };
    }
  },
};
