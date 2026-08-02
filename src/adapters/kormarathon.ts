/**
 * KorMarathon adapter — enrichment source.
 *
 * KorMarathon (kormarathon.com) is a Next.js RSC app with race data.
 * Provides: name, date, venue, registration period/fees.
 * This adapter parses the SSR HTML for race entries and any RSC-embedded JSON.
 */
import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { KNOWN_AGGREGATOR_HOSTS } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName } from "./detail-source-url.js";
import { type ParsedKorMarathonRace, parseKorMarathonHtml } from "./kormarathon-parser.js";
import {
  type AdapterResult,
  type AdapterStageCounters,
  type CollectConfig,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  type TraversalSeed,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  sourceDetailUrl,
  sourceId,
  sourceResultUrl,
  successMetadata,
  transientIdentityHint,
} from "./types.js";

const BASE_URL = "https://www.kormarathon.com";
const SOURCE_HOSTS = ["kormarathon.com"] as const;
const EMPTY_COUNTERS: AdapterStageCounters = {
  discoveryCandidates: 0,
  sourceDetailsFetched: 0,
  traversalSeeds: 0,
  rejectedCandidates: 0,
  budgetSkipped: 0,
};

function discoverDetailLinks(
  race: Race,
  detailHtml: string,
  sourcePageUrl: string,
): readonly TraversalSeed[] {
  return discoverRaceLinks({
    race,
    sourceId: "kormarathon",
    sourcePageUrl,
    sourceHosts: SOURCE_HOSTS,
    aggregatorHosts: KNOWN_AGGREGATOR_HOSTS,
    html: detailHtml,
    raceDetailContext: { present: true, sourceDetailUrl: sourcePageUrl },
  });
}

function candidateFromParsedRace(
  parsed: ParsedKorMarathonRace,
  detailUrl: string,
  listUrl: string,
): SourceDiscoveryCandidate {
  return {
    sourceId: sourceId("kormarathon"),
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
    sources: ["kormarathon"],
    verified: false,
    lastVerified: null,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: computeRegistrationStatus(null, eventDate),
  };
}

export const KorMarathonAdapter: SourceAdapter = {
  id: "kormarathon",
  name: "KorMarathon",
  baseUrl: BASE_URL,
  allowedPaths: ["/ko/marathon-calendar", "/ko/races/", "/ko/race/"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let listHtml: string;
      if (config.fixtureDir) {
        listHtml = await readFixture(config.fixtureDir, "list.html");
      } else {
        listHtml = await fetchWithTimeout(`${BASE_URL}/ko/marathon-calendar`);
      }

      const listUrl = `${BASE_URL}/ko/marathon-calendar`;
      const parsed = parseKorMarathonHtml(listHtml);
      const now = new Date().toISOString();
      const seen = new Set<string>();
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const traversalSeeds: TraversalSeed[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      let remainingDetailBudget = config.detailBudget ?? 20;

      for (const p of parsed) {
        const key = `${p.name}|${p.eventDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
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
        traversalSeeds.push(...links);
      }

      const counters: AdapterStageCounters = {
        discoveryCandidates: discoveryCandidates.length,
        sourceDetailsFetched,
        traversalSeeds: traversalSeeds.length,
        rejectedCandidates,
        budgetSkipped,
      };

      return {
        discoveryCandidates,
        traversalSeeds,
        metadata: successMetadata(
          id,
          traversalSeeds.length,
          `Discovered ${discoveryCandidates.length} KorMarathon source-detail candidates; fetched ${sourceDetailsFetched}; traversal seeds ${traversalSeeds.length}; rejected ${rejectedCandidates}; budget skipped ${budgetSkipped}`,
        ),
        stageCounters: counters,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        discoveryCandidates: [],
        traversalSeeds: [],
        metadata: failedMetadata(id, true, `KorMarathon failed: ${message}`),
        stageCounters: EMPTY_COUNTERS,
      };
    }
  },
};
