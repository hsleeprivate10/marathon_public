import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EMarathonAdapter } from "../src/adapters/emarathon.js";
import { GoRunningAdapter } from "../src/adapters/gorunning.js";
import { KaafAdapter } from "../src/adapters/kaaf.js";
import { KorMarathonAdapter } from "../src/adapters/kormarathon.js";
import { MaedalAdapter } from "../src/adapters/maedal.js";
import { MarathonMateAdapter } from "../src/adapters/marathonmate.js";
import { MarathonMoaAdapter } from "../src/adapters/marathonmoa.js";
import { RunningMapAdapter } from "../src/adapters/runningmap.js";
import type { SourceAdapter } from "../src/adapters/types.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

type SeedExpectation = {
  readonly kind: "official" | "application";
  readonly url: string;
  readonly sourceDetailUrl: string;
  readonly evidence: "explicit-label" | "structured-event" | "structured-organizer";
};

type PositiveCase = {
  readonly adapter: SourceAdapter;
  readonly fixture: string;
  readonly expectedSeeds: readonly SeedExpectation[];
};

const positiveCases: readonly PositiveCase[] = [
  {
    adapter: GoRunningAdapter,
    fixture: "gorunning/official",
    expectedSeeds: [
      {
        kind: "official",
        url: "https://official-gorun.example/race?id=9101",
        sourceDetailUrl: "https://gorunning.kr/race/view.php?idx=9101",
        evidence: "explicit-label",
      },
      {
        kind: "application",
        url: "https://apply-gorun.example/register?race=9101",
        sourceDetailUrl: "https://gorunning.kr/race/view.php?idx=9101",
        evidence: "explicit-label",
      },
    ],
  },
  {
    adapter: KorMarathonAdapter,
    fixture: "kormarathon/official",
    expectedSeeds: [
      {
        kind: "official",
        url: "https://official-kor.example/home?eventId=9101",
        sourceDetailUrl: "https://www.kormarathon.com/ko/race/9101",
        evidence: "explicit-label",
      },
      {
        kind: "application",
        url: "https://apply-kor.example/start?race=9101",
        sourceDetailUrl: "https://www.kormarathon.com/ko/race/9101",
        evidence: "explicit-label",
      },
    ],
  },
  {
    adapter: EMarathonAdapter,
    fixture: "emarathon/official",
    expectedSeeds: [
      {
        kind: "application",
        url: "https://apply-emarathon.example/register?race=9101",
        sourceDetailUrl: "https://emarathon.or.kr/race/view/9101",
        evidence: "explicit-label",
      },
      {
        kind: "official",
        url: "https://official-emarathon.example/main?race=9101",
        sourceDetailUrl: "https://emarathon.or.kr/race/view/9101",
        evidence: "explicit-label",
      },
    ],
  },
  {
    adapter: MaedalAdapter,
    fixture: "maedal/official-positive",
    expectedSeeds: [
      {
        kind: "official",
        url: "https://seoul-spring.example.com/event",
        sourceDetailUrl: "https://maedal.com/races/11111111-1111-4111-8111-111111111111",
        evidence: "explicit-label",
      },
      {
        kind: "application",
        url: "https://apply.seoul-spring.example.com/register",
        sourceDetailUrl: "https://maedal.com/races/11111111-1111-4111-8111-111111111111",
        evidence: "explicit-label",
      },
    ],
  },
  {
    adapter: KaafAdapter,
    fixture: "kaaf/official-positive",
    expectedSeeds: [
      {
        kind: "official",
        url: "https://seoul-citizen.example.org/race",
        sourceDetailUrl: "https://m.kaaf.or.kr/mobile/info/inside_view.asp?no=7",
        evidence: "explicit-label",
      },
    ],
  },
  {
    adapter: MarathonMoaAdapter,
    fixture: "marathonmoa/official-positive",
    expectedSeeds: [
      {
        kind: "official",
        url: "https://hangang-night.example.net/event/501",
        sourceDetailUrl: "https://marathon.me.kr/events/50111111-1111-4111-8111-111111111111",
        evidence: "explicit-label",
      },
      {
        kind: "application",
        url: "https://entry.hangang-night.example.net/register",
        sourceDetailUrl: "https://marathon.me.kr/events/50111111-1111-4111-8111-111111111111",
        evidence: "explicit-label",
      },
    ],
  },
  {
    adapter: RunningMapAdapter,
    fixture: "runningmap/official",
    expectedSeeds: [
      {
        kind: "official",
        url: "https://official-runningmap.example/event?id=9101",
        sourceDetailUrl: "https://runningmap.kr/race/official-map-9101",
        evidence: "explicit-label",
      },
      {
        kind: "application",
        url: "https://apply-runningmap.example/start?id=9101",
        sourceDetailUrl: "https://runningmap.kr/race/official-map-9101",
        evidence: "explicit-label",
      },
    ],
  },
  {
    adapter: MarathonMateAdapter,
    fixture: "marathonmate/official-positive",
    expectedSeeds: [
      {
        kind: "official",
        url: "https://daegu-moonlight.example.com/official",
        sourceDetailUrl: "https://marathonmate.store/race/701",
        evidence: "explicit-label",
      },
      {
        kind: "application",
        url: "https://entry.daegu-moonlight.example.com/join",
        sourceDetailUrl: "https://marathonmate.store/race/701",
        evidence: "explicit-label",
      },
    ],
  },
];

