/**
 * MarathonMate adapter — supplementary source.
 *
 * MarathonMate (marathonmate.com) is a simple redirect/lander site.
 * Provides minimal race data when SSR content is available.
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

const BASE_URL = "https://marathonmate.store";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
}

function parseMarathonMateHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  // MarathonMate: check for any race data in SSR content
  const linkPattern = /<a[^>]*href="([^"]*\/race\/[^\"]*)"[^>]*>([^<]{3,80})<\/a>/gi;
  let match = linkPattern.exec(html);

  while (match !== null) {
    const href = match[1] ?? "";
    const text = (match[2] ?? "").trim();
    if (text.length >= 3) {
      const idx = match.index;
      const context = html.slice(Math.max(0, idx - 300), idx + 300);
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

export const MarathonMateAdapter: SourceAdapter = {
  id: "marathonmate",
  name: "MarathonMate",
  baseUrl: BASE_URL,
  allowedPaths: ["/domestic", "/race/"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let homeHtml: string;
      if (config.fixtureDir) {
        homeHtml = await readFixture(config.fixtureDir, "home.html");
      } else {
        homeHtml = await fetchWithTimeout(`${BASE_URL}/domestic`);
      }

      const parsed = parseMarathonMateHtml(homeHtml);
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
          notes: "MarathonMate: supplementary source",
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
            ? `Collected ${races.length} races from MarathonMate`
            : "No races found in MarathonMate homepage",
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        metadata: failedMetadata(id, true, `MarathonMate failed: ${message}`),
      };
    }
  },
};
