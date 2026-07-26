import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { KaafAdapter } from "../src/adapters/kaaf.js";
import { MaedalAdapter } from "../src/adapters/maedal.js";
import { MarathonMateAdapter } from "../src/adapters/marathonmate.js";
import { MarathonMoaAdapter } from "../src/adapters/marathonmoa.js";
import { RunningMapAdapter } from "../src/adapters/runningmap.js";
import type { SourceAdapter } from "../src/adapters/types.js";
import { enrichOfficialSites } from "../src/official-sites/enrichment.js";
import { createFixtureOfficialPageLoader } from "../src/official-sites/fixture-loader.js";
import { parseRaceLogoCandidates, selectRaceLogoCandidate } from "../src/race-logo-candidates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");

async function collect(adapter: SourceAdapter, fixtureName: string) {
  return adapter.collect({
    fixtureDir: `${FIXTURES_DIR}/${adapter.id}/${fixtureName}`,
    detailBudget: 0,
  });
}

async function collectWithNetworkTrap(adapter: SourceAdapter, fixtureName: string) {
  let fetchCalls = 0;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    fetchCalls += 1;
    return Promise.reject(new Error(`unexpected fixture network call: ${String(input)}`));
  });
  try {
    return { result: await collect(adapter, fixtureName), fetchCalls };
  } finally {
    fetchSpy.mockRestore();
  }
}

const detailOnlyCases = [
  {
    adapter: MaedalAdapter,
    fixture: "official-positive",
    positiveName: "서울 봄 마라톤",
    officialName: "서울 봄 마라톤 대회",
    eventDate: "2026-04-12",
    sourceVenue: "미상",
    sourceResultUrl: "https://maedal.com",
    sourceDetailUrl: "https://maedal.com/races/11111111-1111-4111-8111-111111111111",
    officialUrl: "https://seoul-spring.example.com/event",
    secondOfficialUrl: "https://busan-sea.example.com/event",
    officialApplicationUrl: "https://apply.seoul-spring.example.com/register",
    officialVenue: "서울 상암 월드컵공원",
    genericFixture: "official-negative",
    failureFixture: "logo-absent-source",
  },
  {
    adapter: MarathonMoaAdapter,
    fixture: "official-positive",
    positiveName: "2025 한강 나이트 마라톤",
    officialName: "2025 한강 나이트 마라톤",
    eventDate: "2025-06-14",
    sourceVenue: "서울 한강공원",
    sourceResultUrl: "https://marathon.me.kr/events",
    sourceDetailUrl: "https://marathon.me.kr/events/50111111-1111-4111-8111-111111111111",
    officialUrl: "https://hangang-night.example.net/event/501",
    secondOfficialUrl: "https://geumgang-dawn.example.net/event/502",
    officialApplicationUrl: "https://entry.hangang-night.example.net/register",
    officialVenue: "한강공원 여의도 이벤트광장",
    genericFixture: "official-negative",
    failureFixture: "registration-rsc",
  },
  {
    adapter: RunningMapAdapter,
    fixture: "official",
    positiveName: "제31회 공식러닝맵마라톤",
    officialName: "제31회 공식러닝맵마라톤 공식대회",
    eventDate: "2025-10-01",
    sourceVenue: "부산시민공원",
    sourceResultUrl: "https://runningmap.kr/list",
    sourceDetailUrl: "https://runningmap.kr/race/official-map-9101",
    officialUrl: "https://official-runningmap.example/event?id=9101",
    secondOfficialUrl: "https://official-collision.example/map-a-b",
    officialApplicationUrl: "https://apply.official-runningmap.example/register?id=9101",
    officialVenue: "부산 시민공원 잔디광장",
    genericFixture: "negative",
    failureFixture: "missing-detail",
  },
  {
    adapter: MarathonMateAdapter,
    fixture: "official-positive",
    positiveName: "대구 달빛 마라톤",
    officialName: "대구 달빛 마라톤 공식대회",
    eventDate: "2025-07-12",
    sourceVenue: "미상",
    sourceResultUrl: "https://marathonmate.store/domestic",
    sourceDetailUrl: "https://marathonmate.store/race/701",
    officialUrl: "https://daegu-moonlight.example.com/official",
    secondOfficialUrl: "https://gwangju-starlight.example.com/official",
    officialApplicationUrl: "https://entry.official-daegu-moonlight.example.com/join",
    officialVenue: "대구 두류공원 야외음악당",
    genericFixture: "official-negative",
    failureFixture: "missing-detail",
  },
] as const;

