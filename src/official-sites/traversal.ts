import type { TraversalSeed } from "../adapters/types.js";
import type { Race } from "../contract.js";
import { safeOfficialPageUrl } from "./application-url-policy.js";
import { type OfficialFetchResult, fetchOfficialPage } from "./fetch.js";
import { type IdentityOutcome, checkOfficialPageIdentity } from "./identity.js";
import { type OfficialPageData, parseOfficialPage } from "./parser.js";
import {
  type TraversalRunBudget,
  type TraversalRunBudgetOptions,
  createTraversalRunBudget,
} from "./traversal-budget.js";
import { discoverTraversalChildLinks } from "./traversal-links.js";
import {
  type QueueEntry,
  canonicalFetchedUrl,
  childQueueEntry,
  seedQueue,
} from "./traversal-queue.js";
import { traversalRejectionBucket } from "./traversal-reasons.js";
import type { UrlFetchPurpose } from "./url-policy.js";

export { createTraversalRunBudget } from "./traversal-budget.js";
export type { TraversalRunBudget } from "./traversal-budget.js";

export type TraversalFetchPage = (
  url: string,
  purpose: UrlFetchPurpose,
) => Promise<OfficialFetchResult>;

export type TraversalAcceptedPage = {
  readonly finalUrl: string;
  readonly depth: 2 | 3;
  readonly originSeed: TraversalSeed;
  readonly matchedRace: Race;
  readonly page: OfficialPageData;
  readonly identity: IdentityOutcome & { readonly accepted: true };
};

export type TraversalCounts = {
  readonly accepted: number;
  readonly fetched: number;
  readonly policy: number;
  readonly fetch: number;
  readonly identity: number;
  readonly depth: number;
  readonly cycle: number;
  readonly hostBudget: number;
  readonly runBudget: number;
};

export type TraversalResult = {
  readonly accepted: readonly TraversalAcceptedPage[];
  readonly counts: TraversalCounts;
};

export type TraverseOfficialRacePagesInput = {
  readonly race: Race;
  readonly raceCandidates?: readonly Race[];
  readonly seeds: readonly TraversalSeed[];
  readonly budget?: TraversalRunBudget;
  readonly budgetOptions?: TraversalRunBudgetOptions;
  readonly verifiedAt: string;
  readonly fetchPage?: TraversalFetchPage;
};

type TraversalState = {
  fetched: number;
  readonly visited: Set<string>;
  readonly queue: QueueEntry[];
  readonly accepted: TraversalAcceptedPage[];
  counts: TraversalCounts;
};

type EnqueueChildrenResult = { readonly foundChild: boolean; readonly handled: boolean };

const MAX_FETCHES_PER_CHAIN = 2;
const MAX_CHILDREN = 3;
export async function traverseOfficialRacePages(
  input: TraverseOfficialRacePagesInput,
): Promise<TraversalResult> {
  const budget = input.budget ?? createTraversalRunBudget(input.budgetOptions);
  const fetchPage = input.fetchPage ?? ((url, purpose) => fetchOfficialPage(url, { purpose }));
  const state: TraversalState = {
    fetched: 0,
    visited: new Set(),
    queue: seedQueue(input.seeds),
    accepted: [],
    counts: emptyCounts(),
  };

  while (state.queue.length > 0) {
    const entry = state.queue.shift();
    if (entry === undefined) continue;
    if (state.visited.has(canonicalFetchedUrl(entry.url))) {
      increment(state, "cycle", 1);
      continue;
    }
    if (state.fetched >= MAX_FETCHES_PER_CHAIN) {
      increment(state, "depth", 1);
      continue;
    }
    const reservation = budget.reserve(entry.url);
    switch (reservation.kind) {
      case "reserved":
        break;
      case "run-budget":
        increment(state, "runBudget", 1);
        continue;
      case "host-budget":
        increment(state, "hostBudget", 1);
        continue;
      default:
        assertNever(reservation);
    }
    await fetchEntry(entry, input.raceCandidates ?? [input.race], fetchPage, state);
  }
  return { accepted: state.accepted, counts: state.counts };
}

