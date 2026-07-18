import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "../src/adapters/types.js";
import { CollectionOutputSchema, type Race } from "../src/contract.js";
import { dedupKey } from "../src/normalize.js";
import { collect } from "../src/orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const TMP_DIR = resolve(__dirname, "__tmp_output__");
const NOW = "2026-01-02T03:04:05.000Z";

function race(source: string, name = "중복 공식 대회"): Race {
  return {
    name,
    eventDate: "2026-09-20",
    registrationDeadline: null,
    venue: "미상",
    courses: [],
    applicationUrl: `https://${source}.example/apply`,
    sources: [source],
    verified: true,
    lastVerified: NOW,
    updatedAt: NOW,
    generatedAt: NOW,
    registrationStatus: "unknown",
  };
}

function adapter(id: string, item: Race, officialUrl?: string): SourceAdapter {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.example`,
    allowedPaths: ["/"],
    collect: async () => ({
      races: [item],
      discoveredLinks:
        officialUrl === undefined
          ? []
          : [
              {
                dedupKey: dedupKey(item),
                kind: "official-site",
                url: officialUrl,
                sourceId: id,
                sourcePageUrl: `https://${id}.example/detail`,
                evidence: "explicit-label",
              },
            ],
      metadata: { id, attempted: true, succeeded: true, recordCount: 1, message: "ok" },
    }),
  };
}

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

    expect(result.collectionMetadata).toHaveLength(9);
    expect(result.collectionMetadata.at(-1)).toMatchObject({
      id: "official-sites",
      recordCount: expect.any(Number),
    });
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

  it("keeps fixture CLI output separate from the deployable live file", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");

    await collect({
      projectRoot: TMP_DIR,
      fixtureBaseDir: FIXTURES_DIR,
      outputPath: resolve(TMP_DIR, ".tmp", "races.fixture.json"),
    });

    expect(await readFile(resolve(publicDir, "races.json"), "utf-8")).toBe("live-sentinel");
    const fixtureOutput = JSON.parse(
      await readFile(resolve(TMP_DIR, ".tmp", "races.fixture.json"), "utf-8"),
    );
    expect(CollectionOutputSchema.safeParse(fixtureOutput).success).toBe(true);
  });

  it("preserves the existing live file when every adapter fails", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");
    const failedAdapter: SourceAdapter = {
      ...adapter("failed", race("failed")),
      collect: async () => {
        throw new Error("source unavailable");
      },
    };

    await expect(
      collect(
        { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
        { adapters: [failedAdapter], now: () => NOW },
      ),
    ).rejects.toThrow("no publishable race data");
    expect(await readFile(resolve(publicDir, "races.json"), "utf-8")).toBe("live-sentinel");
  });

  it("preserves the existing live file when successful adapters return no races", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");
    const emptyAdapter: SourceAdapter = {
      ...adapter("empty", race("empty")),
      collect: async () => ({
        races: [],
        discoveredLinks: [],
        metadata: {
          id: "empty",
          attempted: true,
          succeeded: true,
          recordCount: 0,
          message: "empty",
        },
      }),
    };

    await expect(
      collect(
        { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
        { adapters: [emptyAdapter], now: () => NOW },
      ),
    ).rejects.toThrow("no publishable race data");
    expect(await readFile(resolve(publicDir, "races.json"), "utf-8")).toBe("live-sentinel");
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

  it("enriches a deduplicated race from a lower-priority source candidate", async () => {
    const primary = {
      ...race("primary", "2026 하반기 JUST RUN10 세종"),
      applicationUrl: "https://registration.example/primary",
      venue: "세종마루공원",
    };
    const secondary = {
      ...race("secondary", "2026 JUST RUN10 하반기 세종"),
      applicationUrl: "https://registration.example/secondary",
      venue: "세종마루공원",
    };
    const officialUrl = "https://official.example/duplicate";
    const fetchOfficialPage = vi.fn(async () => ({
      kind: "success" as const,
      url: officialUrl,
      address: "203.0.113.1",
      contentType: "text/html",
      body: `<title>${primary.name}</title><h1>${primary.name}</h1><p>대회일 ${primary.eventDate}</p><p>장소: 공식 장소</p>`,
    }));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [adapter("primary", primary), adapter("secondary", secondary, officialUrl)],
        now: () => NOW,
        fetchOfficialPage,
        sleep: vi.fn(() => Promise.resolve()),
        courtesyDelayMs: 0,
      },
    );

    expect(result.races).toHaveLength(1);
    expect(result.races[0]).toMatchObject({
      officialSiteUrl: officialUrl,
      venue: "공식 장소",
      sources: ["primary", "secondary"],
    });
    expect(result.collectionMetadata.at(-1)).toEqual({
      id: "official-sites",
      attempted: true,
      succeeded: true,
      recordCount: 1,
      message: "candidate=1 fetched=1 accepted=1 rejected=0 budgetSkipped=0",
    });
  });

  it("keeps valid all-race output when a source or enrichment loader fails", async () => {
    const retained = race("retained");
    const throwing: SourceAdapter = {
      ...adapter("throwing", retained),
      collect: async () => {
        throw new Error("source unavailable");
      },
    };
    const officialUrl = "https://official.example/failure";

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [throwing, adapter("retained", retained, officialUrl)],
        now: () => NOW,
        fetchOfficialPage: vi.fn(async () => {
          throw new Error("enrichment unavailable");
        }),
        sleep: vi.fn(() => Promise.resolve()),
        courtesyDelayMs: 0,
      },
    );

    expect(CollectionOutputSchema.safeParse(result).success).toBe(true);
    expect(result.races).toHaveLength(1);
    expect(result.collectionMetadata[0]).toMatchObject({
      id: "throwing",
      succeeded: false,
      recordCount: 0,
    });
    expect(result.collectionMetadata.at(-1)?.message).toBe(
      "candidate=1 fetched=1 accepted=0 rejected=1 budgetSkipped=0",
    );
  });

  it("drops invalid adapter records before duplicate URL parsing", async () => {
    const invalid = { ...race("invalid"), applicationUrl: "not-a-url" };
    const valid = race("valid", "유효한 대회");

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [adapter("invalid", invalid), adapter("valid", valid)],
        now: () => NOW,
        sleep: vi.fn(() => Promise.resolve()),
        courtesyDelayMs: 0,
      },
    );

    expect(result.races).toHaveLength(1);
    expect(result.races[0]?.name).toBe("유효한 대회");
  });

  it("uses official fixtures without invoking the live official fetcher", async () => {
    const fetchOfficialPage = vi.fn(() => Promise.reject(new Error("network attempted")));
    const sleep = vi.fn(() => Promise.resolve());
    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: FIXTURES_DIR },
      { now: () => NOW, fetchOfficialPage, sleep },
    );

    expect(fetchOfficialPage).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(result.collectionMetadata.slice(0, 8).map((item) => item.id)).toEqual([
      "gorunning",
      "kormarathon",
      "emarathon",
      "maedal",
      "kaaf",
      "marathonmoa",
      "runningmap",
      "marathonmate",
    ]);
    expect(result.collectionMetadata[8]?.id).toBe("official-sites");
  });

  it("retains candidate counts when the official fixture index is malformed", async () => {
    const fixtureRoot = resolve(TMP_DIR, "fixtures");
    await mkdir(resolve(fixtureRoot, "official-sites"), { recursive: true });
    await writeFile(resolve(fixtureRoot, "official-sites", "index.json"), "{broken", "utf8");
    const item = race("fixture");
    const fetchOfficialPage = vi.fn(() => Promise.reject(new Error("network attempted")));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: fixtureRoot },
      {
        adapters: [adapter("fixture", item, "https://official.example/race")],
        now: () => NOW,
        fetchOfficialPage,
      },
    );

    expect(result.races).toHaveLength(1);
    expect(fetchOfficialPage).not.toHaveBeenCalled();
    expect(result.collectionMetadata.at(-1)).toMatchObject({
      id: "official-sites",
      succeeded: false,
      recordCount: 0,
      message: expect.stringContaining(
        "candidate=1 fetched=1 accepted=0 rejected=1 budgetSkipped=0 error=",
      ),
    });
  });
});
