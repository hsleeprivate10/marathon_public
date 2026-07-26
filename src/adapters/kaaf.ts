/**
 * KAAF adapter — legacy ASP, verification only.
 *
 * KAAF (kaaf.or.kr) is a classic ASP site with legacy encoding (EUC-KR).
 * List entries are source-detail discovery hints only; final publication must
 * come from an accepted official event page.
 */
import { readFile } from "node:fs/promises";
import type { Race } from "../contract.js";
import {
  KNOWN_AGGREGATOR_HOSTS,
  isGenericHomepageUrl,
} from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import { detailFixtureName, safeKaafDetailUrl } from "./detail-source-url.js";
import {
  type AdapterResult,
  type CollectConfig,
  type DiscoveredRaceLink,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  failedMetadata,
  fetchWithTimeout,
  sourceDetailUrl,
  sourceId,
  sourceResultUrl,
  successMetadata,
  transientIdentityHint,
} from "./types.js";

const BASE_URL = "https://m.kaaf.or.kr";
const LIST_URL = `${BASE_URL}/mobile/info/inside_all.asp`;
const DETAIL_BUDGET = 20;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const EUC_KR_DECODER = new TextDecoder("euc-kr");
const RESULT_PATH_TOKENS = new Set(["record", "records", "result", "results", "timing"]);

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
          detailUrl: new URL(href, LIST_URL).toString(),
          sourceHtml,
        });
      }
    }
    match = linkPattern.exec(html);
  }

  return races;
}

function decodeKaafFixture(bytes: Uint8Array): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return EUC_KR_DECODER.decode(bytes);
    throw error;
  }
}

async function readKaafFixture(fixtureDir: string, filename: string): Promise<string> {
  return decodeKaafFixture(await readFile(`${fixtureDir}/${filename}`));
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

function isKaafOfficialCandidate(link: DiscoveredRaceLink): boolean {
  if (link.kind !== "official-site") return false;
  if (isGenericHomepageUrl(link.url)) return false;
  const path = new URL(link.url).pathname.toLowerCase();
  return !path.split(/[\/._-]+/u).some((segment) => RESULT_PATH_TOKENS.has(segment));
}

export const KaafAdapter: SourceAdapter = {
  id: "kaaf",
  name: "KAAF",
  baseUrl: BASE_URL,
  allowedPaths: ["/mobile/info/inside_all.asp", "/mobile/info/inside_view.asp"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      let homeHtml: string;
      if (config.fixtureDir) {
        homeHtml = await readKaafFixture(config.fixtureDir, "home.html");
      } else {
        homeHtml = await fetchWithTimeout(LIST_URL);
      }

      const parsed = parseKaafHtml(homeHtml);
      const now = new Date().toISOString();
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const discoveredOfficialCandidates: DiscoveredRaceLink[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      let remainingDetailBudget = config.detailBudget ?? DETAIL_BUDGET;

      for (const p of parsed) {
        const detailUrl = safeKaafDetailUrl(p.detailUrl);
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
            ? await readKaafFixture(config.fixtureDir, detailFixtureName(detailUrl, BASE_URL))
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
          sourceHosts: ["m.kaaf.or.kr", "kaaf.or.kr"],
          aggregatorHosts: KNOWN_AGGREGATOR_HOSTS,
          html: detailHtml,
          raceDetailContext: { present: true, sourceDetailUrl: detailUrl },
        }).filter(isKaafOfficialCandidate);
        if (links.length === 0) rejectedCandidates += 1;
        discoveredOfficialCandidates.push(...links);
      }

      const message =
        discoveryCandidates.length > 0
          ? `Collected ${discoveryCandidates.length} KAAF source-detail candidates`
          : "No safe KAAF source-detail candidates found in homepage";

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
        metadata: failedMetadata(id, true, `KAAF failed: ${message}`),
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
