/**
 * Collection orchestrator — runs all adapters sequentially, deduplicates,
 * computes registration status, sorts, validates, and writes races.json.
 *
 * All adapter failures are recorded in collectionMetadata but never break output.
 * A valid JSON file is always written, even if every adapter fails.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { adapters } from "./adapters/index.js";
import {
  type CollectConfig,
  type DiscoveredRaceLink,
  INTER_FETCH_DELAY_MS,
  type SourceAdapter,
  failedMetadata,
  sleep,
} from "./adapters/types.js";
import { CollectionOutputSchema, type Race, RaceSchema, type SourceRecord } from "./contract.js";
import { computeRegistrationStatus } from "./contract.js";
import { dedupKey, deduplicateRaceCollection, sortRaces } from "./normalize.js";
import { type OfficialPageLoader, enrichOfficialSites } from "./official-sites/enrichment.js";
import { fetchOfficialPage } from "./official-sites/fetch.js";
import { createFixtureOfficialPageLoader } from "./official-sites/fixture-loader.js";

const OFFICIAL_FETCH_BUDGET = 40;

export interface OrchestratorOptions {
  /** Root of the project (for public/races.json output) */
  readonly projectRoot: string;
  /** If provided, adapters read from local fixtures instead of live fetching */
  readonly fixtureBaseDir: string | undefined;
  readonly outputPath?: string;
}

export interface OrchestratorInternals {
  readonly adapters?: readonly SourceAdapter[];
  readonly now?: () => string;
  readonly fetchOfficialPage?: typeof fetchOfficialPage;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly courtesyDelayMs?: number;
}

/**
 * Run the full collection pipeline and write public/races.json.
 * Returns the parsed and validated output.
 */
export async function collect(
  options: OrchestratorOptions,
  internals: OrchestratorInternals = {},
): Promise<ReturnType<typeof CollectionOutputSchema.parse>> {
  const generatedAt = internals.now?.() ?? new Date().toISOString();
  const metadata: SourceRecord[] = [];
  const allRaces: Race[] = [];
  const discoveredLinks: DiscoveredRaceLink[] = [];

  // Run adapters sequentially (rate-limit courtesy)
  for (const adapter of internals.adapters ?? adapters) {
    const fixtureDir = options.fixtureBaseDir
      ? join(options.fixtureBaseDir, adapter.id)
      : undefined;

    const config: CollectConfig = {
      fixtureDir: fixtureDir ?? undefined,
      detailBudget: undefined,
    };

    let result: Awaited<ReturnType<SourceAdapter["collect"]>>;
    try {
      result = await adapter.collect(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      metadata.push(failedMetadata(adapter.id, true, message));
      continue;
    }
    metadata.push(result.metadata);

    // Only include successfully collected races
    if (result.metadata.succeeded) {
      const validRaces = result.races.flatMap((race) => {
        const parsed = RaceSchema.safeParse({ ...race, generatedAt });
        return parsed.success ? [parsed.data] : [];
      });
      allRaces.push(...validRaces);
      const normalizedKeys = new Map(
        validRaces.map((race) => [
          dedupKey(race),
          dedupKey({ ...race, name: race.name.replaceAll("&amp;", "&") }),
        ]),
      );
      discoveredLinks.push(
        ...result.discoveredLinks.map((link) => ({
          ...link,
          dedupKey: normalizedKeys.get(link.dedupKey) ?? link.dedupKey,
        })),
      );
    }
  }

  // Deduplicate and sort
  const deduplicated = deduplicateRaceCollection(allRaces);
  const deduped = deduplicated.races;
  const reboundLinks = discoveredLinks.map((link) => ({
    ...link,
    dedupKey: deduplicated.aliases.get(link.dedupKey) ?? link.dedupKey,
  }));

  // Recompute registration status for all races (may have changed since collection)
  const refreshed: Race[] = deduped.map((race) => ({
    ...race,
    registrationStatus: computeRegistrationStatus(race.registrationDeadline, race.eventDate),
    generatedAt,
    updatedAt: race.updatedAt || generatedAt,
  }));

  let enriched = refreshed;
  try {
    let fixtureFailure: string | null = null;
    let fixtureLoader: OfficialPageLoader | undefined;
    if (options.fixtureBaseDir !== undefined) {
      try {
        fixtureLoader = await createFixtureOfficialPageLoader(
          join(options.fixtureBaseDir, "official-sites"),
        );
      } catch (error) {
        fixtureFailure = error instanceof Error ? error.message : String(error);
        fixtureLoader = async (url) => ({ kind: "failed", url, reason: "fixture-index" });
      }
    }
    const liveFetch = internals.fetchOfficialPage ?? fetchOfficialPage;
    const loadPage: OfficialPageLoader = fixtureLoader ?? ((url) => liveFetch(url));
    const result = await enrichOfficialSites(refreshed, reboundLinks, {
      today: generatedAt.slice(0, 10),
      verifiedAt: generatedAt,
      maxFetches: OFFICIAL_FETCH_BUDGET,
      courtesyDelayMs:
        fixtureLoader === undefined ? (internals.courtesyDelayMs ?? INTER_FETCH_DELAY_MS) : 0,
      loadPage,
      sleep: internals.sleep ?? sleep,
    });
    enriched = [...result.races];
    metadata.push({
      id: "official-sites",
      attempted: true,
      succeeded: fixtureFailure === null,
      recordCount: result.counts.accepted,
      message: `${enrichmentMessage(result.counts)}${
        fixtureFailure === null ? "" : ` error=${fixtureFailure}`
      }`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    metadata.push({
      id: "official-sites",
      attempted: true,
      succeeded: false,
      recordCount: 0,
      message: `candidate=0 fetched=0 accepted=0 rejected=0 budgetSkipped=0 error=${message}`,
    });
  }

  const sorted = sortRaces(enriched);

  if (options.fixtureBaseDir === undefined) {
    const sourceMetadata = metadata.filter((item) => item.id !== "official-sites");
    if (!sourceMetadata.some((item) => item.succeeded) || sorted.length === 0) {
      throw new Error(
        "Live collection produced no publishable race data; existing output preserved",
      );
    }
  }

  const output = {
    generatedAt,
    races: sorted,
    collectionMetadata: metadata,
  };

  // Validate before write
  const validated = CollectionOutputSchema.parse(output);

  const outPath = options.outputPath ?? join(options.projectRoot, "public", "races.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(validated, null, 2), "utf-8");

  return validated;
}

function enrichmentMessage(counts: {
  readonly candidate: number;
  readonly fetched: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly budgetSkipped: number;
}): string {
  return `candidate=${counts.candidate} fetched=${counts.fetched} accepted=${counts.accepted} rejected=${counts.rejected} budgetSkipped=${counts.budgetSkipped}`;
}
