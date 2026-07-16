/**
 * KAAF adapter — legacy ASP, verification only.
 *
 * KAAF (kaaf.or.kr) is a classic ASP site with legacy encoding (EUC-KR).
 * It provides only basic event/date/place verification — no pricing or course data.
 * This adapter extracts minimal info for cross-referencing with other sources.
 */
import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import {
  type AdapterResult,
  type CollectConfig,
  type SourceAdapter,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  successMetadata,
} from "./types.js";

const BASE_URL = "https://m.kaaf.or.kr";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
}

function parseKaafHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  // KAAF uses ASP pages; look for event listing patterns
  const linkPattern = /<a[^>]*href="([^"]*\.asp[^"]*)"[^>]*>([^<]{4,80})<\/a>/gi;
  let match = linkPattern.exec(html);

  while (match !== null) {
    const href = match[1] ?? "";
    const text = (match[2] ?? "").trim();

    // Only include links that look like event/race pages
    if (
      text.includes("마라톤") ||
      text.includes("대회") ||
      text.includes("대회일") ||
      /마라톤|대회|race/i.test(text)
    ) {
      // Try to find a date nearby
      const idx = match.index;
      const context = html.slice(Math.max(0, idx - 200), idx + 200);
      const dateMatch = context.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);

      races.push({
        name: text,
        eventDate: dateMatch
          ? `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`
          : "2025-01-01",
        venue: "미상",
        detailUrl: href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\//, "")}`,
      });
    }
    match = linkPattern.exec(html);
  }

  return races;
}

export const KaafAdapter: SourceAdapter = {
  id: "kaaf",
  name: "KAAF",
  baseUrl: BASE_URL,
  allowedPaths: ["/mobile/info/inside_all.asp"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let homeHtml: string;
      if (config.fixtureDir) {
        homeHtml = await readFixture(config.fixtureDir, "home.html");
      } else {
        homeHtml = await fetchWithTimeout(`${BASE_URL}/mobile/info/inside_all.asp`);
      }

      const parsed = parseKaafHtml(homeHtml);
      const now = new Date().toISOString();
      const races: Race[] = [];

      for (const p of parsed) {
        races.push({
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: null,
          venue: p.venue,
          courses: [],
          applicationUrl: p.detailUrl,
          notes: "KAAF: verification-only source, no pricing/course data",
          sources: [id],
          verified: false,
          lastVerified: null,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: computeRegistrationStatus(null, p.eventDate),
        });
      }

      return {
        races,
        metadata: successMetadata(
          id,
          races.length,
          races.length > 0
            ? `Verified ${races.length} events from KAAF (verification only)`
            : "No marathon events found in KAAF homepage",
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        metadata: failedMetadata(id, true, `KAAF failed: ${message}`),
      };
    }
  },
};
