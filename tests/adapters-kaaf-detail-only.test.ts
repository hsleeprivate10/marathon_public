import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { KaafAdapter } from "../src/adapters/kaaf.js";
import { enrichOfficialSites } from "../src/official-sites/enrichment.js";
import { createFixtureOfficialPageLoader } from "../src/official-sites/fixture-loader.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const KAAF_FIXTURES_DIR = `${FIXTURES_DIR}/kaaf`;
const OFFICIAL_FIXTURES_DIR = `${FIXTURES_DIR}/official-sites`;
const DETAIL_URL = "https://m.kaaf.or.kr/mobile/info/inside_view.asp?no=7";
const LIST_URL = "https://m.kaaf.or.kr/mobile/info/inside_all.asp";
const OFFICIAL_URL = "https://seoul-citizen.example.org/race";

async function collect(fixture: string, detailBudget = 20) {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    return Promise.reject(new Error(`unexpected KAAF fixture network call: ${String(input)}`));
  });
  try {
    return await KaafAdapter.collect({
      fixtureDir: `${KAAF_FIXTURES_DIR}/${fixture}`,
      detailBudget,
    });
  } finally {
    fetchSpy.mockRestore();
  }
}

describe("KAAF detail-only official discovery", () => {
  it("emits one detail-owned official candidate and no publication fallback", async () => {
    const result = await collect("official-positive");

    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates).toEqual([
      {
        sourceId: "kaaf",
        sourceResultUrl: LIST_URL,
        sourceDetailUrl: DETAIL_URL,
        identityEvidence: {
          titleHints: ["서울 시민 마라톤대회"],
          dateHints: ["2025-05-04"],
          organizerHints: [],
        },
      },
    ]);
    expect(result.traversalSeeds.map((candidate) => candidate.url)).toEqual([OFFICIAL_URL]);
    expect(result.traversalSeeds[0]).toMatchObject({
      kind: "official",
      sourceId: "kaaf",
      sourceDetailUrl: DETAIL_URL,
      evidence: "explicit-label",
    });
    expect(result.stageCounters).toEqual({
      discoveryCandidates: 1,
      sourceDetailsFetched: 1,
      traversalSeeds: 1,
      rejectedCandidates: 0,
      budgetSkipped: 0,
    });
  });

  it("materializes through the common official page path only", async () => {
    const result = await collect("official-positive");
    const loader = await createFixtureOfficialPageLoader(OFFICIAL_FIXTURES_DIR);

    const enriched = await enrichOfficialSites(
      {
        discoveryCandidates: result.discoveryCandidates,
        traversalSeeds: result.traversalSeeds,
      },
      {
        today: "2025-01-01",
        verifiedAt: "2026-01-01T00:00:00.000Z",
        maxFetches: 5,
        courtesyDelayMs: 0,
        loadPage: loader,
        sleep: async () => {},
      },
    );

    expect(enriched.counts).toEqual({
      seed: 1,
      fetched: 1,
      accepted: 1,
      rejected: 0,
      policyRejected: 0,
      fetchRejected: 0,
      identityRejected: 0,
      depthSkipped: 0,
      cycleSkipped: 0,
      hostBudgetSkipped: 0,
      runBudgetSkipped: 0,
    });
    expect(enriched.races).toHaveLength(1);
    expect(enriched.races[0]).toMatchObject({
      name: "서울 시민 마라톤대회 공식",
      eventDate: "2025-05-04",
      venue: "서울 월드컵공원 평화광장",
      applicationUrl: "https://entry.seoul-citizen.example.org/register",
      officialSiteUrl: OFFICIAL_URL,
      sources: ["official-sites"],
      verified: true,
    });
    expect(enriched.races[0]?.notes).toBeUndefined();
  });

  it.each([
    ["document-only"],
    ["generic-source-only"],
    ["result-table-only"],
    ["registration-payment-only"],
  ] as const)(
    "%s returns candidates and rejections but no official candidates",
    async (fixture) => {
      const result = await collect(fixture);

      expect(result.discoveryCandidates).toHaveLength(1);
      expect(result.traversalSeeds).toEqual([]);
      expect(result.stageCounters).toMatchObject({
        discoveryCandidates: 1,
        sourceDetailsFetched: 1,
        traversalSeeds: 0,
        rejectedCandidates: 1,
        budgetSkipped: 0,
      });
    },
  );

  it("returns a candidate but no official candidate when the detail fixture is missing", async () => {
    const result = await collect("missing-detail");

    expect(result.discoveryCandidates).toHaveLength(1);
    expect(result.traversalSeeds).toEqual([]);
    expect(result.stageCounters).toMatchObject({
      discoveryCandidates: 1,
      sourceDetailsFetched: 0,
      traversalSeeds: 0,
      rejectedCandidates: 1,
      budgetSkipped: 0,
    });
  });

  it("rejects unsafe detail routes before they become candidates", async () => {
    const result = await collect("unsafe-detail");

    expect(result.discoveryCandidates).toEqual([]);
    expect(result.traversalSeeds).toEqual([]);
    expect(result.stageCounters).toMatchObject({
      discoveryCandidates: 0,
      sourceDetailsFetched: 0,
      traversalSeeds: 0,
      rejectedCandidates: 1,
      budgetSkipped: 0,
    });
  });

  it("spends no detail budget and still reports a legitimate zero-race KAAF result", async () => {
    const result = await collect("official-positive", 0);

    expect(result.metadata.succeeded).toBe(true);
    expect(result.metadata.recordCount).toBe(1);
    expect(result.discoveryCandidates).toHaveLength(1);
    expect(result.traversalSeeds).toEqual([]);
    expect(result.stageCounters).toMatchObject({
      discoveryCandidates: 1,
      sourceDetailsFetched: 0,
      traversalSeeds: 0,
      rejectedCandidates: 0,
      budgetSkipped: 1,
    });
  });
});
