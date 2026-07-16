/**
 * RunningMap adapter — supplementary source.
 *
 * RunningMap (runningmap.com) provides route/map data alongside race info.
 * Extracts race names and dates from public listings.
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

const BASE_URL = "https://runningmap.kr";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
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
        const detailUrl = typeof entry.url === "string" ? entry.url : "";
        if (name.length > 2 && eventDate !== null && detailUrl !== "") {
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

      races.push({
        name: text,
        eventDate: dateMatch
          ? `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`
          : "2025-01-01",
        venue: venueMatch?.[1]?.trim() ?? "미상",
        detailUrl: href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\//, "")}`,
      });
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

      for (const p of parsed) {
        races.push({
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: null,
          venue: p.venue,
          courses: [],
          applicationUrl: p.detailUrl,
          notes: "RunningMap: supplementary source",
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
            ? `Collected ${races.length} races from RunningMap`
            : "No races found in RunningMap homepage",
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        metadata: failedMetadata(id, true, `RunningMap failed: ${message}`),
      };
    }
  },
};
