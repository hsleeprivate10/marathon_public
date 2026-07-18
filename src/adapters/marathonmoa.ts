/**
 * Marathon Moa adapter — supplementary source.
 *
 * Marathon Moa (marathonmoa.com) provides community-sourced race listings.
 * Data quality varies; this adapter extracts what is publicly available.
 */
import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { safeApplicationUrl } from "../official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../official-sites/discovery.js";
import {
  type AdapterResult,
  type CollectConfig,
  type DiscoveredRaceLink,
  INTER_FETCH_DELAY_MS,
  type SourceAdapter,
  failedMetadata,
  fetchWithTimeout,
  readFixture,
  sleep,
  successMetadata,
} from "./types.js";

const BASE_URL = "https://marathon.me.kr";

interface ParsedRace {
  readonly name: string;
  readonly eventDate: string;
  readonly venue: string;
  readonly detailUrl: string;
  readonly sourceHtml: string;
  readonly registrationUrl: string | null;
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
  const registrations = parseMarathonMoaRegistrationUrls(html);

  for (const match of html.matchAll(
    /<a\b[^>]*href="(\/events\/[0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const detailPath = match[1];
    const sourceHtml = match[0];
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
      sourceHtml,
      registrationUrl: registrations.get(detailPath.slice("/events/".length)) ?? null,
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
        sourceHtml,
        registrationUrl: null,
      });
    }
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
      const discoveredLinks: DiscoveredRaceLink[] = [];
      let remainingDetailBudget = config.detailBudget ?? 20;

      for (const p of parsed) {
        const embeddedRegistrationUrl = safeApplicationUrl(p.registrationUrl);
        const race: Race = {
          name: p.name,
          eventDate: p.eventDate,
          registrationDeadline: null,
          venue: p.venue,
          courses: [],
          applicationUrl:
            embeddedRegistrationUrl ?? safeApplicationUrl(p.detailUrl) ?? `${BASE_URL}/events`,
          notes: "Marathon Moa: supplementary community source",
          sources: [id],
          verified: false,
          lastVerified: null,
          updatedAt: now,
          generatedAt: now,
          registrationStatus: computeRegistrationStatus(null, p.eventDate),
        };
        let discoveryHtml = p.sourceHtml;
        if (
          embeddedRegistrationUrl === null &&
          config.fixtureDir === undefined &&
          remainingDetailBudget > 0
        ) {
          try {
            discoveryHtml = await fetchWithTimeout(p.detailUrl);
            remainingDetailBudget -= 1;
            await sleep(INTER_FETCH_DELAY_MS);
          } catch {
            discoveryHtml = p.sourceHtml;
          }
        }
        const links = discoverRaceLinks({
          race,
          sourceId: id,
          sourcePageUrl: p.detailUrl,
          sourceHosts: ["marathon.me.kr", "marathonmoa.com"],
          aggregatorHosts: ["marathon.me.kr", "marathonmoa.com"],
          html: discoveryHtml,
          raceDetailContext: { present: true },
        }).filter((link) => {
          if (link.kind !== "application") return true;
          const hostname = new URL(link.url).hostname;
          return hostname !== "marathon.me.kr" && hostname !== "marathonmoa.com";
        });
        const registrationLink =
          embeddedRegistrationUrl === null
            ? (links.find((link) => link.kind === "application") ??
              links.find((link) => link.kind === "official-site"))
            : undefined;
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
            ? `Collected ${races.length} races from Marathon Moa`
            : "No races found in Marathon Moa homepage",
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        races: [],
        discoveredLinks: [],
        metadata: failedMetadata(id, true, `Marathon Moa failed: ${message}`),
      };
    }
  },
};
