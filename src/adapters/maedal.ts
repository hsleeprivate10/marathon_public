/**
 * Maedal adapter — partial SSR, metadata-only when rich data cannot be parsed.
 *
 * Maedal (maedal.com) is a Next.js app. Race listings are in the SSR payload
 * but detailed course/price data requires client-side rendering.
 * This adapter extracts what it can from SSR and stays metadata-only otherwise.
 */
import type { Race } from "../contract.js";
import {
  type AdapterResult,
  type CollectConfig,
  type SourceAdapter,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  successMetadata,
} from "./types.js";

const BASE_URL = "https://maedal.com";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
}

function parseMaedalHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  // Maedal uses Next.js RSC; race links are UUID-based: /races/<uuid>
  const linkPattern = /href="\/races\/([\w-]+)"/g;
  let linkMatch = linkPattern.exec(html);
  const seenPaths = new Set<string>();

  while (linkMatch !== null) {
    const path = `/races/${linkMatch[1]}`;
    if (!seenPaths.has(path)) {
      seenPaths.add(path);

      // Try to extract nearby text for name
      const idx = linkMatch.index;
      const context = html.slice(Math.max(0, idx - 500), idx + 500);
      const nameMatch =
        context.match(/(?:aria-label|title|alt)="([^"]{4,80})"/i) ??
        context.match(/>([^<가-힣]{4,60})</);

      races.push({
        name: nameMatch?.[1]?.trim() ?? "마라톤 대회",
        eventDate: "2025-01-01",
        venue: "미상",
        detailUrl: `${BASE_URL}${path}`,
      });
    }
    linkMatch = linkPattern.exec(html);
  }

  return races;
}

export const MaedalAdapter: SourceAdapter = {
  id: "maedal",
  name: "Maedal",
  baseUrl: BASE_URL,
  allowedPaths: ["/", "/races", "/races/"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let listHtml: string;
      if (config.fixtureDir) {
        // Try home first (which has race links), then list
        try {
          listHtml = await readFixture(config.fixtureDir, "home.html");
        } catch {
          listHtml = await readFixture(config.fixtureDir, "list.html");
        }
      } else {
        listHtml = await fetchWithTimeout(BASE_URL);
      }

      const parsed = parseMaedalHtml(listHtml);
      const now = new Date().toISOString();
      const races: Race[] = [];

      for (const p of parsed) {
        // Maedal is metadata-only: we don't have prices or dates from SSR
        // Preserve what we have and mark prices as unknown
        races.push({
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: null,
          venue: p.venue,
          courses: [],
          applicationUrl: p.detailUrl,
          notes: "Maedal: price/date data requires client-side rendering",
          sources: [id],
          verified: false,
          lastVerified: null,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: "unknown",
        });
      }

      const message =
        races.length > 0
          ? `Collected ${races.length} races from Maedal (metadata-only, prices/dates absent from SSR)`
          : "No races found in Maedal SSR payload";

      return {
        races,
        metadata: successMetadata(id, races.length, message),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        metadata: failedMetadata(id, true, `Maedal failed: ${message}`),
      };
    }
  },
};
