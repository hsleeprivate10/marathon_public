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
import { detailFixtureName, safeKorMarathonDetailUrl } from "./detail-source-url.js";
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

const BASE_URL = "https://www.kormarathon.com";
const SOURCE_HOSTS = ["kormarathon.com"] as const;
const EMPTY_COUNTERS: AdapterStageCounters = {
  discoveryCandidates: 0,
  sourceDetailsFetched: 0,
  discoveredOfficialCandidates: 0,
  rejectedCandidates: 0,
  budgetSkipped: 0,
};

function discoverDetailLinks(
  race: Race,
  detailHtml: string,
  sourcePageUrl: string,
): readonly DiscoveredRaceLink[] {
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

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly detailUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse race entries from KorMarathon SSR HTML. */
function parseKorMarathonHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  // Try to find JSON-LD structured data
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch = jsonLdPattern.exec(html);
  while (ldMatch !== null) {
    let rawData: unknown = null;
    try {
      rawData = JSON.parse(ldMatch[1] ?? "");
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (isRecord(rawData)) {
      const data = rawData;
      if (data["@type"] === "Event" || data.name) {
        const name = typeof data.name === "string" ? data.name : "";
        if (name && name.length > 2) {
          const startDate = typeof data.startDate === "string" ? data.startDate : "";
          const eventDate = normalizeDate(startDate);
          if (eventDate !== null) {
            races.push({
              name,
              eventDate,
              detailUrl:
                typeof data.identifier === "string"
                  ? safeKorMarathonDetailUrl(`/ko/race/${data.identifier}`)
                  : null,
            });
          }
        }
      }
    }
    ldMatch = jsonLdPattern.exec(html);
  }

  // Fallback: parse Next.js RSC data chunks for race info
  const rscPattern = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let rscMatch = rscPattern.exec(html);
  while (rscMatch !== null) {
    const decoded = (rscMatch[1] ?? "")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    const nameMatch = decoded.match(/"name":"([^"]{4,80})"/);
    const dateMatch = decoded.match(/"date":"(\d{4}-\d{2}-\d{2})"/);
    const idMatch = decoded.match(/"id":"([^"]+)"/);

    if (nameMatch?.[1] && dateMatch?.[1]) {
      races.push({
        name: nameMatch[1],
        eventDate: dateMatch[1],
        detailUrl:
          idMatch?.[1] === undefined ? null : safeKorMarathonDetailUrl(`/ko/race/${idMatch[1]}`),
      });
    }
    rscMatch = rscPattern.exec(html);
  }

  // Final fallback: parse HTML table/card structure
  const cardPattern = /<div[^>]*class="[^"]*race[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let cardMatch = cardPattern.exec(html);
  while (cardMatch !== null) {
    const inner = cardMatch[1] ?? "";
    const nameTag = inner.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
    const dateTag = inner.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (nameTag?.[1] && dateTag) {
      races.push({
        name: nameTag[1].trim(),
        eventDate: `${dateTag[1]}-${dateTag[2]?.padStart(2, "0")}-${dateTag[3]?.padStart(2, "0")}`,
        detailUrl: null,
      });
    }
    cardMatch = cardPattern.exec(html);
  }

  return races;
}

function candidateFromParsedRace(
  parsed: ParsedRace,
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

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = raw.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (m2) return `${m2[1]}-${(m2[2] ?? "").padStart(2, "0")}-${(m2[3] ?? "").padStart(2, "0")}`;
  return null;
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
      const discoveredOfficialCandidates: DiscoveredRaceLink[] = [];
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
          `Discovered ${discoveryCandidates.length} KorMarathon source-detail candidates; fetched ${sourceDetailsFetched}; official candidates ${discoveredOfficialCandidates.length}; rejected ${rejectedCandidates}; budget skipped ${budgetSkipped}`,
        ),
        stageCounters: counters,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        discoveryCandidates: [],
        discoveredOfficialCandidates: [],
        metadata: failedMetadata(id, true, `KorMarathon failed: ${message}`),
        stageCounters: EMPTY_COUNTERS,
      };
    }
  },
};