const negativeCases = [
  { adapter: GoRunningAdapter, fixture: "gorunning/missing-detail", detailBudget: 20 },
  { adapter: KorMarathonAdapter, fixture: "kormarathon/negative", detailBudget: 20 },
  { adapter: EMarathonAdapter, fixture: "emarathon/negative", detailBudget: 20 },
  { adapter: MaedalAdapter, fixture: "maedal/official-negative", detailBudget: 20 },
  { adapter: KaafAdapter, fixture: "kaaf/official-negative", detailBudget: 20 },
  { adapter: MarathonMoaAdapter, fixture: "marathonmoa/official-negative", detailBudget: 20 },
  { adapter: RunningMapAdapter, fixture: "runningmap/negative", detailBudget: 20 },
] as const;

async function collect(adapter: SourceAdapter, fixture: string, detailBudget: number) {
  return adapter.collect({ fixtureDir: resolve(FIXTURES_DIR, fixture), detailBudget });
}

describe("Todo 8 contextual traversal adapters", () => {
  it("emits exact contextual traversal seed kinds without external fixture network fetches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch"));
    try {
      for (const item of positiveCases) {
        const result = await collect(item.adapter, item.fixture, 20);

        expect(
          result.traversalSeeds.map((seed) => ({
            kind: seed.kind,
            url: seed.url,
            sourceDetailUrl: seed.sourceDetailUrl,
            evidence: seed.evidence,
          })),
        ).toEqual(item.expectedSeeds);
        expect(result.stageCounters.traversalSeeds).toBe(item.expectedSeeds.length);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps generic, wrong, payment, source-self, stale, and missing-detail fixtures closed", async () => {
    for (const item of negativeCases) {
      const result = await collect(item.adapter, item.fixture, item.detailBudget);
      expect(result.traversalSeeds, item.adapter.id).toEqual([]);
    }
  });

  it("keeps exhausted budgets and MarathonMate no-result pages seedless", async () => {
    for (const item of positiveCases) {
      const result = await collect(item.adapter, item.fixture, 0);
      expect(result.traversalSeeds, item.adapter.id).toEqual([]);
    }

    const fixtureDir = await mkdtemp(resolve(tmpdir(), "marathonmate-no-results-"));
    try {
      await writeFile(
        resolve(fixtureDir, "home.html"),
        '<!doctype html><html><body><main><p>검색 결과가 없습니다.</p><a href="/race-finder">추천 찾기</a></main></body></html>',
        "utf8",
      );
      const result = await MarathonMateAdapter.collect({ fixtureDir, detailBudget: 20 });
      expect(result.discoveryCandidates).toEqual([]);
      expect(result.traversalSeeds).toEqual([]);
      expect(result.stageCounters).toMatchObject({
        discoveryCandidates: 0,
        sourceDetailsFetched: 0,
        traversalSeeds: 0,
      });
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
