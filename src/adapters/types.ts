import { readFile } from "node:fs/promises";
import ky from "ky";
import type { Race, SourceRecord } from "../contract.js";

/** User-Agent sent with every outbound request */
export const USER_AGENT = "MarathonDataBot/1.0 (+contact: marathon-data-collector)";

/** Per-fetch timeout in milliseconds */
export const FETCH_TIMEOUT_MS = 15_000;

/** Delay between successive fetches from the same source (rate-limit courtesy) */
export const INTER_FETCH_DELAY_MS = 1_000;

/** Maximum number of detail pages to fetch per source in a single run */
export const DEFAULT_DETAIL_BUDGET = 20;

/**
 * Configuration passed to every adapter's collect() method.
 * Allows testing with fixtures (fixtureDir) vs production (live fetch).
 */
export interface CollectConfig {
  /**
   * If provided, adapter reads from this local directory instead of fetching live.
   * Fixture files are expected at `<fixtureDir>/list.html` (or other well-known names).
   */
  readonly fixtureDir: string | undefined;
  /** Override default detail budget per source */
  readonly detailBudget: number | undefined;
}

export interface DiscoveredRaceLink {
  readonly dedupKey: string;
  readonly kind: "official-site" | "application";
  readonly url: string;
  readonly sourceId: string;
  readonly sourcePageUrl: string;
  readonly evidence: "explicit-label" | "structured-event" | "structured-organizer";
}

/**
 * Result of collecting from a single source adapter.
 */
export interface AdapterResult {
  /** Collected (and possibly partial) race records */
  readonly races: ReadonlyArray<Race>;
  readonly discoveredLinks: ReadonlyArray<DiscoveredRaceLink>;
  /** Source metadata for the collectionMetadata array */
  readonly metadata: SourceRecord;
}

/**
 * Every adapter implements this interface.
 *
 * Rules:
 * - collect() must never throw; errors are captured in metadata.
 * - When fixtureDir is provided, NO network requests are made.
 * - Robots-aware paths: only fetch paths allowed in the target site's robots.txt.
 */
export interface SourceAdapter {
  /** Stable identifier (e.g. "gorunning") */
  readonly id: string;
  /** Human-readable name for logging */
  readonly name: string;
  /** Base URL of the source site */
  readonly baseUrl: string;
  /** URL path patterns this adapter is allowed to fetch */
  readonly allowedPaths: ReadonlyArray<string>;
  /** Collect race data from this source */
  collect(config: CollectConfig): Promise<AdapterResult>;
}

/** Simple sleep helper used for inter-fetch delays. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with timeout, User-Agent, and basic error handling. */
export async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  return ky
    .get(url, {
      headers: { "User-Agent": USER_AGENT },
      retry: { limit: 2 },
      timeout: timeoutMs,
    })
    .text();
}

/**
 * Read a fixture file from a directory. Returns the file contents as string.
 * Throws if the file does not exist.
 */
export async function readFixture(fixtureDir: string, filename: string): Promise<string> {
  const path = `${fixtureDir}/${filename}`;
  return readFile(path, "utf8");
}

/**
 * Create a failed metadata record for an adapter that wasn't attempted or errored.
 */
export function failedMetadata(id: string, attempted: boolean, message: string): SourceRecord {
  return {
    id,
    attempted,
    succeeded: false,
    recordCount: 0,
    message,
  };
}

/**
 * Create a successful metadata record.
 */
export function successMetadata(id: string, recordCount: number, message: string): SourceRecord {
  return {
    id,
    attempted: true,
    succeeded: true,
    recordCount,
    message,
  };
}
