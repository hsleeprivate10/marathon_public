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

function applicationPage(): string {
  return `<h1>서울 한강 국제 마라톤 대회</h1>
    <p>대회일: 2026년 4월 12일</p>
    <p>장소: 신청 상품 페이지</p>
    <a href="https://official.example/final-home">공식 홈페이지</a>`;
}

describe("application-origin traversal child priority", () => {
  it("prefers explicit official children over a safe complete application-origin page", async () => {
    // Given: a safe application/product page is complete but points to the official homepage.
    const calls: { readonly url: string; readonly purpose: "official" | "traversal" }[] = [];
    const load: TraversalFetchPage = async (url, purpose) => {
      calls.push({ url, purpose });
      if (url === "https://product.example/race-2026") return success(url, applicationPage());
      return success(
        url,
        `<h1>서울 한강 국제 마라톤 대회</h1>
         <p>대회일: 2026년 4월 12일</p>
         <p>장소: 서울 월드컵공원</p>`,
      );
    };

    // When: traversal starts from the safe application/product page.
    const result = await traverseOfficialRacePages({
      race: race(),
      seeds: [appSeed("https://product.example/race-2026")],
      budget: createTraversalRunBudget(),
      verifiedAt: VERIFIED_AT,
      fetchPage: load,
    });

    // Then: the explicit official child wins at depth 3 and the application page is not accepted.
    expect(calls).toEqual([
      { url: "https://product.example/race-2026", purpose: "traversal" },
      { url: "https://official.example/final-home", purpose: "official" },
    ]);
    expect(
      result.accepted.map((page) => [page.finalUrl, page.depth, page.originSeed.kind]),
    ).toEqual([["https://official.example/final-home", 3, "application"]]);
    expect(result.accepted[0]?.originSeed.sourceDetailUrl).toBe(
      "https://source.example/detail/seoul-spring",
    );
    expect(result.accepted[0]?.page.bodyVenue).toBe("서울 월드컵공원");
    expect(result.counts).toMatchObject({ fetched: 2, accepted: 1, policy: 0, fetch: 0 });
  });

  it("does not fall back to a safe application-origin page when explicit official children reject", async () => {
    // Given: a safe complete application/product page points to an official child that later rejects.
    const calls: { readonly url: string; readonly purpose: "official" | "traversal" }[] = [];
    const load: TraversalFetchPage = async (url, purpose) => {
      calls.push({ url, purpose });
      if (url === "https://official.example/final-home") {
        return { kind: "rejected", url, reason: "http-status" };
      }
      return success(url, applicationPage());
    };

    // When: the official child is attempted and rejects.
    const result = await traverseOfficialRacePages({
      race: race(),
      seeds: [appSeed("https://product.example/race-2026")],
      budget: createTraversalRunBudget(),
      verifiedAt: VERIFIED_AT,
      fetchPage: load,
    });

    // Then: traversal fails closed instead of publishing the application/product page.
    expect(calls).toEqual([
      { url: "https://product.example/race-2026", purpose: "traversal" },
      { url: "https://official.example/final-home", purpose: "official" },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.counts).toMatchObject({ fetched: 2, accepted: 0, policy: 0, fetch: 1 });
  });
});
