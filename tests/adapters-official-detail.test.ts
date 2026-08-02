import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMarathonAdapter } from "../src/adapters/emarathon.js";
import { GoRunningAdapter } from "../src/adapters/gorunning.js";
import { KorMarathonAdapter } from "../src/adapters/kormarathon.js";
import { MarathonMoaAdapter } from "../src/adapters/marathonmoa.js";
import { RunningMapAdapter } from "../src/adapters/runningmap.js";
import type { AdapterResult } from "../src/adapters/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const originalFetch = globalThis.fetch;
let requestedUrls: string[] = [];

const cases = [
  {
    adapter: GoRunningAdapter,
    fixtureName: "gorunning",
    officialUrl: "https://official-gorun.example/race?id=9101",
    applicationUrl: "https://apply-gorun.example/register?race=9101",
    expectedSeeds: [
      { kind: "official", url: "https://official-gorun.example/race?id=9101" },
      { kind: "application", url: "https://apply-gorun.example/register?race=9101" },
    ],
  },
  {
    adapter: KorMarathonAdapter,
    fixtureName: "kormarathon",
    officialUrl: "https://official-kor.example/home?eventId=9101",
    applicationUrl: "https://apply-kor.example/start?race=9101",
    expectedSeeds: [
      { kind: "official", url: "https://official-kor.example/home?eventId=9101" },
      { kind: "application", url: "https://apply-kor.example/start?race=9101" },
    ],
  },
  {
    adapter: EMarathonAdapter,
    fixtureName: "emarathon",
    officialUrl: "https://official-emarathon.example/main?race=9101",
    applicationUrl: "https://apply-emarathon.example/register?race=9101",
    expectedSeeds: [
      { kind: "application", url: "https://apply-emarathon.example/register?race=9101" },
      { kind: "official", url: "https://official-emarathon.example/main?race=9101" },
    ],
  },
];

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function trapNetwork(): void {
  requestedUrls = [];
  globalThis.fetch = Object.assign(
    vi.fn((input: RequestInfo | URL) => {
      requestedUrls.push(input instanceof Request ? input.url : input.toString());
      return Promise.reject(new Error("fixture mode attempted network fetch"));
    }),
    { preconnect: originalFetch.preconnect },
  );
}
function installFetchRoutes(routes: Readonly<Record<string, string>>): void {
  requestedUrls = [];
  globalThis.fetch = Object.assign(
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      requestedUrls.push(url);
      const body = routes[url];
      if (body === undefined) return Promise.reject(new Error(`unexpected network fetch: ${url}`));
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
      );
    }),
    { preconnect: originalFetch.preconnect },
  );
}
function fetchedUrls(): readonly string[] {
  return requestedUrls;
}
function fixtureDir(item: { readonly fixtureName: string }, variant: string): string {
  return `${FIXTURES_DIR}/${item.fixtureName}/${variant}`;
}
function expectNoLegacyPublicFields(result: AdapterResult): void {
  expect(result).not.toHaveProperty("races");
  expect(result).not.toHaveProperty("discoveredLinks");
}
describe("detail-rich adapter official link discovery", () => {
  it("does not replace current GoRunning list identity with noisy detail values", async () => {
    const listUrl = "https://gorunning.kr/races/";
    const detailUrl = "https://gorunning.kr/races/1169/2026-up-hill-race/";
    installFetchRoutes({
      [listUrl]: `<div id="race-2026-09-20"><table><tr><td>1</td><td><a href="/races/1169/2026-up-hill-race/">2026 양산 어필(up-hill) 레이스</a></td><td><span>10km</span></td><td>경남</td><td>양산 정확한 장소</td><td>주최자</td></tr></table></div>`,
      [detailUrl]: `<title>완전히 다른 상세 제목 - 고러닝</title><script>{"description":"장소: 잘못된 SEO 장소","registrationDeadline":"마감 2025-01-01"}</script><p>장소: 잘못된 본문 장소</p><p>10km: 30,000원</p><p>Website</p><p><a href="https://apply.example.com/race">https://apply.example.com/race</a></p>`,
    });

    const result = await GoRunningAdapter.collect({ fixtureDir: undefined, detailBudget: 1 });

    expect(fetchedUrls()).toEqual([listUrl, detailUrl]);
    expectNoLegacyPublicFields(result);
    expect(result.discoveryCandidates[0]).toMatchObject({
      sourceId: "gorunning",
      sourceResultUrl: listUrl,
      sourceDetailUrl: detailUrl,
      identityEvidence: {
        titleHints: ["2026 양산 어필(up-hill) 레이스"],
        dateHints: ["2026-09-20"],
        organizerHints: [],
      },
    });
    expect(result.traversalSeeds).toEqual([]);
  });

  it("keeps the GoRunning race detail instead of a generic organizer homepage", async () => {
    const listUrl = "https://gorunning.kr/races/";
    const detailUrl = "https://gorunning.kr/races/1200/generic-organizer-race/";
    installFetchRoutes({
      [listUrl]: `<div id="race-2026-09-20"><table><tr><td>1</td><td><a href="/races/1200/generic-organizer-race/">운영사 홈 연결 마라톤</a></td><td><span>10km</span></td><td>서울</td><td>한강공원</td><td>주최자</td></tr></table></div>`,
      [detailUrl]:
        '<title>운영사 홈 연결 마라톤 - 고러닝</title><p>Website</p><p><a href="https://generic-organizer.example/">https://generic-organizer.example/</a></p>',
    });

    const result = await GoRunningAdapter.collect({ fixtureDir: undefined, detailBudget: 1 });

    expectNoLegacyPublicFields(result);
    expect(result.discoveryCandidates[0]?.sourceDetailUrl).toBe(detailUrl);
    expect(result.traversalSeeds).toEqual([]);
  });

  it("keeps RunningMap list links as detail candidates without publishing source fields", async () => {
    const listUrl = "https://runningmap.kr/list";
    const detailUrl = "https://runningmap.kr/race/target-race-2026-05-16";
    installFetchRoutes({
      [listUrl]: `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"url":"${detailUrl}","item":{"name":"대상 마라톤","startDate":"2026-05-16","location":{"name":"서울"}}}]}</script>`,
      [detailUrl]: '<a href="/race/unrelated-race-2026-07-18">신청하기</a>',
    });

    const result = await RunningMapAdapter.collect({ fixtureDir: undefined, detailBudget: 1 });

    expect(fetchedUrls()).toEqual([listUrl, detailUrl]);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates[0]).toMatchObject({
      sourceId: "runningmap",
      sourceResultUrl: listUrl,
      sourceDetailUrl: detailUrl,
      identityEvidence: {
        titleHints: ["대상 마라톤"],
        dateHints: ["2026-05-16"],
        organizerHints: [],
      },
    });
    expect(result.traversalSeeds).toEqual([]);
    expect(result.stageCounters).toEqual({
      discoveryCandidates: 1,
      sourceDetailsFetched: 1,
      traversalSeeds: 0,
      rejectedCandidates: 1,
      budgetSkipped: 0,
    });
  });

  it("does not fetch an external Marathon Moa fallback detail URL", async () => {
    const listUrl = "https://marathon.me.kr/events";
    installFetchRoutes({
      [listUrl]:
        '<article class="race-card"><a href="https://attacker.example/race/501">외부 상세 마라톤</a><span>2026-08-01</span></article>',
      "https://attacker.example/race/501": "<p>internal target</p>",
    });

    await MarathonMoaAdapter.collect({ fixtureDir: undefined, detailBudget: 1 });

    expect(fetchedUrls()).toEqual([listUrl]);
  });

  it("emits explicit official/application links from detail fixtures without network", async () => {
    for (const item of cases) {
      trapNetwork();
      const result = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "official"),
        detailBudget: 5,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expectNoLegacyPublicFields(result);
      const candidate = result.discoveryCandidates[0];
      expect(candidate).toBeDefined();
      if (candidate === undefined) continue;
      expect(result.traversalSeeds.map((link) => ({ kind: link.kind, url: link.url }))).toEqual(
        item.expectedSeeds,
      );
      for (const seed of result.traversalSeeds) {
        expect(seed).toMatchObject({ sourceId: item.adapter.id, evidence: "explicit-label" });
      }
    }
  });

  it("rejects negative fixtures, respects zero budget, and isolates missing details", async () => {
    for (const item of cases) {
      for (const variant of ["negative", "missing-detail"] as const) {
        trapNetwork();
        const result = await item.adapter.collect({
          fixtureDir: fixtureDir(item, variant),
          detailBudget: 5,
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(result.metadata.succeeded).toBe(true);
        expect(result.traversalSeeds).toEqual([]);
        expect(result.metadata.message).not.toContain("official-site accepted");
        expectNoLegacyPublicFields(result);
      }
      trapNetwork();
      const zero = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "official"),
        detailBudget: 0,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(zero.traversalSeeds).toEqual([]);
      expectNoLegacyPublicFields(zero);
    }
  });
  it("uses collision-free fixture keys for /race/view/a-b and /race/view/a_b", async () => {
    trapNetwork();
    const em = await EMarathonAdapter.collect({
      fixtureDir: `${FIXTURES_DIR}/emarathon/collision`,
      detailBudget: 5,
    });
    const rm = await RunningMapAdapter.collect({
      fixtureDir: `${FIXTURES_DIR}/runningmap/collision`,
      detailBudget: 5,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const emKeys = em.discoveryCandidates.map(
      (candidate) =>
        `${candidate.identityEvidence.titleHints[0]}|${candidate.identityEvidence.dateHints[0]}`,
    );
    expect(new Set(emKeys).size).toBe(2);
    expect(em.traversalSeeds.map((link) => link.url)).toEqual([
      "https://official-collision.example/a-b",
      "https://official-collision.example/a_b",
    ]);
    const rmKeys = rm.discoveryCandidates.map(
      (candidate) =>
        `${candidate.identityEvidence.titleHints[0]}|${candidate.identityEvidence.dateHints[0]}`,
    );
    expect(new Set(rmKeys).size).toBe(2);
    expect(rm.traversalSeeds.map((link) => [link.dedupKey, link.url])).toEqual([
      [rm.traversalSeeds[0]?.dedupKey, "https://official-collision.example/map-a-b"],
      [rm.traversalSeeds[1]?.dedupKey, "https://official-collision.example/map-a_b"],
    ]);
    expectNoLegacyPublicFields(em);
  });
});
