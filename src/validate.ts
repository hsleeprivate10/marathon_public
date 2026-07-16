/**
 * validate command — validates an existing races.json file against the schema.
 *
 * Usage:
 *   bun run src/validate.ts                    # validate public/races.json
 *   bun run src/validate.ts --file <path>      # validate a specific file
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CollectionOutputSchema } from "./contract.js";

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const filePath =
  fileIdx >= 0 && args[fileIdx + 1]
    ? resolve(args[fileIdx + 1] ?? "")
    : resolve(import.meta.dir, "..", "public", "races.json");

try {
  const raw = await readFile(filePath, "utf-8");
  const validated = CollectionOutputSchema.parse(JSON.parse(raw));

  console.log(`Valid: ${filePath}`);
  console.log(`  Generated: ${validated.generatedAt}`);
  console.log(`  Races: ${validated.races.length}`);
  console.log(`  Sources: ${validated.collectionMetadata.length}`);

  const failed = validated.collectionMetadata.filter((m) => !m.succeeded).length;
  if (failed > 0) {
    console.log(`  Warning: ${failed} source(s) failed during collection`);
  }

  process.exit(0);
} catch (error) {
  if (error instanceof Error) {
    console.error(`Validation failed: ${error.message}`);
  } else {
    console.error(`Validation failed: ${String(error)}`);
  }
  process.exit(1);
}
