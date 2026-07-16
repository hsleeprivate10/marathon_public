/**
 * e-Marathon adapter — SSR source with body-text prices.
 *
 * e-Marathon (e-marathon.co.kr) is SSR but some prices are only in body text,
 * not structured fields. This adapter marks such prices as body-text sourced.
 */
import type { Course, Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { canonicalCourses } from "../courses.js";
import {
  type AdapterResult,
  type CollectConfig,
  type SourceAdapter,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  successMetadata,
} from "./types.js";

const BASE_URL = "https://emarathon.or.kr";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly courses: ReadonlyArray<Course>;
  readonly registrationDeadline: string | null;
  readonly detailUrl: string;
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
    if (rawName) {
      const detailUrl = linkMatch?.[1]
        ? new URL(linkMatch[1].replaceAll("&amp;", "&"), BASE_URL).toString()
        : BASE_URL;
      const name = rawName
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(?:텍스트|파일첨부)\s*/, "")
        .replace(/^\[(?:full|half|10k|5k)\]\s*/i, "")
        .replace(/링크\s*$/, "");
      const eventDate = dateMatch
        ? `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`
        : "2025-01-01";
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
  allowedPaths: ["/bbs/board.php"],

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

      for (const p of parsed) {
        races.push({
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: p.registrationDeadline,
          venue: p.venue,
          courses: p.courses.map((c) => ({
            name: c.name,
            price: c.price,
            priceSource: c.priceSource,
          })),
          applicationUrl: p.detailUrl,
          sources: [id],
          verified: true,
          lastVerified: now,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: computeRegistrationStatus(p.registrationDeadline, p.eventDate),
        });
      }

      return {
        races,
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
        metadata: failedMetadata(id, true, `e-Marathon failed: ${message}`),
      };
    }
  },
};
