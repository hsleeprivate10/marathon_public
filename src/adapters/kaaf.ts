/**
 * KAAF adapter — legacy ASP, verification only.
 *
 * KAAF (kaaf.or.kr) is a classic ASP site with legacy encoding (EUC-KR).
 * It provides only basic event/date/place verification — no pricing or course data.
 * This adapter extracts minimal info for cross-referencing with other sources.
 */
import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { safeApplicationUrl } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
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

const BASE_URL = "https://m.kaaf.or.kr";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
  readonly sourceHtml: string;
}

function rowBlock(html: string, index: number): string {
  const openPattern = /<tr\b[^>]*>/gi;
  let bestStart: number | undefined;
  let match = openPattern.exec(html);
  while (match !== null && match.index <= index) {
    bestStart = match.index;
    match = openPattern.exec(html);
  }
  if (bestStart === undefined) return "";
  const close = html.toLowerCase().indexOf("</tr>", index);
  if (close === -1) return "";
  return html.slice(bestStart, close + "</tr>".length);
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
      /마라톤|대회|race/i.test(text) &&
      !/^(?:공식\s*)?(?:대회\s*)?홈페이지|참가신청|접수|신청하기|신청$/i.test(text)
    ) {
      // Use the exact table row as discovery context; fallback context is
      // metadata-only and is never sent to discoverRaceLinks.
      const idx = match.index;
      const sourceHtml = rowBlock(html, idx);
      const context = sourceHtml || html.slice(Math.max(0, idx - 500), idx + 500);
      const dateMatch = context.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);

      if (dateMatch !== null) {
        races.push({
          name: text,
          eventDate: `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`,
          venue: "미상",
          detailUrl: href.startsWith("http") ? href : `${BASE_URL}/${href.replace(/^\//, "")}`,
          sourceHtml,
        });
      }
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
      const discoveredLinks: DiscoveredRaceLink[] = [];

      for (const p of parsed) {
        const race: Race = {
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: null,
          venue: p.venue,
          courses: [],
          applicationUrl:
            safeApplicationUrl(p.detailUrl) ?? `${BASE_URL}/mobile/info/inside_all.asp`,
          notes: "KAAF: verification-only source, no pricing/course data",
          sources: [id],
          verified: false,
          lastVerified: null,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: computeRegistrationStatus(null, p.eventDate),
        };
        const links = discoverRaceLinks({
          race,
          sourceId: id,
          sourcePageUrl: `${BASE_URL}/mobile/info/inside_all.asp`,
          sourceHosts: ["m.kaaf.or.kr", "kaaf.or.kr"],
          aggregatorHosts: ["m.kaaf.or.kr", "kaaf.or.kr"],
          html: p.sourceHtml,
          raceDetailContext: { present: true },
        });
        const registrationLink =
          links.find((link) => link.kind === "application") ??
          links.find((link) => link.kind === "official-site");
        races.push(registrationLink ? { ...race, applicationUrl: registrationLink.url } : race);
        discoveredLinks.push(...links);
      }

      return {
        races,
        discoveredLinks,
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
        discoveredLinks: [],
        metadata: failedMetadata(id, true, `KAAF failed: ${message}`),
      };
    }
  },
};
