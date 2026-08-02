import type { TraversalSeed } from "../adapters/types.js";
import type { UrlFetchPurpose } from "./url-policy.js";

export type QueueEntry = {
  readonly url: string;
  readonly depth: 2 | 3;
  readonly purpose: UrlFetchPurpose;
  readonly seedKind: TraversalSeed["kind"] | "child";
  readonly originSeed: TraversalSeed;
};

export function seedQueue(seeds: readonly TraversalSeed[]): QueueEntry[] {
  return [...seeds]
    .map(
      (seed): QueueEntry => ({
        url: seed.url,
        depth: 2,
        purpose: purposeForSeed(seed),
        seedKind: seed.kind,
        originSeed: seed,
      }),
    )
    .sort((left, right) => left.url.localeCompare(right.url));
}

export function childQueueEntry(parent: QueueEntry, url: string): QueueEntry {
  return {
    url,
    depth: 3,
    purpose: "official",
    seedKind: "child",
    originSeed: parent.originSeed,
  };
}

export function canonicalFetchedUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.+$/u, "");
  return parsed.toString();
}

function purposeForSeed(seed: TraversalSeed): UrlFetchPurpose {
  switch (seed.kind) {
    case "official":
      return "official";
    case "application":
      return "traversal";
    default:
      return assertNever(seed);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected traversal seed variant: ${JSON.stringify(value)}`);
}
