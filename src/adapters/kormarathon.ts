/**
 * KorMarathon adapter — enrichment source.
 *
 * KorMarathon (kormarathon.com) is a Next.js RSC app with race data.
 * Provides: name, date, venue, registration period/fees.
 * This adapter parses the SSR HTML for race entries and any RSC-embedded JSON.
 */
import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { canonicalCourses } from "../courses.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeKorMarathonDetailUrl } from "./detail-source-url.js";
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

const BASE_URL = "https://www.kormarathon.com";
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
    aggregatorHosts: AGGREGATOR_HOSTS,
    html: detailHtml,
    raceDetailContext: { present: true },
  });
}

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly registrationDeadline: string | null;
  readonly courses: ReadonlyArray<{ readonly name: string; readonly price: number | null }>;
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
          const location = isRecord(data.location) ? data.location : undefined;
          const venue = typeof location?.name === "string" ? location.name : "미상";

          if (eventDate !== null) {
            races.push({
              name,
              eventDate,
              venue,
              registrationDeadline: null,
              courses: [],
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
    const venueMatch = decoded.match(/"venue":"([^"]+)"/);
    const idMatch = decoded.match(/"id":"([^"]+)"/);

    if (nameMatch?.[1] && dateMatch?.[1]) {
      races.push({
        name: nameMatch[1],
        eventDate: dateMatch[1],
        venue: venueMatch?.[1] ?? "미상",
        registrationDeadline: null,
        courses: [],
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
        venue: "미상",
        registrationDeadline: null,
        courses: [],
        detailUrl: null,
      });
    }
    cardMatch = cardPattern.exec(html);
  }

  return races;
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

      const parsed = parseKorMarathonHtml(listHtml);
      const now = new Date().toISOString();
      const seen = new Set<string>();
      const races: Race[] = [];
      const discoveredLinks: DiscoveredRaceLink[] = [];
      let remainingDetailBudget = config.detailBudget ?? 20;

      for (const p of parsed) {
        const key = `${p.name}|${p.eventDate}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const courses = canonicalCourses(
          p.courses.map((course) => ({ ...course, priceSource: "structured" as const })),
        );

        const race: Race = {
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: p.registrationDeadline,
          venue: p.venue,
          courses,
          applicationUrl: p.detailUrl ?? BASE_URL,
          sources: [id],
          verified: true,
          lastVerified: now,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: computeRegistrationStatus(p.registrationDeadline, p.eventDate),
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
          `Collected ${races.length} races from KorMarathon`,
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        discoveredLinks: [],
        metadata: failedMetadata(id, true, `KorMarathon failed: ${message}`),
      };
    }
  },
};
