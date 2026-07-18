/**
 * RunningMap adapter — supplementary source.
 *
 * RunningMap (runningmap.com) provides route/map data alongside race info.
 * Extracts race names and dates from public listings.
 */
import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeRunningMapDetailUrl } from "./detail-source-url.js";
import {
  type AdapterResult,
  type CollectConfig,
  type DiscoveredRaceLink,
  type SourceAdapter,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  successMetadata,
} from "./types.js";

const BASE_URL = "https://runningmap.kr";
const KNOWN_SOURCE_HOSTS = [
  "gorunning.kr",
  "www.gorunning.kr",
  "gorunning.co.kr",
  "www.gorunning.co.kr",
  "kormarathon.com",
  "www.kormarathon.com",
  "emarathon.or.kr",
  "www.emarathon.or.kr",
  "e-marathon.co.kr",
  "www.e-marathon.co.kr",
  "runningmap.kr",
  "www.runningmap.kr",
  "runningmap.com",
  "www.runningmap.com",
  "maedal.com",
  "www.maedal.com",
  "m.kaaf.or.kr",
  "kaaf.or.kr",
  "www.kaaf.or.kr",
  "marathon.me.kr",
  "www.marathon.me.kr",
  "marathonmoa.com",
  "www.marathonmoa.com",
  "marathonmate.store",
  "www.marathonmate.store",
] as const;
const SOURCE_HOSTS = KNOWN_SOURCE_HOSTS;
const AGGREGATOR_HOSTS = KNOWN_SOURCE_HOSTS;
function ownedDetailUrl(rawHref: string): string | null {
  return safeRunningMapDetailUrl(rawHref);
}

function discoverDetailLinks(
  race: Race,
  detailHtml: string,
  sourcePageUrl: string,
): readonly DiscoveredRaceLink[] {
  return discoverRaceLinks({
    race,
    sourceId: "runningmap",
    sourcePageUrl,
    sourceHosts: SOURCE_HOSTS,
    aggregatorHosts: AGGREGATOR_HOSTS,
    html: detailHtml,
    raceDetailContext: { present: true },
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
      const races: Race[] = [];
      const discoveredLinks: DiscoveredRaceLink[] = [];
      let remainingDetailBudget = config.detailBudget ?? 20;

      for (const p of parsed) {
        const race: Race = {
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: null,
          venue: p.venue,
          courses: [],
          applicationUrl: p.detailUrl ?? BASE_URL,
          notes: "RunningMap: supplementary source",
          sources: [id],
          verified: false,
          lastVerified: null,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: computeRegistrationStatus(null, p.eventDate),
        };
        let links: readonly DiscoveredRaceLink[] = [];
        if (remainingDetailBudget > 0 && p.detailUrl !== null) {
          remainingDetailBudget -= 1;
          try {
            const detailHtml = config.fixtureDir
              ? await readFixture(config.fixtureDir, detailFixtureName(p.detailUrl, BASE_URL))
              : await fetchWithTimeout(p.detailUrl);
            links = discoverDetailLinks(race, detailHtml, p.detailUrl);
          } catch (error) {
            if (!(error instanceof Error)) throw error;
          }
        }
        const registrationLink =
          links.find((link) => link.kind === "application") ??
          links.find((link) => link.kind === "official-site");
        races.push(
          registrationLink === undefined ? race : { ...race, applicationUrl: registrationLink.url },
        );
        discoveredLinks.push(...links);
      }

      return {
        races,
        discoveredLinks,
        metadata: successMetadata(
          id,
          races.length,
          races.length > 0
            ? `Collected ${races.length} races from RunningMap`
            : "No races found in RunningMap homepage",
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        discoveredLinks: [],
        metadata: failedMetadata(id, true, `RunningMap failed: ${message}`),
      };
    }
  },
};
