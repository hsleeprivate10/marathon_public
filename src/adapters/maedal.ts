/**
 * Maedal adapter — partial SSR, metadata-only when rich data cannot be parsed.
 *
 * Maedal (maedal.com) is a Next.js app. Race listings are in the SSR payload
 * but detailed course/price data requires client-side rendering.
 * This adapter extracts what it can from SSR and stays metadata-only otherwise.
 */
import type { Race } from "../contract.js";
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

const BASE_URL = "https://maedal.com";

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

      // Try to extract text from the exact owning race item only; use nearby
      // text for metadata fallback, but never for discovered links.
      const idx = linkMatch.index;
      const sourceHtml = ownerBlock(html, idx);
      const context = sourceHtml || html.slice(Math.max(0, idx - 500), idx + 500);
      const nameMatch =
        context.match(/(?:aria-label|title|alt)="([^"]{4,80})"/i) ??
        context.match(/>([^<가-힣]{4,60})</);
      const dateMatch = context.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);

      if (dateMatch !== null) {
        races.push({
          name: nameMatch?.[1]?.trim() ?? "마라톤 대회",
          eventDate: `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`,
          venue: "미상",
          detailUrl: `${BASE_URL}${path}`,
          sourceHtml,
        });
      }
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
      const discoveredLinks: DiscoveredRaceLink[] = [];

      for (const p of parsed) {
        // Maedal is metadata-only: we don't have prices or dates from SSR
        // Preserve what we have and mark prices as unknown
        const race: Race = {
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
        };
        const links = discoverRaceLinks({
          race,
          sourceId: id,
          sourcePageUrl: BASE_URL,
          sourceHosts: ["maedal.com"],
          aggregatorHosts: ["maedal.com"],
          html: p.sourceHtml,
          raceDetailContext: { present: true },
        });
        const registrationLink =
          links.find((link) => link.kind === "application") ??
          links.find((link) => link.kind === "official-site");
        races.push(registrationLink ? { ...race, applicationUrl: registrationLink.url } : race);
        discoveredLinks.push(...links);
      }

      const message =
        races.length > 0
          ? `Collected ${races.length} races from Maedal (metadata-only, prices/dates absent from SSR)`
          : "No races found in Maedal SSR payload";

      return {
        races,
        discoveredLinks,
        metadata: successMetadata(id, races.length, message),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        discoveredLinks: [],
        metadata: failedMetadata(id, true, `Maedal failed: ${message}`),
      };
    }
  },
};
