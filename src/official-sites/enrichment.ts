import type { Race } from "../contract.js";
import type { OfficialEnrichmentInput } from "./enrichment-groups.js";
import {
  groupTraversalSeedChains,
  materializeAcceptedPage,
  seedRacesForChain,
} from "./enrichment-groups.js";
import type { FetchRejection } from "./fetch.js";
import {
  type TraversalCounts,
  type TraversalFetchPage,
  type TraversalRunBudget,
  createTraversalRunBudget,
  traverseOfficialRacePages,
} from "./traversal.js";
import type { UrlFetchPurpose } from "./url-policy.js";

export type { OfficialEnrichmentInput } from "./enrichment-groups.js";

export type OfficialPageLoadResult =
  | { readonly kind: "success"; readonly url: string; readonly body: string }
  | { readonly kind: "rejected"; readonly url: string; readonly reason: string }
  | { readonly kind: "failed"; readonly url: string; readonly reason: string }
  | {
      readonly kind: "skipped";
      readonly url: string;
      readonly reason: "missing-mapping" | "missing-file";
    };

export type OfficialPageLoader = (
  url: string,
  purpose?: UrlFetchPurpose,
) => Promise<OfficialPageLoadResult>;

export type EnrichmentCounts = {
  readonly seed: number;
  readonly fetched: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly policyRejected: number;
  readonly fetchRejected: number;
  readonly identityRejected: number;
  readonly depthSkipped: number;
  readonly cycleSkipped: number;
  readonly hostBudgetSkipped: number;
  readonly runBudgetSkipped: number;
};

type MutableEnrichmentCounts = { -readonly [Key in keyof EnrichmentCounts]: EnrichmentCounts[Key] };

export type OfficialEnrichmentResult = {
  readonly races: readonly Race[];
  readonly counts: EnrichmentCounts;
};

export type OfficialEnrichmentOptions = {
  readonly today: string;
  readonly verifiedAt: string;
  readonly maxFetches: number;
  readonly courtesyDelayMs: number;
  readonly loadPage: OfficialPageLoader;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly runBudget?: TraversalRunBudget;
};

export async function enrichOfficialSites(
  input: OfficialEnrichmentInput,
  options: OfficialEnrichmentOptions,
): Promise<OfficialEnrichmentResult> {
  const chains = groupTraversalSeedChains(input, options.today);
  const races: Race[] = [];
  const counts = emptyCounts(chains.length);
  const runBudget =
    options.runBudget ?? createTraversalRunBudget({ maxFetches: options.maxFetches });
  const fetchPage = officialTraversalLoader(options);

  for (const chain of chains) {
    const seedRaces = seedRacesForChain(chain, options.verifiedAt);
    const seedRace = seedRaces[0];
    if (seedRace === undefined) {
      counts.rejected += 1;
      counts.identityRejected += 1;
      continue;
    }
    const traversal = await traverseOfficialRacePages({
      race: seedRace,
      raceCandidates: seedRaces,
      seeds: chain.seeds,
      budget: runBudget,
      verifiedAt: options.verifiedAt,
      fetchPage,
    });
    addTraversalCounts(counts, traversal.counts);
    const accepted = materializeFirstAcceptedPage(chain, traversal.accepted, options.verifiedAt);
    if (accepted === null) {
      if (traversal.accepted.length > 0) counts.rejected += 1;
      continue;
    }
    races.push(accepted);
    counts.accepted += 1;
  }

  return { races, counts };
}

function officialTraversalLoader(options: OfficialEnrichmentOptions): TraversalFetchPage {
  const delayedHosts = new Set<string>();
  return async (url, purpose) => {
    const hostname = safeHostname(url);
    if (hostname !== null && options.courtesyDelayMs > 0 && delayedHosts.has(hostname)) {
      await options.sleep(options.courtesyDelayMs);
    }
    if (hostname !== null) delayedHosts.add(hostname);
    try {
      const loaded = await options.loadPage(url, purpose);
      switch (loaded.kind) {
        case "success":
          return {
            kind: "success",
            url: loaded.url,
            address: "fixture",
            contentType: "text/html",
            body: loaded.body,
          };
        case "rejected":
          return rejectionResult(loaded.url, loaded.reason);
        case "failed":
          return { kind: "failed", url: loaded.url, reason: "network" };
        case "skipped":
          return { kind: "failed", url: loaded.url, reason: "network" };
        default:
          return assertNever(loaded);
      }
    } catch (error) {
      if (error instanceof Error) return { kind: "failed", url, reason: "network" };
      throw error;
    }
  };
}

function materializeFirstAcceptedPage(
  chain: Parameters<typeof materializeAcceptedPage>[0],
  pages: readonly Parameters<typeof materializeAcceptedPage>[1][],
  verifiedAt: string,
): Race | null {
  for (const page of pages) {
    const materialized = materializeAcceptedPage(chain, page, verifiedAt);
    if (materialized !== null) return materialized;
  }
  return null;
}

function rejectionResult(url: string, reason: string) {
  const known = knownFetchRejection(reason);
  return known === null
    ? { kind: "failed" as const, url, reason: "network" as const }
    : { kind: "rejected" as const, url, reason: known };
}

function knownFetchRejection(reason: string): FetchRejection | null {
  switch (reason) {
    case "invalid-url":
    case "unsupported-protocol":
    case "credentials":
    case "blocked-hostname":
    case "blocked-address":
    case "unsafe-public-url":
    case "dns-failure":
    case "too-many-redirects":
    case "missing-redirect-location":
    case "http-status":
    case "unsupported-content-type":
    case "body-too-large":
      return reason;
    default:
      return null;
  }
}

function emptyCounts(seed: number): MutableEnrichmentCounts {
  return {
    seed,
    fetched: 0,
    accepted: 0,
    rejected: 0,
    policyRejected: 0,
    fetchRejected: 0,
    identityRejected: 0,
    depthSkipped: 0,
    cycleSkipped: 0,
    hostBudgetSkipped: 0,
    runBudgetSkipped: 0,
  };
}

function addTraversalCounts(counts: MutableEnrichmentCounts, traversal: TraversalCounts): void {
  counts.fetched += traversal.fetched;
  counts.policyRejected += traversal.policy;
  counts.fetchRejected += traversal.fetch;
  counts.identityRejected += traversal.identity;
  counts.depthSkipped += traversal.depth;
  counts.cycleSkipped += traversal.cycle;
  counts.hostBudgetSkipped += traversal.hostBudget;
  counts.runBudgetSkipped += traversal.runBudget;
  counts.rejected += traversal.policy + traversal.fetch + traversal.identity;
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected official page load result: ${JSON.stringify(value)}`);
}
