import { afterEach, describe, expect, it, vi } from "vitest";
import { EMarathonAdapter } from "../src/adapters/emarathon.js";
import { GoRunningAdapter } from "../src/adapters/gorunning.js";
import { KorMarathonAdapter } from "../src/adapters/kormarathon.js";
import { RunningMapAdapter } from "../src/adapters/runningmap.js";
import type { AdapterResult } from "../src/adapters/types.js";

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

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
  expect(result.traversalSeeds.map((link) => link.url)).not.toContain(url);
}

describe("detail security verifier regressions", () => {
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
      expect(result.traversalSeeds).toEqual([]);
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
      expect(result.traversalSeeds).toEqual([]);
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
      expect(result.traversalSeeds).toEqual([]);
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
      expect(result.traversalSeeds).toEqual([]);
    }
  });
});
