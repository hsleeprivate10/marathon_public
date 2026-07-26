/**
 * MarathonMate adapter — supplementary source.
 *
 * MarathonMate (marathonmate.com) is a simple redirect/lander site.
 * Provides minimal race data when SSR content is available.
 */
import { type Race, computeRegistrationStatus } from "../contract.js";
import { KNOWN_AGGREGATOR_HOSTS } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeMarathonMateDetailUrl } from "./detail-source-url.js";
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

const BASE_URL = "https://marathonmate.store";
const LIST_URL = `${BASE_URL}/domestic`;

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
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
          detailUrl: safeMarathonMateDetailUrl(href) ?? href,
        });
      }
    }
    match = linkPattern.exec(html);
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
    registrationStatus: computeRegistrationStatus(null, parsed.eventDate),
  };
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
        homeHtml = await fetchWithTimeout(LIST_URL);
      }

      const parsed = parseMarathonMateHtml(homeHtml);
      const now = new Date().toISOString();
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const discoveredOfficialCandidates: DiscoveredRaceLink[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      let remainingDetailBudget = config.detailBudget ?? 20;

      for (const p of parsed) {
        const detailUrl = safeMarathonMateDetailUrl(p.detailUrl);
        if (detailUrl === null) {
          rejectedCandidates += 1;
          continue;
        }
        const evidence = identityEvidence(p);
        discoveryCandidates.push({
          sourceId: sourceId(id),
          sourceResultUrl: sourceResultUrl(LIST_URL),
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
          sourceHosts: ["marathonmate.store", "marathonmate.com"],
          aggregatorHosts: KNOWN_AGGREGATOR_HOSTS,
          html: detailHtml,
          raceDetailContext: { present: true, sourceDetailUrl: detailUrl },
        });
        if (links.length === 0) rejectedCandidates += 1;
        discoveredOfficialCandidates.push(...links);
      }

      return {
        discoveryCandidates,
        discoveredOfficialCandidates,
        metadata: successMetadata(
          id,
          discoveryCandidates.length,
          discoveryCandidates.length > 0
            ? `Collected ${discoveryCandidates.length} MarathonMate source-detail candidates`
            : "No safe MarathonMate source-detail candidates found in homepage",
        ),
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
        metadata: failedMetadata(id, true, `MarathonMate failed: ${message}`),
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
