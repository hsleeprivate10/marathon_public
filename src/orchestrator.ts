/**
 * Collection orchestrator — runs all adapters sequentially, deduplicates,
 * computes registration status, sorts, validates, and writes races.json.
 *
 * All adapter failures are recorded in collectionMetadata but never break output.
 * A valid JSON file is always written, even if every adapter fails.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { adapters } from "./adapters/index.js";
import type { CollectConfig } from "./adapters/types.js";
import { CollectionOutputSchema, type Race, type SourceRecord } from "./contract.js";
import { computeRegistrationStatus } from "./contract.js";
import { deduplicateRaces, sortRaces } from "./normalize.js";

export interface OrchestratorOptions {
  /** Root of the project (for public/races.json output) */
  readonly projectRoot: string;
  /** If provided, adapters read from local fixtures instead of live fetching */
  readonly fixtureBaseDir: string | undefined;
}

/**
 * Run the full collection pipeline and write public/races.json.
 * Returns the parsed and validated output.
 */
export async function collect(
  options: OrchestratorOptions,
): Promise<ReturnType<typeof CollectionOutputSchema.parse>> {
  const generatedAt = new Date().toISOString();
  const metadata: SourceRecord[] = [];
  const allRaces: Race[] = [];

  // Run adapters sequentially (rate-limit courtesy)
  for (const adapter of adapters) {
    const fixtureDir = options.fixtureBaseDir
      ? join(options.fixtureBaseDir, adapter.id)
      : undefined;

    const config: CollectConfig = {
      fixtureDir: fixtureDir ?? undefined,
      detailBudget: undefined,
    };

    const result = await adapter.collect(config);
    metadata.push(result.metadata);

    // Only include successfully collected races
    if (result.metadata.succeeded) {
      allRaces.push(...result.races.map((r) => ({ ...r, generatedAt })));
    }
  }

  // Deduplicate and sort
  const deduped = deduplicateRaces(allRaces);

  // Recompute registration status for all races (may have changed since collection)
  const refreshed: Race[] = deduped.map((race) => ({
    ...race,
    registrationStatus: computeRegistrationStatus(race.registrationDeadline, race.eventDate),
    generatedAt,
    updatedAt: race.updatedAt || generatedAt,
  }));

  const sorted = sortRaces(refreshed);

  const output = {
    generatedAt,
    races: sorted,
    collectionMetadata: metadata,
  };

  // Validate before write
  const validated = CollectionOutputSchema.parse(output);

  // Write to public/races.json
  await mkdir(join(options.projectRoot, "public"), { recursive: true });
  const outPath = join(options.projectRoot, "public", "races.json");
  await writeFile(outPath, JSON.stringify(validated, null, 2), "utf-8");

  return validated;
}
