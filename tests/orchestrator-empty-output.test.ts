import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "../src/adapters/types.js";
import { CollectionOutputSchema } from "../src/contract.js";
import { collect } from "../src/orchestrator.js";
import {
  adapter,
  createOutputDir,
  emptyAdapter,
  noDelay,
  removeOutputDir,
} from "./orchestrator-helpers.js";

const TMP_DIR = resolve(import.meta.dirname, "__tmp_output_empty__");

beforeEach(() => createOutputDir(TMP_DIR));
afterEach(() => removeOutputDir(TMP_DIR));

describe("orchestrator empty-output handling", () => {
  it("writes empty output when no official pages are accepted", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");
    const officialUrl = "https://official.example/rejected";

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [
          adapter({
            id: "source",
            name: "2026 거절 대회",
            eventDate: "2026-07-01",
            officialUrls: [officialUrl],
          }),
        ],
        ...noDelay,
        fetchOfficialPage: vi.fn(async () => ({
          kind: "failed" as const,
          url: officialUrl,
          reason: "network" as const,
        })),
      },
    );
    const published = JSON.parse(await readFile(resolve(publicDir, "races.json"), "utf-8"));

    expect(result.races).toEqual([]);
    expect(CollectionOutputSchema.parse(published).races).toEqual([]);
    expect(published).toEqual(result);
    expect(result.collectionMetadata.at(-1)).toMatchObject({
      id: "official-sites",
      recordCount: 0,
    });
  });

  it("reports official-sites success when every candidate legitimately rejects", async () => {
    const officialUrl = "https://official.example/policy-rejected";

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [
          adapter({
            id: "source",
            name: "2026 정책 거절 대회",
            eventDate: "2026-07-01",
            officialUrls: [officialUrl],
          }),
        ],
        ...noDelay,
        fetchOfficialPage: vi.fn(async () => ({
          kind: "rejected" as const,
          url: officialUrl,
          reason: "unsafe-public-url" as const,
        })),
      },
    );

    expect(result.races).toEqual([]);
    expect(result.collectionMetadata.at(-1)).toEqual({
      id: "official-sites",
      attempted: true,
      succeeded: true,
      recordCount: 0,
      message:
        "seed=1 fetched=1 accepted=0 rejected=1 policyRejected=1 fetchRejected=0 identityRejected=0 depthSkipped=0 cycleSkipped=0 hostBudgetSkipped=0 runBudgetSkipped=0",
    });
  });

  it("preserves the existing live file when every adapter fails", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");
    const failedAdapter: SourceAdapter = {
      ...emptyAdapter("failed"),
      collect: async () => {
        throw new Error("source unavailable");
      },
    };

    await expect(
      collect(
        { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
        { adapters: [failedAdapter], now: () => "2026-01-02T03:04:05.000Z" },
      ),
    ).rejects.toThrow(
      "Live collection produced no publishable race data; existing output preserved",
    );
    expect(await readFile(resolve(publicDir, "races.json"), "utf-8")).toBe("live-sentinel");
  });

  it("writes empty output when successful adapters provide no official candidates", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      { adapters: [emptyAdapter("empty")], now: () => "2026-01-02T03:04:05.000Z" },
    );
    const published = JSON.parse(await readFile(resolve(publicDir, "races.json"), "utf-8"));

    expect(result.races).toEqual([]);
    expect(CollectionOutputSchema.parse(published).races).toEqual([]);
    expect(published).toEqual(result);
    expect(result.collectionMetadata.at(-1)).toMatchObject({
      id: "official-sites",
      recordCount: 0,
    });
  });
});
