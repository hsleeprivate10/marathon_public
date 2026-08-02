import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OfficialPageLoader } from "../../src/official-sites/enrichment.js";
import { enrichOfficialSites } from "../../src/official-sites/enrichment.js";
import {
  OfficialFixtureIndexError,
  createFixtureOfficialPageLoader,
} from "../../src/official-sites/fixture-loader.js";
import { FIXTURES, discovery, input, officialLink, options } from "./enrichment-helpers.js";

describe("official-site enrichment fixtures and budgets", () => {
  it("orders future candidates deterministically and applies the global fetch budget", async () => {
    const candidates = Array.from({ length: 45 }, (_, index) =>
      discovery(`예산 대회 ${String(index).padStart(2, "0")}`, "2026-04-01"),
    ).reverse();
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "fixture-rejected",
    }));

    const result = await enrichOfficialSites(
      input(
        candidates,
        candidates.map((candidate, index) =>
          officialLink(
            candidate,
            `https://official-${String(index).padStart(2, "0")}.example/${encodeURIComponent(candidate.identityEvidence.titleHints[0] ?? "race")}`,
          ),
        ),
      ),
      options(loadPage),
    );

    expect(loadPage).toHaveBeenCalledTimes(40);
    expect(decodeURIComponent(loadPage.mock.calls[0]?.[0] ?? "")).toContain("예산 대회 00");
    expect(result.races).toEqual([]);
    expect(result.counts).toMatchObject({
      seed: 45,
      fetched: 40,
      rejected: 40,
      runBudgetSkipped: 5,
    });
  });

  it("does not fetch past official candidates", async () => {
    const past = discovery("지난 대회", "2025-12-31");
    const future = discovery("미래 대회", "2026-02-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "failed",
      url,
      reason: "test",
    }));

    const result = await enrichOfficialSites(
      input(
        [past, future],
        [
          officialLink(past, "https://past.example/race"),
          officialLink(future, "https://future.example/first"),
          officialLink(future, "https://future.example/second"),
        ],
      ),
      options(loadPage, 1),
    );

    expect(loadPage.mock.calls.map(([url]) => url)).toEqual(["https://future.example/first"]);
    expect(result.counts).toMatchObject({ seed: 2, fetched: 1, rejected: 1, runBudgetSkipped: 1 });
  });

  it("loads mapped fixtures and returns typed skips for missing or stale mappings", async () => {
    const loader = await createFixtureOfficialPageLoader(FIXTURES);

    await expect(loader("https://official.example/seoul-2026")).resolves.toMatchObject({
      kind: "success",
      url: "https://official.example/seoul-2026",
    });
    await expect(loader("https://missing.example/race")).resolves.toEqual({
      kind: "skipped",
      url: "https://missing.example/race",
      reason: "missing-mapping",
    });
    await expect(loader("https://stale.example/race")).resolves.toEqual({
      kind: "skipped",
      url: "https://stale.example/race",
      reason: "missing-file",
    });
  });

  it("loads grouped level 2 and level 3 fixture index mappings", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "official-sites-"));
    try {
      await writeFile(
        resolve(directory, "index.json"),
        JSON.stringify({
          level2: { "https://apply.example/register": "level-2.html" },
          level3: { "https://official.example/final": "level-3.html" },
        }),
        "utf8",
      );
      await writeFile(resolve(directory, "level-2.html"), "level two", "utf8");
      await writeFile(resolve(directory, "level-3.html"), "level three", "utf8");
      const loader = await createFixtureOfficialPageLoader(directory);

      await expect(loader("https://apply.example/register", "traversal")).resolves.toMatchObject({
        body: "level two",
      });
      await expect(loader("https://official.example/final", "official")).resolves.toMatchObject({
        body: "level three",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("delays repeated live hosts but not the first request to each host", async () => {
    const first = discovery("가 대회", "2026-04-01");
    const second = discovery("나 대회", "2026-04-01");
    const third = discovery("다 대회", "2026-04-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "test",
    }));
    const sleep = vi.fn(() => Promise.resolve());

    await enrichOfficialSites(
      input(
        [first, second, third],
        [
          officialLink(first, "https://same.example/a"),
          officialLink(second, "https://other.example/b"),
          officialLink(third, "https://same.example/c"),
        ],
      ),
      { ...options(loadPage), courtesyDelayMs: 1_000, sleep },
    );

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("does not delay fixture-host candidates when courtesy delay is disabled", async () => {
    const candidate = discovery("무지연 대회", "2026-04-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "fixture-rejected",
    }));
    const sleep = vi.fn(() => Promise.resolve());

    await enrichOfficialSites(
      input(
        [candidate],
        [
          officialLink(candidate, "https://fixture.example/first"),
          officialLink(candidate, "https://fixture.example/second"),
        ],
      ),
      { ...options(loadPage), sleep },
    );

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects a malformed fixture index at the fixture boundary", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "official-sites-"));
    try {
      await writeFile(resolve(directory, "index.json"), "{not-json", "utf8");
      await expect(createFixtureOfficialPageLoader(directory)).rejects.toBeInstanceOf(
        OfficialFixtureIndexError,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
