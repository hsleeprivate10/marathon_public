/**
 * MarathonMate adapter — supplementary source.
 *
 * MarathonMate (marathonmate.com) is a simple redirect/lander site.
 * Provides minimal race data when SSR content is available.
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

const BASE_URL = "https://marathonmate.store";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
  readonly sourceHtml: string;
}

function safeItem(attrs: string): boolean {
  const classMatch = attrs.match(/class="([^"]*)"/i);
  const classes = classMatch?.[1] ?? "";
  return (
    /(?:^|[-_\s])(race|event|post|card)(?:$|[-_\s])/i.test(classes) &&
    !/list|board|container|wrap|grid/i.test(classes)
  );
}

function closeIndex(html: string, tag: string, openIndex: number): number | undefined {
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = openIndex;
  let depth = 0;
  let match = tagPattern.exec(html);
  while (match !== null) {
    if ((match[0] ?? "").startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return tagPattern.lastIndex;
    match = tagPattern.exec(html);
  }
  return undefined;
}

function ownerBlock(html: string, index: number): string {
  const openPattern = /<(section|article|div|li)\b([^>]*)>/gi;
  let best: { readonly start: number; readonly end: number } | undefined;
  let match = openPattern.exec(html);
  while (match !== null && match.index <= index) {
    const tag = match[1] ?? "";
    const attrs = match[2] ?? "";
    const end = safeItem(attrs) ? closeIndex(html, tag, match.index) : undefined;
    if (end !== undefined && end >= index) best = { start: match.index, end };
    match = openPattern.exec(html);
  }
  return best === undefined ? "" : html.slice(best.start, best.end);
}

function parseMarathonMateHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  // MarathonMate: check for any race data in SSR content
  const linkPattern = /<a[^>]*href="([^"]*\/race\/[^\"]*)"[^>]*>([^<]{3,80})<\/a>/gi;
  let match = linkPattern.exec(html);

  while (match !== null) {
    const href = match[1] ?? "";
    const text = (match[2] ?? "").trim();
    if (text.length >= 3 && /마라톤|marathon|run/i.test(text)) {
      const idx = match.index;
      const sourceHtml = ownerBlock(html, idx);
      const context = sourceHtml || html.slice(Math.max(0, idx - 300), idx + 300);
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
      const discoveredLinks: DiscoveredRaceLink[] = [];

      for (const p of parsed) {
        const race: Race = {
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: null,
          venue: p.venue,
          courses: [],
          applicationUrl: safeApplicationUrl(p.detailUrl) ?? `${BASE_URL}/domestic`,
          notes: "MarathonMate: supplementary source",
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
          sourcePageUrl: `${BASE_URL}/domestic`,
          sourceHosts: ["marathonmate.store", "marathonmate.com"],
          aggregatorHosts: ["marathonmate.store", "marathonmate.com"],
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
            ? `Collected ${races.length} races from MarathonMate`
            : "No races found in MarathonMate homepage",
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        discoveredLinks: [],
        metadata: failedMetadata(id, true, `MarathonMate failed: ${message}`),
      };
    }
  },
};
