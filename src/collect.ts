/**
 * collect command — runs all source adapters and writes public/races.json.
 *
 * Usage:
 *   bun run src/collect.ts              # live collection (future)
 *   bun run src/collect.ts --fixture <dir>  # offline from fixtures
 */
import { resolve } from "node:path";
import { collect } from "./orchestrator.js";

const args = process.argv.slice(2);
const fixtureIdx = args.indexOf("--fixture");
const fixtureBaseDir =
  fixtureIdx >= 0 && args[fixtureIdx + 1] ? resolve(args[fixtureIdx + 1] ?? "") : undefined;

const projectRoot = resolve(import.meta.dir, "..");

console.log("Starting marathon data collection...");

const result = await collect({
  projectRoot,
  fixtureBaseDir: fixtureBaseDir ?? undefined,
});

const succeeded = result.collectionMetadata.filter((m) => m.succeeded).length;
const failed = result.collectionMetadata.filter((m) => !m.succeeded && m.attempted).length;
const total = result.collectionMetadata.length;

console.log("\nCollection complete.");
console.log(`  Sources: ${succeeded}/${total} succeeded, ${failed} failed`);
console.log(`  Races: ${result.races.length} (deduplicated)`);
console.log("  Output: public/races.json");

// Log per-source metadata
for (const m of result.collectionMetadata) {
  const status = m.succeeded ? "OK" : m.attempted ? "FAIL" : "SKIP";
  console.log(`  [${status}] ${m.id}: ${m.message}`);
}

if (failed === total) {
  console.error("\nAll sources failed. Output file is valid but empty.");
  process.exit(1);
}
