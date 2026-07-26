/**
 * Maedal adapter — partial SSR, metadata-only when rich data cannot be parsed.
 *
 * Maedal (maedal.com) is a Next.js app. Race listings are in the SSR payload
 * but detailed course/price data requires client-side rendering.
 * This adapter extracts what it can from SSR and stays metadata-only otherwise.
 */
import type { Race } from "../contract.js";
import { KNOWN_AGGREGATOR_HOSTS } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeMaedalDetailUrl } from "./detail-source-url.js";
import {
  type AdapterResult,
  type CollectConfig,
  type DiscoveredRaceLink,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  sourceDetailUrl,
  sourceId,
  sourceResultUrl,
  successMetadata,
  transientIdentityHint,
} from "./types.js";

const BASE_URL = "https://maedal.com";
const DETAIL_BUDGET = 20;

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

function identityEvidence(parsed: ParsedRace): SourceDiscoveryCandidate["identityEvidence"] {
  return {
    titleHints: [transientIdentityHint(parsed.name)],
    dateHints: [transientIdentityHint(parsed.eventDate)],
    organizerHints: [],
  };
}

function transientRace(parsed: ParsedRace, detailUrl: string, now: string, id: string): Race {
  return {
    name: parsed.name,
    eventDate: parsed.eventDate,
    registrationDeadline: null,
    venue: parsed.venue,
    courses: [],
    applicationUrl: detailUrl,
    sources: [id],
    verified: false,
    lastVerified: null,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: "unknown",
  };
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
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          listHtml = await readFixture(config.fixtureDir, "list.html");
        }
      } else {
        listHtml = await fetchWithTimeout(BASE_URL);
      }

      const parsed = parseMaedalHtml(listHtml);
      const now = new Date().toISOString();
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const discoveredOfficialCandidates: DiscoveredRaceLink[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      let remainingDetailBudget = config.detailBudget ?? DETAIL_BUDGET;

      for (const p of parsed) {
        const detailUrl = safeMaedalDetailUrl(p.detailUrl);
        if (detailUrl === null) {
          rejectedCandidates += 1;
          continue;
        }
        const evidence = identityEvidence(p);
        discoveryCandidates.push({
          sourceId: sourceId(id),
          sourceResultUrl: sourceResultUrl(BASE_URL),
          sourceDetailUrl: sourceDetailUrl(detailUrl),
          identityEvidence: evidence,
        });
        if (remainingDetailBudget <= 0) {
          budgetSkipped += 1;
          continue;
        }
        remainingDetailBudget -= 1;

        let detailHtml: string;
        try {
          detailHtml = config.fixtureDir
            ? await readFixture(config.fixtureDir, detailFixtureName(detailUrl, BASE_URL))
            : await fetchWithTimeout(detailUrl);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          rejectedCandidates += 1;
          continue;
        }
        sourceDetailsFetched += 1;
        const links = discoverRaceLinks({
          race: transientRace(p, detailUrl, now, id),
          sourceId: id,
          sourcePageUrl: detailUrl,
          sourceHosts: ["maedal.com"],
          aggregatorHosts: KNOWN_AGGREGATOR_HOSTS,
          html: detailHtml,
          raceDetailContext: { present: true, sourceDetailUrl: detailUrl },
        });
        if (links.length === 0) rejectedCandidates += 1;
        discoveredOfficialCandidates.push(...links);
      }

      const message =
        discoveryCandidates.length > 0
          ? `Collected ${discoveryCandidates.length} Maedal source-detail candidates`
          : "No safe Maedal source-detail candidates found in SSR payload";

      return {
        discoveryCandidates,
        discoveredOfficialCandidates,
        metadata: successMetadata(id, discoveryCandidates.length, message),
        stageCounters: {
          discoveryCandidates: discoveryCandidates.length,
          sourceDetailsFetched,
          discoveredOfficialCandidates: discoveredOfficialCandidates.length,
          rejectedCandidates,
          budgetSkipped,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        discoveryCandidates: [],
        discoveredOfficialCandidates: [],
        metadata: failedMetadata(id, true, `Maedal failed: ${message}`),
        stageCounters: {
          discoveryCandidates: 0,
          sourceDetailsFetched: 0,
          discoveredOfficialCandidates: 0,
          rejectedCandidates: 0,
          budgetSkipped: 0,
        },
      };
    }
  },
};
