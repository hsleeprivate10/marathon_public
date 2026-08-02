import { describe, expect, it } from "vitest";
import {
  applicationTraversalSeed,
  discoveredApplicationUrl,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../../src/adapters/types.js";
import type { Race } from "../../src/contract.js";
import type { OfficialFetchResult } from "../../src/official-sites/fetch.js";
import {
  type TraversalFetchPage,
  type TraversalRunBudget,
  createTraversalRunBudget,
  traverseOfficialRacePages,
} from "../../src/official-sites/traversal.js";

const VERIFIED_AT = "2026-01-02T03:04:05.000Z";

function race(): Race {
  return {
    name: "서울 한강 국제 마라톤 대회",
    eventDate: "2026-04-12",
    registrationDeadline: null,
    venue: "미상",
    courses: [],
    applicationUrl: "https://source.example/races/seoul-spring",
    sources: ["fixture"],
    verified: false,
    lastVerified: null,
    updatedAt: VERIFIED_AT,
    generatedAt: VERIFIED_AT,
    registrationStatus: "unknown",
  };
}

function appSeed(url: string) {
  const parsedUrl = discoveredApplicationUrl(url);
  if (parsedUrl === null) throw new TypeError(`unsafe fixture URL: ${url}`);
  return applicationTraversalSeed({
    dedupKey: transientIdentityHint("seoul-spring-2026"),
    sourceId: sourceId("fixture"),
    sourceDetailUrl: sourceDetailUrl("https://source.example/detail/seoul-spring"),
    identityEvidence: {
      titleHints: [transientIdentityHint("서울 한강 국제 마라톤 대회")],
      dateHints: [transientIdentityHint("2026-04-12")],
      organizerHints: [],
    },
    evidence: "explicit-label",
    url: parsedUrl,
  });
}

function success(url: string, body: string): OfficialFetchResult {
  return { kind: "success", url, address: "93.184.216.34", contentType: "text/html", body };
}

function level2(childLinks: readonly string[]): string {
  const links = childLinks.map((url) => `<a href="${url}">공식 홈페이지</a>`).join("\n");
  return `<h1>서울 한강 국제 마라톤 대회</h1><p>대회일: 2026년 4월 12일</p>${links}`;
}

function finalPage(): string {
  return "<h1>서울 한강 국제 마라톤 대회</h1><p>대회일: 2026년 4월 12일</p><p>장소: 서울 월드컵공원</p>";
}

async function runTraversal(
  load: TraversalFetchPage,
  budget: TraversalRunBudget = createTraversalRunBudget(),
  seedUrl = "https://apply.example/register",
) {
  return traverseOfficialRacePages({
    race: race(),
    seeds: [appSeed(seedUrl)],
    budget,
    verifiedAt: VERIFIED_AT,
    fetchPage: load,
  });
}

describe("traversal budgets and skips", () => {
  it("uses deterministic canonical cycle detection per race chain", async () => {
    // Given: a non-publishable level 2 page links back to the already visited input URL.
    const calls: string[] = [];
    const load: TraversalFetchPage = async (url) => {
      calls.push(url);
      return success(
        "https://race.example/register",
        level2(["https://race.example/products/seoul"]),
      );
    };

    // When: traversal sees the same final URL again.
    const result = await runTraversal(
      load,
      createTraversalRunBudget(),
      "https://race.example/products/seoul",
    );

    // Then: the cycle is skipped without a second load.
    expect(calls).toEqual(["https://race.example/products/seoul"]);
    expect(result.counts).toMatchObject({ fetched: 1, accepted: 0, policy: 0, cycle: 1 });
  });

  it("records redirected final URLs to skip an A to B to A cycle before loading A again", async () => {
    // Given: seed A redirects to non-publishable final URL B, and B links back to A.
    const calls: string[] = [];
    const load: TraversalFetchPage = async (url) => {
      calls.push(url);
      return success("https://race.example/register", level2(["https://race.example/start"]));
    };

    // When: traversal sees the child link back to the original input URL.
    const result = await runTraversal(
      load,
      createTraversalRunBudget(),
      "https://race.example/start",
    );

    // Then: A is skipped as already visited without spending a second fetch.
    expect(calls).toEqual(["https://race.example/start"]);
    expect(result.counts).toMatchObject({ fetched: 1, accepted: 0, policy: 0, cycle: 1 });
  });

  it("sorts and fetches at most three children from an accepted level 2 page", async () => {
    // Given: four out-of-order official child links on an identity-accepted page.
    const calls: string[] = [];
    const children = [
      "https://official.example/d",
      "https://official.example/b",
      "https://official.example/a",
      "https://official.example/c",
    ];
    const load: TraversalFetchPage = async (url) => {
      calls.push(url);
      return success(
        url,
        url === "https://apply.example/register" ? level2(children) : finalPage(),
      );
    };

    // When: traversal expands the level 2 page.
    const result = await runTraversal(load);

    // Then: chain depth allows only the first sorted child fetch after the level 2 fetch.
    expect(calls).toEqual(["https://apply.example/register", "https://official.example/a"]);
    expect(result.counts).toMatchObject({ fetched: 2, depth: 3, accepted: 1 });
  });

  it("shares the run budget across chains and records run-budget skips", async () => {
    // Given: a run budget already at the global limit from earlier chains.
    const load: TraversalFetchPage = async (url) => success(url, finalPage());
    const budget = createTraversalRunBudget({ maxFetches: 0 });

    // When: a new chain asks to fetch its first seed.
    const result = await runTraversal(load, budget);

    // Then: no network seam is invoked and the shared run-budget counter advances.
    expect(result.accepted).toEqual([]);
    expect(result.counts).toMatchObject({ fetched: 0, runBudget: 1 });
  });

  it("records host-budget skips before fetching an eleventh same-host request", async () => {
    // Given: this host has no remaining shared host budget.
    const load: TraversalFetchPage = async (url) => success(url, finalPage());
    const budget = createTraversalRunBudget({ maxFetchesPerHost: 0 });

    // When: traversal tries to fetch a seed on that host.
    const result = await runTraversal(load, budget);

    // Then: the host budget skip is deterministic and no fetch occurs.
    expect(result.accepted).toEqual([]);
    expect(result.counts).toMatchObject({ fetched: 0, hostBudget: 1 });
  });

  it("skips duplicate canonical input seeds before reserving shared budget", async () => {
    // Given: two input seeds point at the same canonical URL with only one run-budget slot.
    const calls: string[] = [];
    const load: TraversalFetchPage = async (url) => {
      calls.push(url);
      return success(url, finalPage());
    };
    const budget = createTraversalRunBudget({ maxFetches: 1 });

    // When: traversal processes both sorted seed entries.
    const result = await traverseOfficialRacePages({
      race: race(),
      seeds: [
        appSeed("https://apply.example/products/seoul#fragment"),
        appSeed("https://apply.example/products/seoul"),
      ],
      budget,
      verifiedAt: VERIFIED_AT,
      fetchPage: load,
    });

    // Then: the duplicate is counted as a cycle, not a run-budget skip.
    expect(calls).toEqual(["https://apply.example/products/seoul"]);
    expect(result.counts).toMatchObject({ fetched: 1, cycle: 1, runBudget: 0 });
  });

  it("records policy and fetch rejections separately", async () => {
    // Given: one traversal run receives a policy rejection and another receives a network failure.
    const rejectedLoad: TraversalFetchPage = async (url) => ({
      kind: "rejected",
      url,
      reason: "unsafe-public-url",
    });
    const failedLoad: TraversalFetchPage = async (url) => ({
      kind: "failed",
      url,
      reason: "network",
    });

    // When: each run traverses the same safe seed through different fetch outcomes.
    const rejected = await runTraversal(rejectedLoad);
    const failed = await runTraversal(failedLoad);

    // Then: URL policy and transport failures land in distinct deterministic counters.
    expect(rejected.counts).toMatchObject({ fetched: 1, policy: 1, fetch: 0 });
    expect(failed.counts).toMatchObject({ fetched: 1, policy: 0, fetch: 1 });
  });
});
