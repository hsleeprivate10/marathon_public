/**
 * RunningMap adapter — supplementary source.
 *
 * RunningMap (runningmap.com) provides route/map data alongside race info.
 * Extracts race names and dates from public listings.
 */
import { type Race, computeRegistrationStatus } from "../contract.js";
import { KNOWN_AGGREGATOR_HOSTS } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeRunningMapDetailUrl } from "./detail-source-url.js";
import {
  type AdapterResult,
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

const BASE_URL = "https://runningmap.kr";
const SOURCE_HOSTS = ["runningmap.kr", "runningmap.com"] as const;
const AGGREGATOR_HOSTS = KNOWN_AGGREGATOR_HOSTS;
function ownedDetailUrl(rawHref: string): string | null {
  return safeRunningMapDetailUrl(rawHref);
}

function discoverDetailLinks(
  race: Race,
  detailHtml: string,
  detailUrl: string,
): readonly TraversalSeed[] {
  return discoverRaceLinks({
    race,
    sourceId: "runningmap",
    sourcePageUrl: detailUrl,
    sourceHosts: SOURCE_HOSTS,
    aggregatorHosts: AGGREGATOR_HOSTS,
    html: detailHtml,
    raceDetailContext: { present: true, sourceDetailUrl: detailUrl },
  }).filter((link) => {
    const hostname = new URL(link.url).hostname;
    return !SOURCE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  });
}

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function parseRunningMapHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch = jsonLdPattern.exec(html);
  while (jsonLdMatch !== null) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(jsonLdMatch[1] ?? "");
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (isRecord(parsed) && Array.isArray(parsed.itemListElement)) {
      for (const entry of parsed.itemListElement) {
        if (!isRecord(entry) || !isRecord(entry.item)) continue;
        const item = entry.item;
        const eventDate = parseIsoDate(item.startDate);
        const location = isRecord(item.location) ? item.location : undefined;
        const name = typeof item.name === "string" ? item.name.trim() : "";
        const venue = typeof location?.name === "string" ? location.name : "미상";
        const detailUrl = typeof entry.url === "string" ? ownedDetailUrl(entry.url) : null;
        if (name.length > 2 && eventDate !== null) {
          races.push({ name, eventDate, venue, detailUrl });
        }
      }
    }
    jsonLdMatch = jsonLdPattern.exec(html);
  }

  // RunningMap: event listings with route links
  const linkPattern = /<a[^>]*href="([^"]*(?:race|event|마라톤)[^"]*)"[^>]*>([^<]{3,80})<\/a>/gi;
  let match = linkPattern.exec(html);

  while (match !== null) {
    const href = match[1] ?? "";
    const text = (match[2] ?? "").trim();
    if (text.length >= 3) {
      const idx = match.index;
      const context = html.slice(Math.max(0, idx - 300), idx + 300);
      const dateMatch = context.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
      const venueMatch = context.match(/(?:장소|지역|위치)[^<]*?[:：]\s*([^<\n]{2,30})/i);

      if (dateMatch !== null) {
        races.push({
          name: text,
          eventDate: `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`,
          venue: venueMatch?.[1]?.trim() ?? "미상",
          detailUrl: ownedDetailUrl(href),
        });
      }
    }
    match = linkPattern.exec(html);
  }

  return races;
}

function identityEvidence(parsed: ParsedRace): SourceDiscoveryCandidate["identityEvidence"] {
  return {
    titleHints: [transientIdentityHint(parsed.name)],
    dateHints: [transientIdentityHint(parsed.eventDate)],
    organizerHints: [],
  };
}

function transientRace(parsed: ParsedRace, detailUrl: string, now: string, id: string): Race {
  return {
    name: parsed.name,
    eventDate: parsed.eventDate,
    registrationDeadline: null,
    venue: parsed.venue,
    courses: [],
    applicationUrl: detailUrl,
    sources: [id],
    verified: false,
    lastVerified: null,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: computeRegistrationStatus(null, parsed.eventDate),
  };
}

export const RunningMapAdapter: SourceAdapter = {
  id: "runningmap",
  name: "RunningMap",
  baseUrl: BASE_URL,
  allowedPaths: ["/list", "/race/"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let homeHtml: string;
      if (config.fixtureDir) {
        homeHtml = await readFixture(config.fixtureDir, "home.html");
      } else {
        homeHtml = await fetchWithTimeout(`${BASE_URL}/list`);
      }

      const parsed = parseRunningMapHtml(homeHtml);
      const now = new Date().toISOString();
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const traversalSeeds: TraversalSeed[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      let remainingDetailBudget = config.detailBudget ?? 20;

      for (const p of parsed) {
        if (p.detailUrl === null) {
          rejectedCandidates += 1;
          continue;
        }
        const evidence = identityEvidence(p);
        discoveryCandidates.push({
          sourceId: sourceId(id),
          sourceResultUrl: sourceResultUrl(`${BASE_URL}/list`),
          sourceDetailUrl: sourceDetailUrl(p.detailUrl),
          identityEvidence: evidence,
        });
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
          transientRace(p, p.detailUrl, now, id),
          detailHtml,
          p.detailUrl,
        );
        if (links.length === 0) rejectedCandidates += 1;
        traversalSeeds.push(...links);
      }

      return {
        discoveryCandidates,
        traversalSeeds,
        metadata: successMetadata(
          id,
          discoveryCandidates.length,
          discoveryCandidates.length > 0
            ? `Collected ${discoveryCandidates.length} RunningMap source-detail candidates`
            : "No safe RunningMap source-detail candidates found in homepage",
        ),
        stageCounters: {
          discoveryCandidates: discoveryCandidates.length,
          sourceDetailsFetched,
          traversalSeeds: traversalSeeds.length,
          rejectedCandidates,
          budgetSkipped,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        discoveryCandidates: [],
        traversalSeeds: [],
        metadata: failedMetadata(id, true, `RunningMap failed: ${message}`),
        stageCounters: {
          discoveryCandidates: 0,
          sourceDetailsFetched: 0,
          traversalSeeds: 0,
          rejectedCandidates: 0,
          budgetSkipped: 0,
        },
      };
    }
  },
};
