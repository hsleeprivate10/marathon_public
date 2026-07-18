import type { DiscoveredRaceLink } from "../adapters/types.js";
import type { Race } from "../contract.js";
import { dedupKey } from "../normalize.js";
import { safeApplicationUrl, safeOfficialPageUrl } from "./application-url-policy.js";
import { mergeOfficialPage } from "./merge.js";
import { parseOfficialPage } from "./parser.js";

export type OfficialPageLoadResult =
  | { readonly kind: "success"; readonly url: string; readonly body: string }
  | { readonly kind: "rejected"; readonly url: string; readonly reason: string }
  | { readonly kind: "failed"; readonly url: string; readonly reason: string }
  | {
      readonly kind: "skipped";
      readonly url: string;
      readonly reason: "missing-mapping" | "missing-file";
    };

export type OfficialPageLoader = (url: string) => Promise<OfficialPageLoadResult>;

export type EnrichmentCounts = {
  readonly candidate: number;
  readonly fetched: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly budgetSkipped: number;
};

export type OfficialEnrichmentOptions = {
  readonly today: string;
  readonly verifiedAt: string;
  readonly maxFetches: number;
  readonly courtesyDelayMs: number;
  readonly loadPage: OfficialPageLoader;
  readonly sleep: (milliseconds: number) => Promise<void>;
};

export type OfficialEnrichmentResult = {
  readonly races: readonly Race[];
  readonly counts: EnrichmentCounts;
};

type CandidateGroup = {
  readonly official: readonly DiscoveredRaceLink[];
  readonly application: readonly DiscoveredRaceLink[];
};

export async function enrichOfficialSites(
  races: readonly Race[],
  discoveredLinks: readonly DiscoveredRaceLink[],
  options: OfficialEnrichmentOptions,
): Promise<OfficialEnrichmentResult> {
  const groups = groupCandidates(discoveredLinks);
  const updated = new Map<string, Race>();
  for (const race of races) {
    const application = groups
      .get(dedupKey(race))
      ?.application.map((item) => safeApplicationUrl(item.url))
      .find((url) => url !== null);
    updated.set(
      dedupKey(race),
      application === undefined ? race : { ...race, applicationUrl: application },
    );
  }

  const eligible = races
    .filter((race) => {
      const group = groups.get(dedupKey(race));
      return race.eventDate >= options.today && group !== undefined && group.official.length > 0;
    })
    .sort((left, right) => {
      const date = left.eventDate.localeCompare(right.eventDate);
      return date === 0 ? left.name.localeCompare(right.name, "ko-KR") : date;
    });
  const delayedHosts = new Set<string>();
  const candidate = eligible.reduce(
    (count, race) => count + (groups.get(dedupKey(race))?.official.length ?? 0),
    0,
  );
  let fetched = 0;
  let accepted = 0;
  let rejected = 0;
  let budgetSkipped = 0;

  for (const original of eligible) {
    const key = dedupKey(original);
    const race = updated.get(key) ?? original;
    const candidates = groups.get(key)?.official ?? [];
    if (fetched >= options.maxFetches) {
      budgetSkipped += candidates.length;
      continue;
    }
    for (const [index, candidate] of candidates.entries()) {
      if (fetched >= options.maxFetches) {
        budgetSkipped += candidates.length - index;
        break;
      }
      if (safeOfficialPageUrl(candidate.url) === null) {
        rejected += 1;
        continue;
      }
      const hostname = safeHostname(candidate.url);
      if (hostname !== null && options.courtesyDelayMs > 0 && delayedHosts.has(hostname)) {
        await options.sleep(options.courtesyDelayMs);
      }
      if (hostname !== null) delayedHosts.add(hostname);
      fetched += 1;
      let loaded: OfficialPageLoadResult;
      try {
        loaded = await options.loadPage(candidate.url);
      } catch {
        rejected += 1;
        continue;
      }
      if (loaded.kind !== "success") {
        rejected += 1;
        continue;
      }
      const merged = mergeOfficialPage(
        race,
        parseOfficialPage(loaded.body, loaded.url),
        loaded.url,
        options.verifiedAt,
      );
      if (!merged.accepted) {
        rejected += 1;
        continue;
      }
      updated.set(key, merged.race);
      accepted += 1;
      break;
    }
  }

  return {
    races: races.map((race) => updated.get(dedupKey(race)) ?? race),
    counts: { candidate, fetched, accepted, rejected, budgetSkipped },
  };
}

function groupCandidates(links: readonly DiscoveredRaceLink[]): Map<string, CandidateGroup> {
  const grouped = new Map<
    string,
    { official: DiscoveredRaceLink[]; application: DiscoveredRaceLink[] }
  >();
  const seen = new Set<string>();
  for (const link of links) {
    if (safeApplicationUrl(link.url) === null) continue;
    const uniqueKey = `${link.dedupKey}\u0000${link.kind}\u0000${link.url}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    const group = grouped.get(link.dedupKey) ?? { official: [], application: [] };
    if (link.kind === "official-site") group.official.push(link);
    else group.application.push(link);
    grouped.set(link.dedupKey, group);
  }
  return grouped;
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}
