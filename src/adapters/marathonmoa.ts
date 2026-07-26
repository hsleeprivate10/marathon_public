/**
 * Marathon Moa adapter — supplementary source.
 *
 * Marathon Moa (marathonmoa.com) provides community-sourced race listings.
 * Data quality varies; this adapter extracts what is publicly available.
 */
import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { KNOWN_AGGREGATOR_HOSTS } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeMarathonMoaDetailUrl } from "./detail-source-url.js";
import {
  type AdapterResult,
  type CollectConfig,
  type DiscoveredRaceLink,
  INTER_FETCH_DELAY_MS,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  sleep,
  sourceDetailUrl,
  sourceId,
  sourceResultUrl,
  successMetadata,
  transientIdentityHint,
} from "./types.js";

const BASE_URL = "https://marathon.me.kr";
const LIST_URL = `${BASE_URL}/events`;
const DETAIL_BUDGET = 20;

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
}

export function parseMarathonMoaRegistrationUrls(html: string): ReadonlyMap<string, string> {
  const urls = new Map<string, string>();
  const pattern =
    /\\"id\\":\\"([0-9a-f-]{36})\\"(?:(?!\\"id\\").)*?\\"registration_url\\":(?:null|\\"([^"\\]*)\\")/gs;
  for (const match of html.matchAll(pattern)) {
    const id = match[1];
    const url = match[2];
    if (id !== undefined && url !== undefined) urls.set(id, url);
  }
  return urls;
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

function raceBlocks(html: string): readonly string[] {
  const blocks: string[] = [];
  const seen = new Set<number>();
  const openPattern = /<(article|section|div|li)\b([^>]*)>/gi;
  let match = openPattern.exec(html);
  while (match !== null) {
    const tag = match[1] ?? "";
    const attrs = match[2] ?? "";
    const end = safeItem(attrs) ? closeIndex(html, tag, match.index) : undefined;
    if (end !== undefined && !seen.has(match.index)) {
      blocks.push(html.slice(match.index, end));
      seen.add(match.index);
    }
    match = openPattern.exec(html);
  }
  return blocks;
}

function parseMarathonMoaHtml(html: string): ReadonlyArray<ParsedRace> {
  const races: ParsedRace[] = [];

  for (const match of html.matchAll(
    /<a\b[^>]*href="(\/events\/[0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const detailPath = match[1];
    const body = match[2] ?? "";
    const nameMatch = body.match(/<h[2-4][^>]*>([^<]{4,100})<\/h[2-4]>/i);
    const dateMatch = body.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    const venueMatch = body.match(/장소<\/span>\s*<span[^>]*>([^<]{2,80})<\/span>/i);
    if (detailPath === undefined || nameMatch?.[1] === undefined || dateMatch === null) continue;
    races.push({
      name: nameMatch[1].trim(),
      eventDate: `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`,
      venue: venueMatch?.[1]?.trim() ?? "미상",
      detailUrl: `${BASE_URL}${detailPath}`,
    });
  }

  if (races.length > 0) return races;

  for (const sourceHtml of raceBlocks(html)) {
    const nameMatch =
      sourceHtml.match(/<a[^>]*>([^<]{4,80})<\/a>/i) ??
      sourceHtml.match(/<h[2-4][^>]*>([^<]{4,80})<\/h[2-4]>/i);
    const dateMatch = sourceHtml.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    const venueMatch = sourceHtml.match(/(?:장소|지역|지역명|장소명)[^<]*?[:：]\s*([^<\n]{2,30})/i);
    const hrefMatch = sourceHtml.match(/href="([^"]+)"/i);

    if (nameMatch?.[1] && dateMatch) {
      races.push({
        name: nameMatch[1].trim(),
        eventDate: `${dateMatch[1]}-${(dateMatch[2] ?? "").padStart(2, "0")}-${(dateMatch[3] ?? "").padStart(2, "0")}`,
        venue: venueMatch?.[1]?.trim() ?? "미상",
        detailUrl: hrefMatch?.[1]
          ? hrefMatch[1].startsWith("http")
            ? hrefMatch[1]
            : `${BASE_URL}${hrefMatch[1]}`
          : BASE_URL,
      });
    }
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
        homeHtml = await fetchWithTimeout(LIST_URL);
      }

      const parsed = parseMarathonMoaHtml(homeHtml);
      const now = new Date().toISOString();
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const discoveredOfficialCandidates: DiscoveredRaceLink[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      let remainingDetailBudget = config.detailBudget ?? DETAIL_BUDGET;

      for (const p of parsed) {
        const detailUrl = safeMarathonMoaDetailUrl(p.detailUrl);
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
          sourceHosts: ["marathon.me.kr", "marathonmoa.com"],
          aggregatorHosts: KNOWN_AGGREGATOR_HOSTS,
          html: detailHtml,
          raceDetailContext: { present: true, sourceDetailUrl: detailUrl },
        });
        if (links.length === 0) rejectedCandidates += 1;
        discoveredOfficialCandidates.push(...links);

        if (config.fixtureDir === undefined) await sleep(INTER_FETCH_DELAY_MS);
      }

      return {
        discoveryCandidates,
        discoveredOfficialCandidates,
        metadata: successMetadata(
          id,
          discoveryCandidates.length,
          discoveryCandidates.length > 0
            ? `Collected ${discoveryCandidates.length} Marathon Moa source-detail candidates`
            : "No safe Marathon Moa source-detail candidates found in homepage",
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
        metadata: failedMetadata(id, true, `Marathon Moa failed: ${message}`),
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
