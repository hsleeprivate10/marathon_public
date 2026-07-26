/**
 * e-Marathon adapter — SSR source with body-text prices.
 *
 * e-Marathon (e-marathon.co.kr) is SSR but some prices are only in body text,
 * not structured fields. This adapter marks such prices as body-text sourced.
 */
import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { KNOWN_AGGREGATOR_HOSTS } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeEMarathonDetailUrl } from "./detail-source-url.js";
import {
  type AdapterResult,
  type AdapterStageCounters,
  type CollectConfig,
  type DiscoveredRaceLink,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  sourceDetailUrl,
  sourceId,
  sourceResultUrl,
  successMetadata,
  transientIdentityHint,
} from "./types.js";

const BASE_URL = "https://emarathon.or.kr";
const SOURCE_HOSTS = ["emarathon.or.kr", "e-marathon.co.kr"] as const;
const AGGREGATOR_HOSTS = KNOWN_AGGREGATOR_HOSTS;
const EMPTY_COUNTERS: AdapterStageCounters = {
  discoveryCandidates: 0,
  sourceDetailsFetched: 0,
  discoveredOfficialCandidates: 0,
  rejectedCandidates: 0,
  budgetSkipped: 0,
};
function ownedDetailUrl(rawHref: string): string | null {
  return safeEMarathonDetailUrl(rawHref);
}

function discoverDetailLinks(
  race: Race,
  detailHtml: string,
  sourcePageUrl: string,
): readonly DiscoveredRaceLink[] {
  return discoverRaceLinks({
    race,
    sourceId: "emarathon",
    sourcePageUrl,
    sourceHosts: SOURCE_HOSTS,
    aggregatorHosts: AGGREGATOR_HOSTS,
    html: detailHtml,
    raceDetailContext: { present: true, sourceDetailUrl: sourcePageUrl },
  });
}

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly detailUrl: string | null;
}

function parseEMarathonHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  // Pattern: table rows or list items with race info
  const rowPattern =
    /<(?:tr|li|div)[^>]*class="[^"]*(?:race|event|item|col-sm-12)[^"]*"[^>]*>([\s\S]*?)<\/(?:tr|li|div)>/gi;
  let rowMatch = rowPattern.exec(html);

  while (rowMatch !== null) {
    const inner = rowMatch[1] ?? "";
    const linkMatch = inner.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    const titleMatch = inner.match(
      /class=["']fz_gallery_title["'][^>]*>([\s\S]*?)<span[^>]*class=["']fz_gallery_content/i,
    );
    // Date
    const dateMatch =
      inner.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/) ??
      inner.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    const rawName = titleMatch?.[1] ?? linkMatch?.[2];
    if (rawName && dateMatch) {
      const detailUrl = linkMatch?.[1]
        ? ownedDetailUrl(linkMatch[1].replaceAll("&amp;", "&"))
        : null;
      const name = rawName
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(?:텍스트|파일첨부)\s*/, "")
        .replace(/^\[(?:full|half|10k|5k)\]\s*/i, "")
        .replace(/링크\s*$/, "");
      const eventDate = `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`;

      races.push({
        name,
        eventDate,
        detailUrl,
      });
    }
    rowMatch = rowPattern.exec(html);
  }

  return races;
}

function candidateFromParsedRace(
  parsed: ParsedRace,
  detailUrl: string,
  listUrl: string,
): SourceDiscoveryCandidate {
  return {
    sourceId: sourceId("emarathon"),
    sourceResultUrl: sourceResultUrl(listUrl),
    sourceDetailUrl: sourceDetailUrl(detailUrl),
    identityEvidence: {
      titleHints: [transientIdentityHint(parsed.name)],
      dateHints: [transientIdentityHint(parsed.eventDate)],
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
    sources: ["emarathon"],
    verified: false,
    lastVerified: null,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: computeRegistrationStatus(null, eventDate),
  };
}

export const EMarathonAdapter: SourceAdapter = {
  id: "emarathon",
  name: "e-Marathon",
  baseUrl: BASE_URL,
  allowedPaths: ["/bbs/board.php", "/race/view/"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let listHtml: string;
      if (config.fixtureDir) {
        listHtml = await readFixture(config.fixtureDir, "list.html");
      } else {
        listHtml = await fetchWithTimeout(
          `${BASE_URL}/bbs/board.php?bo_table=emara04_01&add=${new Date().getFullYear()}`,
        );
      }

      const listUrl = `${BASE_URL}/bbs/board.php?bo_table=emara04_01&add=${new Date().getFullYear()}`;
      const parsed = parseEMarathonHtml(listHtml);
      const now = new Date().toISOString();
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const discoveredOfficialCandidates: DiscoveredRaceLink[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      let remainingDetailBudget = config.detailBudget ?? 20;

      for (const p of parsed) {
        if (p.detailUrl === null) {
          rejectedCandidates += 1;
          continue;
        }
        const candidate = candidateFromParsedRace(p, p.detailUrl, listUrl);
        discoveryCandidates.push(candidate);
        if (remainingDetailBudget <= 0) {
          budgetSkipped += 1;
          continue;
        }
        remainingDetailBudget -= 1;
        let detailHtml: string;
        try {
          detailHtml = config.fixtureDir
            ? await readFixture(config.fixtureDir, detailFixtureName(p.detailUrl, BASE_URL))
            : await fetchWithTimeout(p.detailUrl);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          rejectedCandidates += 1;
          continue;
        }
        sourceDetailsFetched += 1;
        const links = discoverDetailLinks(
          raceForDiscovery(candidate, now),
          detailHtml,
          p.detailUrl,
        );
        if (links.length === 0) rejectedCandidates += 1;
        discoveredOfficialCandidates.push(...links);
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
          `Discovered ${discoveryCandidates.length} e-Marathon source-detail candidates; fetched ${sourceDetailsFetched}; official candidates ${discoveredOfficialCandidates.length}; rejected ${rejectedCandidates}; budget skipped ${budgetSkipped}`,
        ),
        stageCounters: counters,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        discoveryCandidates: [],
        discoveredOfficialCandidates: [],
        metadata: failedMetadata(id, true, `e-Marathon failed: ${message}`),
        stageCounters: EMPTY_COUNTERS,
      };
    }
  },
};
