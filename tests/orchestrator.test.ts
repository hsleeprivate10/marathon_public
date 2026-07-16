import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollectionOutputSchema } from "../src/contract.js";
import { collect } from "../src/orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const TMP_DIR = resolve(__dirname, "__tmp_output__");

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("orchestrator", () => {
  it("runs all adapters and produces valid races.json", async () => {
    const result = await collect({
      projectRoot: TMP_DIR,
      fixtureBaseDir: FIXTURES_DIR,
    });

    const parsed = CollectionOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);

    // Should have metadata for all 8 sources
    expect(result.collectionMetadata).toHaveLength(8);
    expect(result.generatedAt).toBeTruthy();
  });

  it("writes a valid JSON file", async () => {
    await collect({
      projectRoot: TMP_DIR,
      fixtureBaseDir: FIXTURES_DIR,
    });

    const content = await readFile(resolve(TMP_DIR, "public", "races.json"), "utf-8");
    const parsed = CollectionOutputSchema.safeParse(JSON.parse(content));
    expect(parsed.success).toBe(true);
  });

  it("includes successful adapter results in races", async () => {
    const result = await collect({
      projectRoot: TMP_DIR,
      fixtureBaseDir: FIXTURES_DIR,
    });

    // At least one adapter should succeed (gorunning, emarathon, etc.)
    const successful = result.collectionMetadata.filter((m) => m.succeeded);
    expect(successful.length).toBeGreaterThanOrEqual(1);

    // Races should be present from successful adapters
    expect(result.races.length).toBeGreaterThanOrEqual(1);
  });

  it("records failures in collectionMetadata without breaking output", async () => {
    const result = await collect({
      projectRoot: TMP_DIR,
      fixtureBaseDir: FIXTURES_DIR,
    });

    // All 8 metadata entries should exist regardless of success/failure
    const ids = result.collectionMetadata.map((m) => m.id);
    expect(ids).toContain("gorunning");
    expect(ids).toContain("kormarathon");
    expect(ids).toContain("emarathon");
    expect(ids).toContain("maedal");
    expect(ids).toContain("kaaf");
    expect(ids).toContain("marathonmoa");
    expect(ids).toContain("runningmap");
    expect(ids).toContain("marathonmate");
  });

  it("deduplicates races across sources", async () => {
    const result = await collect({
      projectRoot: TMP_DIR,
      fixtureBaseDir: FIXTURES_DIR,
    });

    // Check that no two races have the same normalized name + date
    const seen = new Set<string>();
    for (const race of result.races) {
      const key = `${race.name}|${race.eventDate}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("sorts races by eventDate ascending", async () => {
    const result = await collect({
      projectRoot: TMP_DIR,
      fixtureBaseDir: FIXTURES_DIR,
    });

    for (let i = 1; i < result.races.length; i++) {
      const prev = result.races[i - 1];
      const curr = result.races[i];
      if (prev && curr) {
        expect(prev.eventDate.localeCompare(curr.eventDate)).toBeLessThanOrEqual(0);
      }
    }
  });
});