async function fetchEntry(
  entry: QueueEntry,
  races: readonly Race[],
  fetchPage: TraversalFetchPage,
  state: TraversalState,
): Promise<void> {
  const fetched = await fetchPage(entry.url, entry.purpose);
  state.fetched += 1;
  increment(state, "fetched", 1);
  switch (fetched.kind) {
    case "success":
      acceptFetchedPage(entry, fetched, races, state);
      return;
    case "rejected":
      increment(state, traversalRejectionBucket(fetched.reason), 1);
      return;
    case "failed":
      increment(state, "fetch", 1);
      return;
    default:
      return assertNever(fetched);
  }
}

function acceptFetchedPage(
  entry: QueueEntry,
  fetched: Extract<OfficialFetchResult, { readonly kind: "success" }>,
  races: readonly Race[],
  state: TraversalState,
): void {
  const finalUrl = canonicalFetchedUrl(fetched.url);
  if (state.visited.has(finalUrl)) {
    increment(state, "cycle", 1);
    return;
  }
  state.visited.add(finalUrl);
  state.visited.add(canonicalFetchedUrl(entry.url));
  const page = parseOfficialPage(fetched.body, finalUrl);
  const matched = firstAcceptedIdentity(races, page);
  if (matched === null) {
    increment(state, "identity", 1);
    return;
  }
  const officialUrl = safeOfficialPageUrl(finalUrl);
  const childResult =
    entry.depth === 2 && entry.seedKind === "application"
      ? enqueueChildren(fetched.body, finalUrl, entry, state)
      : null;
  if (childResult?.foundChild === true) return;
  if (officialUrl !== null) {
    state.accepted.push({
      finalUrl: officialUrl,
      depth: entry.depth,
      originSeed: entry.originSeed,
      matchedRace: matched.race,
      page,
      identity: matched.identity,
    });
    increment(state, "accepted", 1);
    return;
  }
  if (childResult?.handled === true) return;
  if (entry.depth === 2 && enqueueChildren(fetched.body, finalUrl, entry, state).handled) return;
  increment(state, "policy", 1);
}

function firstAcceptedIdentity(
  races: readonly Race[],
  page: OfficialPageData,
): {
  readonly race: Race;
  readonly identity: IdentityOutcome & { readonly accepted: true };
} | null {
  for (const race of races) {
    const identity = checkOfficialPageIdentity(race, page);
    if (identity.accepted) return { race, identity };
  }
  return null;
}

function enqueueChildren(
  html: string,
  pageUrl: string,
  parent: QueueEntry,
  state: TraversalState,
): EnqueueChildrenResult {
  const discovered = discoverTraversalChildLinks(html, pageUrl);
  increment(state, "policy", discovered.policyRejected);
  const links = discovered.links.slice(0, MAX_CHILDREN);
  increment(state, "depth", discovered.links.length - links.length);
  for (const url of links) {
    const canonical = canonicalFetchedUrl(url);
    if (state.visited.has(canonical)) {
      increment(state, "cycle", 1);
      continue;
    }
    state.queue.push(childQueueEntry(parent, url));
  }
  return {
    foundChild: discovered.links.length > 0,
    handled: discovered.links.length > 0 || discovered.policyRejected > 0,
  };
}

function emptyCounts(): TraversalCounts {
  return {
    accepted: 0,
    fetched: 0,
    policy: 0,
    fetch: 0,
    identity: 0,
    depth: 0,
    cycle: 0,
    hostBudget: 0,
    runBudget: 0,
  };
}

function increment(state: TraversalState, key: keyof TraversalCounts, amount: number): void {
  if (amount <= 0) return;
  state.counts = { ...state.counts, [key]: state.counts[key] + amount };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected traversal variant: ${JSON.stringify(value)}`);
}
