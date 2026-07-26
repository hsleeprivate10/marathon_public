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
const year = new Date().getFullYear();
let requestedUrls: string[] = [];
const forbiddenDetailPath =
  /(?:\/admin(?:$|\/)|\/member(?:$|\/)|\/payment(?:$|\/)|\/checkout(?:$|\/)|\/file(?:$|\/)|\.pdf(?:$|[?#]))/i;

const GR_REFS =
  String.raw`/races/../../admin /races/%2e%2e/%2e%2e/admin /races/%2E%2e/%2E%2E/admin /races/%252e%252e/%252e%252e/admin /races/ok%2Fadmin /races/ok%5Cadmin /races/ok\admin /races/pay /races/payments /races/billing /races/purchase /race/view.php?idx=9101&next=/admin /race/view.php?idx=9101#admin /race/view.php?%69dx=9101 https://user:pass@gorunning.kr/races/ok http://gorunning.kr/races/ok https://gorunning.kr:444/races/ok https://gorunning.kr./races/ok https://evil.example/races/ok /race/view.php.evil?idx=9101`.split(
    " ",
  );
const KR_IDS =
  String.raw`../../admin %2e%2e/%2e%2e/admin %2E%2e/%2E%2E/admin %252e%252e/%252e%252e/admin ok%2Fadmin ok%5Cadmin ok\admin pay payments billing purchase 9101?next=/admin 9101#admin https://user:pass@www.kormarathon.com/ko/race/9101 http://www.kormarathon.com/ko/race/9101 https://www.kormarathon.com:444/ko/race/9101 https://www.kormarathon.com./ko/race/9101 https://evil.example/ko/race/9101 9101/../../admin`.split(
    " ",
  );
const EM_REFS =
  String.raw`/race/view/file.pdf /race/view/admin /race/view/member /race/view/payment /race/view/checkout /race/view/pay /race/view/payments /race/view/billing /race/view/purchase /race/view/file /race/view/%2E%2e/admin /race/view/%252e%252e/admin /race/view/ok%2Fadmin /race/view/ok%5Cadmin /race/view/ok\admin /race/view/9101?next=/admin /race/view/9101#admin https://user:pass@emarathon.or.kr/race/view/9101 http://emarathon.or.kr/race/view/9101 https://emarathon.or.kr:444/race/view/9101 https://emarathon.or.kr./race/view/9101 https://evil.example/race/view/9101 /race/view-evil/9101 http://[::1`.split(
    " ",
  );
const RM_REFS =
  String.raw`/race/payment /race/pay /race/payments /race/billing /race/purchase /race/admin /race/member /race/checkout /race/file /race/file.pdf /race/%2E%2e/payment /race/%252e%252e/payment /race/ok%2Fpayment /race/ok%5Cpayment /race/ok\payment /race/9101?next=/payment /race/9101#payment https://user:pass@runningmap.kr/race/9101 http://runningmap.kr/race/9101 https://runningmap.kr:444/race/9101 https://runningmap.kr./race/9101 https://evil.example/race/9101 /race-evil/9101 http://[::1`.split(
    " ",
  );

const cases = [
  {
    adapter: GoRunningAdapter,
    fixtureName: "gorunning",
    officialUrl: "https://official-gorun.example/race?id=9101",
    applicationUrl: "https://apply-gorun.example/register?race=9101",
  },
  {
    adapter: KorMarathonAdapter,
    fixtureName: "kormarathon",
    officialUrl: "https://official-kor.example/home?eventId=9101",
    applicationUrl: "https://apply-kor.example/start?race=9101",
  },
  {
    adapter: EMarathonAdapter,
    fixtureName: "emarathon",
    officialUrl: "https://official-emarathon.example/main?race=9101",
    applicationUrl: "https://apply-emarathon.example/register?race=9101",
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
function expectNoForbiddenFetches(): void {
  expect(fetchedUrls().filter((url) => forbiddenDetailPath.test(new URL(url).pathname))).toEqual(
    [],
  );
}
function expectNoOutputUrl(result: AdapterResult, url: string): void {
  expect(result.discoveredOfficialCandidates.map((link) => link.url)).not.toContain(url);
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
    expect(result.discoveredOfficialCandidates).toEqual([]);
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
    expect(result.discoveredOfficialCandidates).toEqual([]);
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
    expect(result.discoveredOfficialCandidates).toEqual([]);
    expect(result.stageCounters).toEqual({
      discoveryCandidates: 1,
      sourceDetailsFetched: 1,
      discoveredOfficialCandidates: 0,
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
      expect(result.discoveredOfficialCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "official-site",
            sourceId: item.adapter.id,
            url: item.officialUrl,
            evidence: "explicit-label",
          }),
        ]),
      );
      expect(result.discoveredOfficialCandidates.map((link) => link.url)).not.toContain(
        item.applicationUrl,
      );
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
        expect(result.discoveredOfficialCandidates).toEqual([]);
        expect(result.metadata.message).not.toContain("official-site accepted");
        expectNoLegacyPublicFields(result);
      }
      trapNetwork();
      const zero = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "official"),
        detailBudget: 0,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(zero.discoveredOfficialCandidates).toEqual([]);
      expectNoLegacyPublicFields(zero);
    }
  });
});

