/**
 * e-Marathon adapter — SSR source with body-text prices.
 *
 * e-Marathon (e-marathon.co.kr) is SSR but some prices are only in body text,
 * not structured fields. This adapter marks such prices as body-text sourced.
 */
import type { Course, Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { canonicalCourses } from "../courses.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeEMarathonDetailUrl } from "./detail-source-url.js";
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

const BASE_URL = "https://emarathon.or.kr";
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
    raceDetailContext: { present: true },
  });
}

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly courses: ReadonlyArray<Course>;
  readonly registrationDeadline: string | null;
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
    // Venue
    const venueMatch = inner.match(
      /(?:대회지역|장소|지역|출발지|위치)[^<]*?[:：]\s*([^<\n]{2,80})/i,
    );
    const courseMatch = inner.match(/종목\s*[:：]\s*([^<]+)/i);
    // Price in body text (e-Marathon characteristic)
    const priceMatch = inner.match(/(\d{1,3}(?:,\d{3})+)\s*원/);

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
      const venue = venueMatch?.[1]?.trim() ?? "미상";
      const price = priceMatch?.[1] ? Number.parseInt(priceMatch[1].replace(/,/g, ""), 10) : null;
      const courses = canonicalCourses(
        (courseMatch?.[1] ?? "").split(/[,/·|]/).map((course) => ({
          name: course,
          price,
          priceSource: "body-text" as const,
        })),
      );

      races.push({
        name,
        eventDate,
        venue,
        courses,
        registrationDeadline: null,
        detailUrl,
      });
    }
    rowMatch = rowPattern.exec(html);
  }

  return races;
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

      const parsed = parseEMarathonHtml(listHtml);
      const now = new Date().toISOString();
      const races: Race[] = [];
      const discoveredLinks: DiscoveredRaceLink[] = [];
      let remainingDetailBudget = config.detailBudget ?? 20;

      for (const p of parsed) {
        const race: Race = {
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: p.registrationDeadline,
          venue: p.venue,
          courses: p.courses.map((c) => ({
            name: c.name,
            price: c.price,
            priceSource: c.priceSource,
          })),
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
          `Collected ${races.length} races from e-Marathon`,
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        discoveredLinks: [],
        metadata: failedMetadata(id, true, `e-Marathon failed: ${message}`),
      };
    }
  },
};