describe("community source-detail-only discovery", () => {
  for (const item of detailOnlyCases) {
    it(`${item.adapter.id}: ignores perfect-looking list links and emits only detail-owned official candidates`, async () => {
      const result = await item.adapter.collect({
        fixtureDir: `${FIXTURES_DIR}/${item.adapter.id}/${item.fixture}`,
        detailBudget: 20,
      });

      expect("races" in result).toBe(false);
      expect("discoveredLinks" in result).toBe(false);
      expect(result.discoveryCandidates).toEqual([
        {
          sourceId: item.adapter.id,
          sourceResultUrl: item.sourceResultUrl,
          sourceDetailUrl: item.sourceDetailUrl,
          identityEvidence: {
            titleHints: [item.positiveName],
            dateHints: [item.eventDate],
            organizerHints: [],
          },
        },
      ]);
      expect(result.discoveredOfficialCandidates.map((candidate) => candidate.url)).toEqual([
        item.officialUrl,
      ]);
      expect(
        result.discoveredOfficialCandidates.every(
          (candidate) => candidate.kind === "official-site",
        ),
      ).toBe(true);
      expect(result.discoveredOfficialCandidates[0]?.sourceDetailUrl).toBe(item.sourceDetailUrl);
      expect(result.stageCounters).toEqual({
        discoveryCandidates: 1,
        sourceDetailsFetched: 1,
        discoveredOfficialCandidates: 1,
        rejectedCandidates: 0,
        budgetSkipped: 0,
      });
    });

    it(`${item.adapter.id}: materializes only accepted official-page fields downstream`, async () => {
      const result = await item.adapter.collect({
        fixtureDir: `${FIXTURES_DIR}/${item.adapter.id}/${item.fixture}`,
        detailBudget: 20,
      });
      const loader = await createFixtureOfficialPageLoader(`${FIXTURES_DIR}/official-sites`);

      const enriched = await enrichOfficialSites(
        {
          discoveryCandidates: result.discoveryCandidates,
          discoveredOfficialCandidates: result.discoveredOfficialCandidates,
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
        candidate: 1,
        fetched: 1,
        accepted: 1,
        rejected: 0,
        budgetSkipped: 0,
      });
      expect(enriched.races).toHaveLength(1);
      expect(enriched.races[0]).toMatchObject({
        name: item.officialName,
        eventDate: item.eventDate,
        venue: item.officialVenue,
        applicationUrl: item.officialApplicationUrl,
        officialSiteUrl: item.officialUrl,
        sources: ["official-sites"],
        verified: true,
      });
      expect(enriched.races[0]?.notes).toBeUndefined();
    });

    it(`${item.adapter.id}: fails closed for generic links, payment links, missing detail, and exhausted budget`, async () => {
      const generic = await item.adapter.collect({
        fixtureDir: `${FIXTURES_DIR}/${item.adapter.id}/${item.genericFixture}`,
        detailBudget: 20,
      });
      const missingDetail = await item.adapter.collect({
        fixtureDir: `${FIXTURES_DIR}/${item.adapter.id}/${item.failureFixture}`,
        detailBudget: 20,
      });
      const skipped = await item.adapter.collect({
        fixtureDir: `${FIXTURES_DIR}/${item.adapter.id}/${item.fixture}`,
        detailBudget: 0,
      });

      expect(generic.discoveredOfficialCandidates).toEqual([]);
      expect(generic.stageCounters.discoveredOfficialCandidates).toBe(0);
      expect(generic.stageCounters.rejectedCandidates).toBeGreaterThanOrEqual(1);
      expect(missingDetail.discoveryCandidates).toHaveLength(1);
      expect(missingDetail.discoveredOfficialCandidates).toEqual([]);
      expect(missingDetail.stageCounters).toMatchObject({
        discoveryCandidates: 1,
        sourceDetailsFetched: 0,
        discoveredOfficialCandidates: 0,
        rejectedCandidates: 1,
        budgetSkipped: 0,
      });
      expect(skipped.discoveryCandidates).toHaveLength(1);
      expect(skipped.discoveredOfficialCandidates).toEqual([]);
      expect(skipped.stageCounters).toMatchObject({
        discoveryCandidates: 1,
        sourceDetailsFetched: 0,
        discoveredOfficialCandidates: 0,
        rejectedCandidates: 0,
        budgetSkipped: 1,
      });
    });

    it(`${item.adapter.id}: keeps cross-race list links out of discovered official candidates`, async () => {
      const result = await item.adapter.collect({
        fixtureDir: `${FIXTURES_DIR}/${item.adapter.id}/official-cross-race`,
        detailBudget: 20,
      });

      expect(result.discoveryCandidates).toHaveLength(2);
      expect(result.stageCounters).toMatchObject({
        discoveryCandidates: 2,
        sourceDetailsFetched: 2,
        discoveredOfficialCandidates: 2,
        rejectedCandidates: 0,
        budgetSkipped: 0,
      });
      expect(result.discoveredOfficialCandidates.map((candidate) => candidate.url)).toEqual([
        item.officialUrl,
        item.secondOfficialUrl,
      ]);
    });
  }
});

describe("community adapter isolated event logo extraction", () => {
  it("kaaf: proves complete-list logo scanning would leak a target-compatible adjacent row", async () => {
    // Given the full fixture has selectable target logo evidence outside the target owned row.
    const html = await readFile(resolve(FIXTURES_DIR, "kaaf/logo-neighbor/home.html"), "utf8");
    const targetRace = { name: "서울 시민 마라톤대회", eventDate: "2025-05-04" };

    // When comparing an illegal full-list scan with the legal adapter-owned row scan.
    const fullListLogo = selectRaceLogoCandidate(
      parseRaceLogoCandidates(html, "https://m.kaaf.or.kr/mobile/info/inside_all.asp"),
      targetRace,
    );
    const { result } = await collectWithNetworkTrap(KaafAdapter, "logo-neighbor");

    // Then the full list would leak the logo, while adapter output remains isolated.
    expect(fullListLogo).toBe("https://assets.seoul-citizen.example.org/leaked-target-logo.png");
    expect(result).not.toHaveProperty("races");
    expect(result.discoveryCandidates[0]?.identityEvidence.titleHints).toEqual([targetRace.name]);
  });

  it("kaaf: ignores row logos because KAAF source rows never publish races", async () => {
    const { result, fetchCalls } = await collectWithNetworkTrap(KaafAdapter, "logo-positive");

    expect(fetchCalls).toBe(0);
    expect(result).not.toHaveProperty("races");
    expect(result.discoveredOfficialCandidates).toEqual([]);
  });
});
