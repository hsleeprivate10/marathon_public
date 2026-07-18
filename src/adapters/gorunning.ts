import type { Course, Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { canonicalCourses } from "../courses.js";
import { safeApplicationUrl } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeGoRunningDetailUrl } from "./detail-source-url.js";
import { parseGoRunningList } from "./gorunning-list.js";
import {
  type AdapterResult,
  type CollectConfig,
  type DiscoveredRaceLink,
  INTER_FETCH_DELAY_MS,
  type SourceAdapter,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  sleep,
  successMetadata,
} from "./types.js";

// ---------------------------------------------------------------------------
// HTML parsing helpers (simple regex-based, no DOM dependency)
// ---------------------------------------------------------------------------

const DETAIL_BUDGET = 200;

interface DetailData {
  readonly name: string;
  readonly eventDate: string | null;
  readonly venue: string;
  readonly courses: ReadonlyArray<Course>;
  readonly applicationUrl: string | null;
  readonly registrationDeadline: string | null;
}

/** Extract structured data from a GoRunning detail page. */
function parseDetailPage(html: string): DetailData | null {
  const visibleHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  // Title / race name
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const name = titleMatch?.[1]?.trim().replace(/\s*\|\s*고러닝.*$/i, "") ?? null;
  if (!name || name.length < 3) return null;

  // Date extraction: look for YYYY.MM.DD or YYYY-MM-DD patterns near "일" or "날짜"
  const datePatterns = [
    /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
    /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
  ];
  let eventDate = "";
  for (const pat of datePatterns) {
    const m = visibleHtml.match(pat);
    if (m) {
      eventDate = `${m[1]}-${m[2]?.padStart(2, "0")}-${m[3]?.padStart(2, "0")}`;
      break;
    }
  }

  // Venue
  const venueMatch = visibleHtml.match(/(?:장소|출발지|코스)[^<]*?:?\s*([^<\n]{3,50})/i);
  const venue = venueMatch?.[1]?.trim() ?? "미상";

  const rawCourses = [...visibleHtml.matchAll(/<p[^>]*>([^<]+)<\/p>/gi)].flatMap((match) => {
    const course = (match[1] ?? "").match(
      /^\s*(풀코스|하프코스|하프|10K|10km|5K|5km)\s*:?[\s]*(?:(\d{1,3}(?:,\d{3})+))?\s*원?/i,
    );
    if (!course?.[1]) return [];
    return [
      {
        name: course[1],
        price: course[2] ? Number.parseInt(course[2].replaceAll(",", ""), 10) : null,
      },
    ];
  });
  const courses = canonicalCourses(rawCourses);

  // Registration deadline
  const deadlineMatch = visibleHtml.match(
    /(?:접수마감|마감|등록마감)[^<]*?(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
  );
  const registrationDeadline = deadlineMatch
    ? `${deadlineMatch[1]}-${deadlineMatch[2]?.padStart(2, "0")}-${deadlineMatch[3]?.padStart(2, "0")}`
    : null;

  // Application URL — link to registration
  const appLinkMatch = html.match(/href="(https?:\/\/[^"]*(?:apply|entry|register|접수)[^"]*)"/i);
  const websiteLinkMatch = html.match(
    /(?:Website|웹사이트)<\/p>[\s\S]{0,500}?href="(https?:\/\/[^"]+)"/i,
  );
  const applicationUrl = appLinkMatch?.[1] ?? websiteLinkMatch?.[1] ?? null;

  return {
    name,
    eventDate: eventDate || null,
    venue,
    courses,
    applicationUrl,
    registrationDeadline,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const BASE_URL = "https://gorunning.kr";
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

function withoutSelfSourceApplications(
  links: readonly DiscoveredRaceLink[],
): readonly DiscoveredRaceLink[] {
  return links.filter((link) => {
    if (link.kind !== "application") return true;
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
      raceDetailContext: { present: true },
    }),
  );
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

      const items = parseGoRunningList(listHtml);
      const budget = config.detailBudget ?? DETAIL_BUDGET;
      const races: Race[] = [];
      const discoveredLinks: DiscoveredRaceLink[] = [];
      const now = new Date().toISOString();

      for (const [index, item] of items.entries()) {
        const detailUrl = safeGoRunningDetailUrl(item.detailPath);
        if (detailUrl === null) continue;
        let detailHtml: string | undefined;
        if (index < budget) {
          if (config.fixtureDir) {
            const filename = detailFixtureName(detailUrl, BASE_URL);
            try {
              detailHtml = await readFixture(config.fixtureDir, filename);
            } catch {
              detailHtml = undefined;
            }
          } else {
            try {
              detailHtml = await fetchWithTimeout(detailUrl);
            } catch {
              detailHtml = undefined;
            }
          }
        }

        const detail = detailHtml === undefined ? null : parseDetailPage(detailHtml);
        if (detail === null && item.eventDate === "") continue;

        const rawCourses = detail?.courses.length ? detail.courses : item.courses;
        const courses = rawCourses.map((course) => ({
          name: course.name,
          price: course.price,
          ...(detail === null ? {} : { priceSource: "structured" as const }),
        }));

        const sourcePageUrl = detailUrl;
        const eventDate = item.eventDate || detail?.eventDate;
        if (eventDate === null || eventDate === undefined || eventDate === "") continue;
        const registrationDeadline = detail?.registrationDeadline ?? null;
        const detailApplicationUrl = safeApplicationUrl(detail?.applicationUrl ?? null);
        const race: Race = {
          name: item.name,
          eventDate,
          registrationDeadline,
          venue: item.venue === "미상" ? (detail?.venue ?? "미상") : item.venue,
          courses,
          applicationUrl: detailApplicationUrl ?? sourcePageUrl,
          sources: [id],
          verified: detail !== null,
          lastVerified: detail === null ? null : now,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: computeRegistrationStatus(registrationDeadline, eventDate),
        };
        const links =
          detailHtml === undefined ? [] : discoverDetailLinks(race, detailHtml, sourcePageUrl);
        const registrationLink =
          links.find((link) => link.kind === "application") ??
          links.find((link) => link.kind === "official-site");
        races.push(
          registrationLink === undefined ? race : { ...race, applicationUrl: registrationLink.url },
        );
        discoveredLinks.push(...links);

        if (!config.fixtureDir && detailHtml !== undefined) {
          await sleep(INTER_FETCH_DELAY_MS);
        }
      }

      return {
        races,
        discoveredLinks,
        metadata: successMetadata(
          id,
          races.length,
          `Collected ${races.length} races from GoRunning`,
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        discoveredLinks: [],
        metadata: failedMetadata(id, true, `GoRunning failed: ${message}`),
      };
    }
  },
};
