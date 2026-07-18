/**
 * collect command — runs all source adapters and writes public/races.json.
 *
 * Usage:
 *   bun run src/collect.ts              # live collection (future)
 *   bun run src/collect.ts --fixture <dir>  # offline from fixtures
 */
import { relative, resolve } from "node:path";
import { collect } from "./orchestrator.js";

const args = process.argv.slice(2);
const fixtureIdx = args.indexOf("--fixture");
const fixtureBaseDir =
  fixtureIdx >= 0 && args[fixtureIdx + 1] ? resolve(args[fixtureIdx + 1] ?? "") : undefined;

const projectRoot = resolve(import.meta.dir, "..");
const outputPath =
  fixtureBaseDir === undefined
    ? resolve(projectRoot, "public", "races.json")
    : resolve(projectRoot, ".tmp", "races.fixture.json");

console.log("Starting marathon data collection...");

const result = await collect({
  projectRoot,
  fixtureBaseDir: fixtureBaseDir ?? undefined,
  outputPath,
});

const succeeded = result.collectionMetadata.filter((m) => m.succeeded).length;
const failed = result.collectionMetadata.filter((m) => !m.succeeded && m.attempted).length;
const total = result.collectionMetadata.length;

console.log("\nCollection complete.");
console.log(`  Sources: ${succeeded}/${total} succeeded, ${failed} failed`);
console.log(`  Races: ${result.races.length} (deduplicated)`);
console.log(`  Output: ${relative(projectRoot, outputPath)}`);

// Log per-source metadata
for (const m of result.collectionMetadata) {
  const status = m.succeeded ? "OK" : m.attempted ? "FAIL" : "SKIP";
  console.log(`  [${status}] ${m.id}: ${m.message}`);
}

const sourceMetadata = result.collectionMetadata.filter((item) => item.id !== "official-sites");
if (!sourceMetadata.some((item) => item.succeeded)) {
  console.error("\nAll sources failed. Output file is valid but empty.");
  process.exit(1);
}