describe("Todo 6 verifier regressions", () => {
  it("rejects raw/encoded traversal and sensitive/file/PDF detail refs before fetch", async () => {
    for (const ref of GR_REFS) {
      installFetchRoutes({
        "https://gorunning.kr/races/": `<a href="${ref}">제31회 경계고런마라톤</a>`,
        "https://gorunning.kr/admin": "<a>공식 홈페이지</a>",
      });
      const result = await GoRunningAdapter.collect({ fixtureDir: undefined, detailBudget: 5 });
      expect(fetchedUrls()).toEqual(["https://gorunning.kr/races/"]);
      expectNoForbiddenFetches();
      expectNoLegacyPublicFields(result);
      expect(result.discoveryCandidates).toEqual([]);
      expect(result.discoveredOfficialCandidates).toEqual([]);
    }
    for (const identifier of KR_IDS) {
      installFetchRoutes({
        "https://www.kormarathon.com/ko/marathon-calendar": `<script type="application/ld+json">{"@type":"Event","name":"제31회 경계코리아마라톤","startDate":"2026-08-01","identifier":"${identifier}","location":{"name":"대전"}}</script>`,
        "https://www.kormarathon.com/admin": "<a>공식 홈페이지</a>",
      });
      const result = await KorMarathonAdapter.collect({ fixtureDir: undefined, detailBudget: 5 });
      expect(fetchedUrls()).toEqual(["https://www.kormarathon.com/ko/marathon-calendar"]);
      expectNoForbiddenFetches();
      expectNoOutputUrl(result, "https://www.kormarathon.com/admin");
      expect(result.discoveredOfficialCandidates).toEqual([]);
      expectNoLegacyPublicFields(result);
    }
    for (const ref of EM_REFS) {
      const listUrl = `https://emarathon.or.kr/bbs/board.php?bo_table=emara04_01&add=${year}`;
      const fetchUrl = ref.startsWith("/") ? `https://emarathon.or.kr${ref}` : ref;
      installFetchRoutes({
        [listUrl]: `<tr class="race-item"><td><a href="${ref}">제31회 경계이마라톤</a></td><td>2026-09-01</td><td>장소: 인천</td><td>종목: 10km</td><td>30,000원</td></tr>`,
        [fetchUrl]: "<a>공식 홈페이지</a>",
      });
      const result = await EMarathonAdapter.collect({ fixtureDir: undefined, detailBudget: 5 });
      expect(fetchedUrls()).toEqual([listUrl]);
      expectNoForbiddenFetches();
      expectNoOutputUrl(result, fetchUrl);
      expect(result.discoveredOfficialCandidates).toEqual([]);
      expectNoLegacyPublicFields(result);
    }
    for (const ref of RM_REFS) {
      const fetchUrl = ref.startsWith("/") ? `https://runningmap.kr${ref}` : ref;
      installFetchRoutes({
        "https://runningmap.kr/list": `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"url":"${ref}","item":{"name":"제31회 경계러닝맵마라톤","startDate":"2026-10-01","location":{"name":"부산"}}}]}</script>`,
        [fetchUrl]: "<a>공식 홈페이지</a>",
      });
      const result = await RunningMapAdapter.collect({ fixtureDir: undefined, detailBudget: 5 });
      expect(fetchedUrls()).toEqual(["https://runningmap.kr/list"]);
      expectNoForbiddenFetches();
      expect(result.discoveryCandidates).toEqual([]);
      expect(result.discoveredOfficialCandidates).toEqual([]);
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
    expect(em.discoveredOfficialCandidates.map((link) => link.url)).toEqual([
      "https://official-collision.example/a-b",
      "https://official-collision.example/a_b",
    ]);
    const rmKeys = rm.discoveryCandidates.map(
      (candidate) =>
        `${candidate.identityEvidence.titleHints[0]}|${candidate.identityEvidence.dateHints[0]}`,
    );
    expect(new Set(rmKeys).size).toBe(2);
    expect(rm.discoveredOfficialCandidates.map((link) => [link.dedupKey, link.url])).toEqual([
      [rm.discoveredOfficialCandidates[0]?.dedupKey, "https://official-collision.example/map-a-b"],
      [rm.discoveredOfficialCandidates[1]?.dedupKey, "https://official-collision.example/map-a_b"],
    ]);
    expectNoLegacyPublicFields(em);
  });
});

describe("detail-rich adapter event logo extraction", () => {
  const logoCases = [
    {
      adapter: GoRunningAdapter,
      fixtureName: "gorunning",
    },
    {
      adapter: KorMarathonAdapter,
      fixtureName: "kormarathon",
    },
    {
      adapter: EMarathonAdapter,
      fixtureName: "emarathon",
    },
  ] as const;

  it("attaches event-specific logos from already fetched detail fixtures without network", async () => {
    for (const item of logoCases) {
      trapNetwork();
      const result = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "logo-positive"),
        detailBudget: 1,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expectNoLegacyPublicFields(result);
      expect(result.discoveryCandidates).toHaveLength(1);
    }
  });

  it("omits generic, cross-event, missing-detail, and zero-budget logos", async () => {
    for (const item of logoCases) {
      trapNetwork();
      const negative = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "logo-negative"),
        detailBudget: 1,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expectNoLegacyPublicFields(negative);
      expect(negative.discoveredOfficialCandidates).toEqual([]);

      trapNetwork();
      const zero = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "logo-positive"),
        detailBudget: 0,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expectNoLegacyPublicFields(zero);
      expect(zero.discoveredOfficialCandidates).toEqual([]);
    }
  });
});
