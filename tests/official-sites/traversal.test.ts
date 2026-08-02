import { describe, expect, it } from "vitest";
import {
  applicationTraversalSeed,
  discoveredApplicationUrl,
  discoveredOfficialHomepageUrl,
  officialTraversalSeed,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../../src/adapters/types.js";
import type { Race } from "../../src/contract.js";
import type { OfficialFetchResult } from "../../src/official-sites/fetch.js";
import {
  type TraversalFetchPage,
  createTraversalRunBudget,
  traverseOfficialRacePages,
} from "../../src/official-sites/traversal.js";

const VERIFIED_AT = "2026-01-02T03:04:05.000Z";

function race(name = "서울 한강 국제 마라톤 대회"): Race {
  return {
    name,
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

function officialSeed(url: string) {
  const parsedUrl = discoveredOfficialHomepageUrl(url);
  if (parsedUrl === null) throw new TypeError(`unsafe fixture URL: ${url}`);
  return officialTraversalSeed({
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

describe("traverseOfficialRacePages", () => {
  it("accepts a level 3 official page verdict only after a same-race level 2 application page", async () => {
    // Given: an owned detail application seed whose level 2 page links to the official race page.
    const calls: { readonly url: string; readonly purpose: "official" | "traversal" }[] = [];
    const load: TraversalFetchPage = async (url, purpose) => {
      calls.push({ url, purpose });
      if (url === "https://apply.example/register") {
        return success(
          url,
          `<h1>서울 한강 국제 마라톤 대회</h1>
           <p>대회일: 2026년 4월 12일</p>
           <a href="https://official.example/seoul-spring">공식 홈페이지</a>`,
        );
      }
      return success(
        url,
        `<h1>서울 한강 국제 마라톤 대회</h1>
         <p>대회일: 2026년 4월 12일</p>
         <p>장소: 서울 월드컵공원</p>
         <p>참가종목: 하프 50,000원 / 10K 40,000원</p>`,
      );
    };

    // When: traversal starts from the level 2 application seed.
    const result = await traverseOfficialRacePages({
      race: race(),
      seeds: [appSeed("https://apply.example/register")],
      budget: createTraversalRunBudget(),
      verifiedAt: VERIFIED_AT,
      fetchPage: load,
    });

    // Then: the application URL is inspected but traversal returns a level 3 page verdict.
    expect(calls).toEqual([
      { url: "https://apply.example/register", purpose: "traversal" },
      { url: "https://official.example/seoul-spring", purpose: "official" },
    ]);
    expect(result.accepted.map((page) => [page.finalUrl, page.depth])).toEqual([
      ["https://official.example/seoul-spring", 3],
    ]);
    expect(result.accepted[0]).toMatchObject({
      originSeed: {
        kind: "application",
        sourceDetailUrl: "https://source.example/detail/seoul-spring",
        identityEvidence: {
          titleHints: ["서울 한강 국제 마라톤 대회"],
          dateHints: ["2026-04-12"],
        },
      },
      page: {
        bodyVenue: "서울 월드컵공원",
        bodyEventDates: ["2026-04-12"],
      },
    });
    expect(result.accepted[0]).not.toHaveProperty("race");
    expect(result.counts).toMatchObject({ accepted: 1, fetched: 2, identity: 0, policy: 0 });
  });

  it("accepts an application-origin redirected final official page as a level 2 verdict", async () => {
    // Given: an application seed resolves through fetch to a complete same-race final official URL.
    const calls: { readonly url: string; readonly purpose: "official" | "traversal" }[] = [];
    const load: TraversalFetchPage = async (url, purpose) => {
      calls.push({ url, purpose });
      return success(
        "https://official.example/final",
        `<h1>서울 한강 국제 마라톤 대회</h1>
         <p>대회일: 2026년 4월 12일</p>
         <p>장소: 서울 월드컵공원</p>`,
      );
    };

    // When: traversal inspects the application seed with traversal purpose.
    const result = await traverseOfficialRacePages({
      race: race(),
      seeds: [appSeed("https://apply.example/register")],
      budget: createTraversalRunBudget(),
      verifiedAt: VERIFIED_AT,
      fetchPage: load,
    });

    // Then: the final official URL is accepted at depth 2 with application origin evidence retained.
    expect(calls).toEqual([{ url: "https://apply.example/register", purpose: "traversal" }]);
    expect(
      result.accepted.map((page) => [page.finalUrl, page.depth, page.originSeed.kind]),
    ).toEqual([["https://official.example/final", 2, "application"]]);
    expect(result.accepted[0]?.originSeed.sourceDetailUrl).toBe(
      "https://source.example/detail/seoul-spring",
    );
    expect(result.accepted[0]?.page.bodyVenue).toBe("서울 월드컵공원");
    expect(result.accepted[0]).not.toHaveProperty("race");
    expect(result.counts).toMatchObject({ fetched: 1, accepted: 1, policy: 0, identity: 0 });
  });

  it("rejects an application-origin final registration URL without silent zero accounting", async () => {
    // Given: an application seed resolves to a same-race registration final URL with no child links.
    const load: TraversalFetchPage = async (url) =>
      success(
        url,
        `<h1>서울 한강 국제 마라톤 대회</h1>
         <p>대회일: 2026년 4월 12일</p>
         <p>장소: 서울 월드컵공원</p>`,
      );

    // When: traversal parses and identity-accepts the registration page.
    const result = await traverseOfficialRacePages({
      race: race(),
      seeds: [appSeed("https://apply.example/register")],
      budget: createTraversalRunBudget(),
      verifiedAt: VERIFIED_AT,
      fetchPage: load,
    });

    // Then: no verdict is accepted, and official-page policy rejection is counted.
    expect(result.accepted).toEqual([]);
    expect(result.counts).toMatchObject({ fetched: 1, accepted: 0, policy: 1, identity: 0 });
  });

  it("does not enqueue child links from a wrong-race level 2 page", async () => {
    // Given: an application seed resolves to a different race that also advertises an official link.
    const calls: string[] = [];
    const load: TraversalFetchPage = async (url) => {
      calls.push(url);
      return success(
        url,
        `<h1>부산 겨울 마라톤</h1>
         <p>대회일: 2026년 12월 20일</p>
         <a href="https://official.example/wrong">공식 홈페이지</a>`,
      );
    };

    // When: traversal inspects the level 2 page.
    const result = await traverseOfficialRacePages({
      race: race(),
      seeds: [appSeed("https://apply.example/register")],
      budget: createTraversalRunBudget(),
      verifiedAt: VERIFIED_AT,
      fetchPage: load,
    });

    // Then: identity rejection happens before expansion, so no second fetch occurs.
    expect(calls).toEqual(["https://apply.example/register"]);
    expect(result.accepted).toEqual([]);
    expect(result.counts).toMatchObject({ fetched: 1, identity: 1, accepted: 0 });
  });

  it("accepts a level 2 official page verdict with official fetch purpose and no child fetch", async () => {
    // Given: a direct official seed has complete same-race fields and an extra child link.
    const calls: { readonly url: string; readonly purpose: "official" | "traversal" }[] = [];
    const load: TraversalFetchPage = async (url, purpose) => {
      calls.push({ url, purpose });
      return success(
        url,
        `<h1>서울 한강 국제 마라톤 대회</h1>
         <p>대회일: 2026년 4월 12일</p>
         <p>장소: 서울 월드컵공원</p>
         <a href="https://official.example/child">공식 홈페이지</a>`,
      );
    };

    // When: traversal starts from a level 2 official seed.
    const result = await traverseOfficialRacePages({
      race: race(),
      seeds: [officialSeed("https://official.example/seoul-spring")],
      budget: createTraversalRunBudget(),
      verifiedAt: VERIFIED_AT,
      fetchPage: load,
    });

    // Then: the accepted level 2 official verdict stops without unnecessary level 3 expansion.
    expect(calls).toEqual([{ url: "https://official.example/seoul-spring", purpose: "official" }]);
    expect(
      result.accepted.map((page) => [page.finalUrl, page.depth, page.originSeed.kind]),
    ).toEqual([["https://official.example/seoul-spring", 2, "official"]]);
    expect(result.counts).toMatchObject({ accepted: 1, fetched: 1, depth: 0 });
  });
});
