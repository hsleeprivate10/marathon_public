import type { Course, Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { canonicalCourses } from "../courses.js";
import {
  type AdapterResult,
  type CollectConfig,
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

const DETAIL_BUDGET = 20;

interface RaceListItem {
  readonly detailPath: string;
  readonly name: string;
  readonly dateHint: string;
}

/** Extract race list entries from the list HTML page. */
function parseListPage(html: string): ReadonlyArray<RaceListItem> {
  const items: RaceListItem[] = [];
  const linkPattern =
    /<a[^>]*href="(\/races\/[^"?#]+|\/race\/view\.php\?idx=\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match = linkPattern.exec(html);
  while (match !== null) {
    const detailPath = match[1] ?? "";
    const inner = (match[2] ?? "").replace(/<[^>]*>/g, "").trim();
    if (inner.length > 2) {
      items.push({
        detailPath,
        name: inner,
        dateHint: "",
      });
    }
    match = linkPattern.exec(html);
  }
  return items;
}

interface DetailData {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly courses: ReadonlyArray<Course>;
  readonly applicationUrl: string;
  readonly registrationDeadline: string | null;
}

/** Extract structured data from a GoRunning detail page. */
function parseDetailPage(html: string, baseUrl: string): DetailData | null {
  // Title / race name
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const name = titleMatch?.[1]?.trim().replace(/\s*[-|].*$/, "") ?? null;
  if (!name || name.length < 3) return null;

  // Date extraction: look for YYYY.MM.DD or YYYY-MM-DD patterns near "일" or "날짜"
  const datePatterns = [
    /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
    /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
  ];
  let eventDate = "";
  for (const pat of datePatterns) {
    const m = html.match(pat);
    if (m) {
      eventDate = `${m[1]}-${m[2]?.padStart(2, "0")}-${m[3]?.padStart(2, "0")}`;
      break;
    }
  }

  // Venue
  const venueMatch = html.match(/(?:장소|출발지|코스)[^<]*?:?\s*([^<\n]{3,50})/i);
  const venue = venueMatch?.[1]?.trim() ?? "미상";

  const rawCourses = [...html.matchAll(/<p[^>]*>([^<]+)<\/p>/gi)].flatMap((match) => {
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
  const deadlineMatch = html.match(
    /(?:접수마감|마감|등록마감)[^<]*?(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
  );
  const registrationDeadline = deadlineMatch
    ? `${deadlineMatch[1]}-${deadlineMatch[2]?.padStart(2, "0")}-${deadlineMatch[3]?.padStart(2, "0")}`
    : null;

  // Application URL — link to registration
  const appLinkMatch = html.match(/href="(https?:\/\/[^"]*(?:apply|entry|register|접수)[^"]*)"/i);
  const applicationUrl = appLinkMatch?.[1] ?? `${baseUrl}`;

  return {
    name,
    eventDate: eventDate || "2025-01-01",
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

export const GoRunningAdapter: SourceAdapter = {
  id: "gorunning",
  name: "GoRunning",
  baseUrl: BASE_URL,
  allowedPaths: ["/races/", "/races/monthly/"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let listHtml: string;
      if (config.fixtureDir) {
        listHtml = await readFixture(config.fixtureDir, "list.html");
      } else {
        listHtml = await fetchWithTimeout(`${BASE_URL}/races/`);
      }

      const items = parseListPage(listHtml);
      const budget = config.detailBudget ?? DETAIL_BUDGET;
      const races: Race[] = [];
      const now = new Date().toISOString();

      for (const item of items.slice(0, budget)) {
        let detailHtml: string;
        if (config.fixtureDir) {
          const filename = `${item.detailPath.replace(/[^a-z0-9]/g, "_")}.html`;
          try {
            detailHtml = await readFixture(config.fixtureDir, filename);
          } catch {
            // Skip items without detail fixtures
            continue;
          }
        } else {
          detailHtml = await fetchWithTimeout(`${BASE_URL}${item.detailPath}`);
        }

        const detail = parseDetailPage(detailHtml, BASE_URL);
        if (!detail) continue;

        const courses = detail.courses.map((c) => ({
          name: c.name,
          price: c.price,
          priceSource: "structured" as const,
        }));

        const race: Race = {
          name: detail.name,
          eventDate: detail.eventDate,
          registrationDeadline: detail.registrationDeadline,
          venue: detail.venue,
          courses,
          applicationUrl: detail.applicationUrl,
          sources: [id],
          verified: true,
          lastVerified: now,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: computeRegistrationStatus(
            detail.registrationDeadline,
            detail.eventDate,
          ),
        };
        races.push(race);

        if (!config.fixtureDir) {
          await sleep(INTER_FETCH_DELAY_MS);
        }
      }

      return {
        races,
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
        metadata: failedMetadata(id, true, `GoRunning failed: ${message}`),
      };
    }
  },
};
