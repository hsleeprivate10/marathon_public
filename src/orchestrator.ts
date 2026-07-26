/**
 * Collection orchestrator — runs all adapters sequentially, deduplicates,
 * materializes official pages, deduplicates, computes registration status, sorts,
 * validates, and writes races.json.
 *
 * All adapter failures are recorded in collectionMetadata but never break output.
 * Live runs preserve the existing output instead of writing an empty file.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { adapters } from "./adapters/index.js";
import {
  type AdapterStageCounters,
  type CollectConfig,
  type DiscoveredRaceLink,
  INTER_FETCH_DELAY_MS,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  failedMetadata,
  sleep,
} from "./adapters/types.js";
import { CollectionOutputSchema, type Race, type SourceRecord } from "./contract.js";
import { computeRegistrationStatus } from "./contract.js";
import { deduplicateRaceCollection, sortRaces } from "./normalize.js";
import {
  type OfficialEnrichmentInput,
  type OfficialPageLoader,
  enrichOfficialSites,
} from "./official-sites/enrichment.js";
import { fetchOfficialPage } from "./official-sites/fetch.js";
import { createFixtureOfficialPageLoader } from "./official-sites/fixture-loader.js";

const OFFICIAL_FETCH_BUDGET = 40;

type AdapterCollection = {
  readonly discoveryCandidates: readonly SourceDiscoveryCandidate[];
  readonly discoveredOfficialCandidates: readonly DiscoveredRaceLink[];
  readonly stageCounters: AdapterStageCounters;
};

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
  const adapterCollections: AdapterCollection[] = [];

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

    if (result.metadata.succeeded) {
      adapterCollections.push({
        discoveryCandidates: result.discoveryCandidates,
        discoveredOfficialCandidates: result.discoveredOfficialCandidates,
        stageCounters: result.stageCounters,
      });
    }
  }

  const officialInput: OfficialEnrichmentInput = {
    discoveryCandidates: adapterCollections.flatMap((collection) => collection.discoveryCandidates),
    discoveredOfficialCandidates: adapterCollections.flatMap(
      (collection) => collection.discoveredOfficialCandidates,
    ),
  };

  let materialized: readonly Race[] = [];
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
    const officialResult = await enrichOfficialSites(officialInput, {
      today: generatedAt.slice(0, 10),
      verifiedAt: generatedAt,
      maxFetches: OFFICIAL_FETCH_BUDGET,
      courtesyDelayMs:
        fixtureLoader === undefined ? (internals.courtesyDelayMs ?? INTER_FETCH_DELAY_MS) : 0,
      loadPage,
      sleep: internals.sleep ?? sleep,
    });
    materialized = officialResult.races;
    metadata.push({
      id: "official-sites",
      attempted: true,
      succeeded: fixtureFailure === null,
      recordCount: officialResult.counts.accepted,
      message: `${enrichmentMessage(officialResult.counts)}${
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

  const deduplicated = deduplicateRaceCollection([...materialized]);
  const refreshed: Race[] = deduplicated.races.map((race) => {
    const publishableRace = { ...race, urlScheme: undefined };
    return {
      ...publishableRace,
      registrationStatus: computeRegistrationStatus(race.registrationDeadline, race.eventDate),
      generatedAt,
      updatedAt: race.updatedAt || generatedAt,
    };
  });
  const sorted = sortRaces(refreshed);

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
