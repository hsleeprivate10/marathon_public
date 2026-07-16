/**
 * Marathon Moa adapter — supplementary source.
 *
 * Marathon Moa (marathonmoa.com) provides community-sourced race listings.
 * Data quality varies; this adapter extracts what is publicly available.
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

const BASE_URL = "https://marathon.me.kr";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
}

function parseMarathonMoaHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  // Marathon Moa: community posts and race announcements
  const cardPattern =
    /<(?:article|div)[^>]*class="[^"]*(?:post|race|event|card)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
  let match = cardPattern.exec(html);

  while (match !== null) {
    const inner = match[1] ?? "";
    const nameMatch =
      inner.match(/<a[^>]*>([^<]{4,80})<\/a>/i) ??
      inner.match(/<h[2-4][^>]*>([^<]{4,80})<\/h[2-4]>/i);
    const dateMatch = inner.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    const venueMatch = inner.match(/(?:장소|지역|지역명|장소명)[^<]*?[:：]\s*([^<\n]{2,30})/i);
    const hrefMatch = inner.match(/href="([^"]+)"/i);

    if (nameMatch?.[1]) {
      races.push({
        name: nameMatch[1].trim(),
        eventDate: dateMatch
          ? `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`
          : "2025-01-01",
        venue: venueMatch?.[1]?.trim() ?? "미상",
        detailUrl: hrefMatch?.[1]
          ? hrefMatch[1].startsWith("http")
            ? hrefMatch[1]
            : `${BASE_URL}${hrefMatch[1]}`
          : BASE_URL,
      });
    }
    match = cardPattern.exec(html);
  }

  return races;
}

export const MarathonMoaAdapter: SourceAdapter = {
  id: "marathonmoa",
  name: "Marathon Moa",
  baseUrl: BASE_URL,
  allowedPaths: ["/events", "/events/"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let homeHtml: string;
      if (config.fixtureDir) {
        homeHtml = await readFixture(config.fixtureDir, "home.html");
      } else {
        homeHtml = await fetchWithTimeout(`${BASE_URL}/events`);
      }

      const parsed = parseMarathonMoaHtml(homeHtml);
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
          notes: "Marathon Moa: supplementary community source",
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
            ? `Collected ${races.length} races from Marathon Moa`
            : "No races found in Marathon Moa homepage",
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        metadata: failedMetadata(id, true, `Marathon Moa failed: ${message}`),
      };
    }
  },
};
