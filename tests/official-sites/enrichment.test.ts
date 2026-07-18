import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DiscoveredRaceLink } from "../../src/adapters/types.js";
import type { Race } from "../../src/contract.js";
import { dedupKey } from "../../src/normalize.js";
import {
  type OfficialPageLoader,
  enrichOfficialSites,
} from "../../src/official-sites/enrichment.js";
import {
  OfficialFixtureIndexError,
  createFixtureOfficialPageLoader,
} from "../../src/official-sites/fixture-loader.js";
const FIXTURES = resolve(import.meta.dirname, "../fixtures/official-sites");
const NOW = "2026-01-02T03:04:05.000Z";
function race(name: string, eventDate: string): Race {
  return {
    name,
    eventDate,
    registrationDeadline: null,
    venue: "미상",
    courses: [],
    applicationUrl: `https://source.example/${encodeURIComponent(name)}`,
    sources: ["primary"],
    verified: true,
    lastVerified: NOW,
    updatedAt: NOW,
    generatedAt: NOW,
    registrationStatus: "unknown",
  };
}
function link(
  owner: Race,
  kind: DiscoveredRaceLink["kind"],
  url: string,
  sourceId = "secondary",
): DiscoveredRaceLink {
  return {
    dedupKey: dedupKey(owner),
    kind,
    url,
    sourceId,
    sourcePageUrl: "https://source.example/detail",
    evidence: "explicit-label",
  };
}
function page(name: string, eventDate: string, venue = "공식 장소"): string {
  return `<title>${name}</title><h1>${name}</h1><p>대회일 ${eventDate}</p><p>장소: ${venue}</p>`;
}
function options(loadPage: OfficialPageLoader, maxFetches = 40) {
  return {
    today: "2026-01-01",
    verifiedAt: NOW,
    maxFetches,
    courtesyDelayMs: 0,
    loadPage,
    sleep: vi.fn(() => Promise.resolve()),
  };
}
describe("official-site enrichment", () => {
  it("uses duplicate-source candidates, applies application links, and fetches only official kinds", async () => {
    const original = race("서울 새해 마라톤", "2026-03-15");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) =>
      url.includes("wrong")
        ? { kind: "success", url, body: page("다른 대회", original.eventDate) }
        : { kind: "success", url, body: page(original.name, original.eventDate) },
    );
    const result = await enrichOfficialSites(
      [original],
      [
        link(original, "application", "https://apply.example/register", "primary"),
        link(original, "official-site", "https://official.example/wrong", "primary"),
        link(original, "official-site", "https://backup.example/race", "secondary"),
      ],
      options(loadPage),
    );
    expect(loadPage.mock.calls.map(([url]) => url)).toEqual([
      "https://official.example/wrong",
      "https://backup.example/race",
    ]);
    expect(result.races[0]).toMatchObject({
      applicationUrl: "https://apply.example/register",
      officialSiteUrl: "https://backup.example/race",
      venue: "공식 장소",
    });
    expect(result.counts).toEqual({
      candidate: 2,
      fetched: 2,
      accepted: 1,
      rejected: 1,
      budgetSkipped: 0,
    });
  });
  it("orders future races deterministically and retains all races at the global budget", async () => {
    const future = Array.from({ length: 45 }, (_, index) =>
      race(`예산 대회 ${String(index).padStart(2, "0")}`, index < 2 ? "2026-04-01" : "2026-04-02"),
    ).reverse();
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "fixture-rejected",
    }));
    const result = await enrichOfficialSites(
      future,
      future.map((item) =>
        link(item, "official-site", `https://official.example/${encodeURIComponent(item.name)}`),
      ),
      options(loadPage),
    );
    expect(loadPage).toHaveBeenCalledTimes(40);
    expect(decodeURIComponent(loadPage.mock.calls[0]?.[0] ?? "")).toContain("예산 대회 00");
    expect(result.races).toHaveLength(45);
    expect(result.counts).toEqual({
      candidate: 45,
      fetched: 40,
      accepted: 0,
      rejected: 40,
      budgetSkipped: 5,
    });
  });
  it("does not fetch past candidates and classifies mid-fallback budget exhaustion", async () => {
    const past = race("지난 대회", "2025-12-31");
    const future = race("미래 대회", "2026-02-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: page("불일치 대회", future.eventDate),
    }));
    const result = await enrichOfficialSites(
      [past, future],
      [
        link(past, "official-site", "https://past.example/race"),
        link(future, "official-site", "https://future.example/first"),
        link(future, "official-site", "https://future.example/second"),
      ],
      options(loadPage, 1),
    );
    expect(loadPage.mock.calls.map(([url]) => url)).toEqual(["https://future.example/first"]);
    expect(result.races).toEqual([past, future]);
    expect(result.counts).toEqual({
      candidate: 2,
      fetched: 1,
      accepted: 0,
      rejected: 1,
      budgetSkipped: 1,
    });
  });
  it("rejects a malformed candidate locally and falls through to a valid URL", async () => {
    const item = race("잘못된 URL 대회", "2026-04-01");
    const validUrl = "https://official.example/valid";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) =>
      url === validUrl
        ? { kind: "success", url, body: page(item.name, item.eventDate) }
        : { kind: "rejected", url, reason: "invalid-url" },
    );
    const result = await enrichOfficialSites(
      [item],
      [link(item, "official-site", "not a URL"), link(item, "official-site", validUrl)],
      options(loadPage),
    );
    expect(loadPage.mock.calls.map(([url]) => url)).toEqual([validUrl]);
    expect(result.races[0]?.officialSiteUrl).toBe(validUrl);
    expect(result.counts).toEqual({
      candidate: 1,
      fetched: 1,
      accepted: 1,
      rejected: 0,
      budgetSkipped: 0,
    });
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
  it("delays repeated live hosts but not the first request to each host", async () => {
    const races = [
      race("가 대회", "2026-04-01"),
      race("나 대회", "2026-04-01"),
      race("다 대회", "2026-04-01"),
    ];
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "test",
    }));
    const sleep = vi.fn(() => Promise.resolve());
    await enrichOfficialSites(
      races,
      [
        link(races[0] ?? race("없음", "2026-04-01"), "official-site", "https://same.example/a"),
        link(races[1] ?? race("없음", "2026-04-01"), "official-site", "https://other.example/b"),
        link(races[2] ?? race("없음", "2026-04-01"), "official-site", "https://same.example/c"),
      ],
      { ...options(loadPage), courtesyDelayMs: 1_000, sleep },
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });
  it("does not delay repeated fixture-host candidates", async () => {
    const item = race("무지연 대회", "2026-04-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "fixture-rejected",
    }));
    const sleep = vi.fn(() => Promise.resolve());
    await enrichOfficialSites(
      [item],
      [
        link(item, "official-site", "https://fixture.example/first"),
        link(item, "official-site", "https://fixture.example/second"),
      ],
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
