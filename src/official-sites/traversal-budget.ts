export type TraversalRunBudgetOptions = {
  readonly maxFetches?: number;
  readonly maxFetchesPerHost?: number;
};

export type TraversalBudgetReservation =
  | { readonly kind: "reserved" }
  | { readonly kind: "run-budget" }
  | { readonly kind: "host-budget" };

export type TraversalRunBudget = {
  readonly reserve: (url: string) => TraversalBudgetReservation;
  readonly usedFetches: () => number;
};

type TraversalRunBudgetState = {
  fetches: number;
  readonly hostFetches: Map<string, number>;
};

const DEFAULT_MAX_FETCHES = 40;
const DEFAULT_MAX_FETCHES_PER_HOST = 10;

export function createTraversalRunBudget(
  options: TraversalRunBudgetOptions = {},
): TraversalRunBudget {
  const maxFetches = options.maxFetches ?? DEFAULT_MAX_FETCHES;
  const maxFetchesPerHost = options.maxFetchesPerHost ?? DEFAULT_MAX_FETCHES_PER_HOST;
  const state: TraversalRunBudgetState = { fetches: 0, hostFetches: new Map() };
  return {
    reserve: (url) => reserveFetch(url, maxFetches, maxFetchesPerHost, state),
    usedFetches: () => state.fetches,
  };
}

function reserveFetch(
  url: string,
  maxFetches: number,
  maxFetchesPerHost: number,
  state: TraversalRunBudgetState,
): TraversalBudgetReservation {
  if (state.fetches >= maxFetches) return { kind: "run-budget" };
  const host = hostname(url);
  const hostFetches = state.hostFetches.get(host) ?? 0;
  if (hostFetches >= maxFetchesPerHost) return { kind: "host-budget" };
  state.fetches += 1;
  state.hostFetches.set(host, hostFetches + 1);
  return { kind: "reserved" };
}

function hostname(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/\.+$/u, "");
}
