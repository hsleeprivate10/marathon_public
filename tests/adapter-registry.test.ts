import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adapters } from "../src/adapters/index.js";
import { failedSourceNames } from "../src/source-labels.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("schedule source registry", () => {
  it("registers MarathonGo immediately after GoRunning as the ninth schedule adapter", () => {
    // Given: the schedule adapter registry is the collection-order contract.
    const ids = adapters.map((adapter) => adapter.id);

    // When: callers enumerate registered schedule sources.
    const adapterCount = ids.length;

    // Then: MarathonGo is the second source and the registry contains nine adapters.
    expect(ids).toEqual([
      "gorunning",
      "marathongo",
      "kormarathon",
      "emarathon",
      "maedal",
      "kaaf",
      "marathonmoa",
      "runningmap",
      "marathonmate",
    ]);
    expect(adapterCount).toBe(9);
  });

  it("labels every registered schedule source with Korean display text", () => {
    // Given: registered schedule IDs plus the official enrichment source.
    const ids = [...adapters.map((adapter) => adapter.id), "official-sites"];

    // When: failed source names are rendered for user-facing status copy.
    const labels = failedSourceNames(ids);

    // Then: each registered schedule source has a specific Korean label.
    expect(labels).toEqual([
      "고러닝",
      "마라톤고",
      "전국마라톤협회",
      "이마라톤",
      "매달",
      "대한육상연맹",
      "마라톤모아",
      "러닝맵",
      "마라톤메이트",
      "공식 대회 사이트",
    ]);
  });

  it("runs registered MarathonGo list and detail fixtures without network", async () => {
    // Given: the registered MarathonGo adapter and a fixture-mode network trap.
    const marathonGo = adapters.find((adapter) => adapter.id === "marathongo");
    if (marathonGo === undefined) throw new TypeError("MarathonGo adapter must be registered");
    globalThis.fetch = Object.assign(
      vi.fn(() => Promise.reject(new Error("fixture mode attempted network fetch"))),
      { preconnect: originalFetch.preconnect },
    );

    // When: the source fixture client runs the adapter against local list/detail fixtures.
    const result = await marathonGo.collect({
      fixtureDir: resolve(import.meta.dirname, "fixtures/marathongo/multi"),
      detailBudget: 200,
    });

    // Then: no network is used and source URLs remain internal candidate/traversal evidence only.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("races");
    expect(result.discoveryCandidates).toHaveLength(2);
    expect(result.stageCounters).toMatchObject({
      discoveryCandidates: 2,
      sourceDetailsFetched: 2,
      traversalSeeds: 2,
    });
  });
});
