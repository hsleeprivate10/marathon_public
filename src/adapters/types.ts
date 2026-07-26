import { readFile } from "node:fs/promises";
import ky from "ky";
import { z } from "zod";
import type { SourceRecord } from "../contract.js";
import {
  safeOfficialPageUrl,
  safeRaceApplicationUrl,
} from "../official-sites/application-url-policy.js";

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

const SourceIdSchema = z.string().min(1).brand<"SourceId">();
const SourceResultUrlSchema = z.string().url().brand<"SourceResultUrl">();
const SourceDetailUrlSchema = z.string().url().brand<"SourceDetailUrl">();
const TransientIdentityHintSchema = z.string().min(1).brand<"TransientIdentityHint">();
const DiscoveredOfficialUrlSchema = z.string().url().brand<"DiscoveredOfficialUrl">();
const DiscoveredApplicationUrlSchema = z.string().url().brand<"DiscoveredApplicationUrl">();

export type SourceId = z.infer<typeof SourceIdSchema>;
export type SourceResultUrl = z.infer<typeof SourceResultUrlSchema>;
export type SourceDetailUrl = z.infer<typeof SourceDetailUrlSchema>;
export type TransientIdentityHint = z.infer<typeof TransientIdentityHintSchema>;
export type DiscoveredOfficialUrl = z.infer<typeof DiscoveredOfficialUrlSchema>;
export type DiscoveredApplicationUrl = z.infer<typeof DiscoveredApplicationUrlSchema>;

export function sourceId(value: string): SourceId {
  return SourceIdSchema.parse(value);
}

export function sourceResultUrl(value: string): SourceResultUrl {
  return SourceResultUrlSchema.parse(value);
}

export function sourceDetailUrl(value: string): SourceDetailUrl {
  return SourceDetailUrlSchema.parse(value);
}

export function transientIdentityHint(value: string): TransientIdentityHint {
  return TransientIdentityHintSchema.parse(value);
}

export function discoveredOfficialUrl(value: string): DiscoveredOfficialUrl | null {
  const safeUrl = safeRaceApplicationUrl(value);
  return safeUrl === null ? null : DiscoveredOfficialUrlSchema.parse(safeUrl);
}

export function discoveredOfficialHomepageUrl(value: string): DiscoveredOfficialUrl | null {
  const safeUrl = safeOfficialPageUrl(value);
  return safeUrl === null ? null : DiscoveredOfficialUrlSchema.parse(safeUrl);
}

export function discoveredApplicationUrl(value: string): DiscoveredApplicationUrl | null {
  const safeUrl = safeRaceApplicationUrl(value);
  return safeUrl === null ? null : DiscoveredApplicationUrlSchema.parse(safeUrl);
}

export type TransientRaceIdentityEvidence = {
  readonly titleHints: readonly TransientIdentityHint[];
  readonly dateHints: readonly TransientIdentityHint[];
  readonly organizerHints: readonly TransientIdentityHint[];
};

export type SourceDiscoveryCandidate = {
  readonly sourceId: SourceId;
  readonly sourceResultUrl?: SourceResultUrl;
  readonly sourceDetailUrl: SourceDetailUrl;
  readonly identityEvidence: TransientRaceIdentityEvidence;
};

type DiscoveredRaceLinkBase = {
  readonly dedupKey: TransientIdentityHint;
  readonly sourceId: SourceId;
  readonly sourceResultUrl?: SourceResultUrl;
  readonly sourceDetailUrl?: SourceDetailUrl;
  readonly identityEvidence: TransientRaceIdentityEvidence;
  readonly evidence: "explicit-label" | "structured-event" | "structured-organizer";
};

export type DiscoveredRaceLink =
  | (DiscoveredRaceLinkBase & {
      readonly kind: "official-site";
      readonly url: DiscoveredOfficialUrl;
    })
  | (DiscoveredRaceLinkBase & {
      readonly kind: "application";
      readonly url: DiscoveredApplicationUrl;
    });

export type AdapterStageCounters = {
  readonly discoveryCandidates: number;
  readonly sourceDetailsFetched: number;
  readonly discoveredOfficialCandidates: number;
  readonly rejectedCandidates: number;
  readonly budgetSkipped: number;
};

export interface AdapterResult {
  readonly discoveryCandidates: readonly SourceDiscoveryCandidate[];
  readonly discoveredOfficialCandidates: readonly DiscoveredRaceLink[];
  readonly metadata: SourceRecord;
  readonly stageCounters: AdapterStageCounters;
}

export function preferredDiscoveredRaceUrl(
  links: readonly DiscoveredRaceLink[],
): string | undefined {
  for (const link of links) {
    if (link.kind !== "application") continue;
    const safeUrl = safeRaceApplicationUrl(link.url);
    if (safeUrl !== null) return safeUrl;
  }
  return undefined;
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
