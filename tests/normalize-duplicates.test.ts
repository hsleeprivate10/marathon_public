import { describe, expect, it } from "vitest";
import type { Race } from "../src/contract.js";
import { dedupKey, deduplicateRaces } from "../src/normalize.js";

function race(name: string, applicationUrl: string, overrides: Partial<Race> = {}): Race {
  const timestamp = "2026-07-18T00:00:00.000Z";
  return {
    name,
    eventDate: "2026-09-05",
    registrationDeadline: null,
    venue: "세종마루공원",
    courses: [],
    applicationUrl,
    sources: ["gorunning"],
    verified: false,
    lastVerified: null,
    updatedAt: timestamp,
    generatedAt: timestamp,
    registrationStatus: "unknown",
    ...overrides,
  };
}

describe("cross-source duplicate normalization", () => {
  it("merges spacing variants with the same date", () => {
    const races = [
      race("2026 서울오픈마라톤", "https://seoulopen.or.kr/"),
      race("2026서울오픈마라톤", "https://other.example/apply", {
        sources: ["marathonmoa"],
      }),
    ];

    const result = deduplicateRaces(races);

    expect(result).toHaveLength(1);
    expect(result[0]?.sources).toEqual(["gorunning", "marathonmoa"]);
  });

  it("merges reordered names sharing a non-aggregator host and date", () => {
    const races = [
      race("2026 하반기 JUST RUN10 세종", "http://runten.co.kr/"),
      race("2026 JUST RUN10 하반기 세종", "https://runten.co.kr/", {
        venue: "세종 세종마루공원 밑 금강변",
        sources: ["marathonmoa"],
      }),
    ];

    expect(deduplicateRaces(races)).toHaveLength(1);
  });

  it("merges aliases with an identical non-aggregator destination", () => {
    const races = [
      race("2026 S-OIL 50주년 감동의 마라톤", "https://감동의마라톤.com/"),
      race("2026 S오일 감동의 마라톤", "http://감동의마라톤.com/", {
        sources: ["marathonmoa"],
      }),
    ];

    expect(deduplicateRaces(races)).toHaveLength(1);
  });

  it("merges transitively connected name variants", () => {
    const races = [
      race("2026 포항 이차전지 마라톤", "https://energyrun.co.kr/"),
      race("2026 포항2차전지 전국마라톤대회", "https://energyrun.co.kr/apply", {
        sources: ["emarathon"],
      }),
      race("2026포항이차전지전국마라톤", "http://energyrun.co.kr/", {
        sources: ["marathonmoa"],
      }),
    ];

    const result = deduplicateRaces(races);

    expect(result).toHaveLength(1);
    expect(result[0]?.sources).toEqual(["gorunning", "emarathon", "marathonmoa"]);
  });

  it("keeps the primary source as the identity anchor when a fallback source joins", () => {
    const races = [
      race("2026 한경서울마라톤", "http://www.hk-marathon.com/", {
        venue: "여의도공원 문화의마당",
      }),
      race("2026 한경서울마라톤", "https://emarathon.or.kr/race/123", {
        venue: "여의도공원",
        sources: ["emarathon"],
      }),
      race("2026 한경서울마라톤", "http://www.hk-marathon.com/", {
        venue: "서울 여의도 문화의공원 일원",
        sources: ["marathonmoa"],
      }),
    ];

    const result = deduplicateRaces(races);

    expect(result).toHaveLength(1);
    expect(result[0]?.sources).toEqual(["gorunning", "emarathon", "marathonmoa"]);
  });

  it("does not transitively bridge races lacking direct identity evidence", () => {
    const races = [
      race("2026 서울 봄꽃 달리기", "https://events.example/shared", {
        venue: "서울공원",
      }),
      race("2026 서울 봄꽃 바다 달리기", "https://events.example/shared", {
        venue: "서울공원",
        sources: ["emarathon"],
      }),
      race("2026 바다 달리기", "https://events.example/third", {
        venue: "서울공원",
        sources: ["marathonmoa"],
      }),
    ];

    expect(deduplicateRaces(races)).toHaveLength(2);
    expect(deduplicateRaces([...races].reverse())).toHaveLength(2);
  });

  it.each([
    "https://emarathon.or.kr",
    "https://gorunning.kr",
    "https://www.kormarathon.com",
    "https://maedal.com",
    "https://m.kaaf.or.kr",
    "https://marathon.me.kr",
    "https://marathonmate.store",
    "https://runningmap.kr",
  ])("keeps distinct races sharing aggregator fallback %s", (applicationUrl) => {
    const races = [
      race("2026 서울 평화 마라톤", `${applicationUrl}/race-a`, { venue: "서울 평화광장" }),
      race("2026 서울 평화 국제마라톤", `${applicationUrl}/race-b`, {
        venue: "서울 평화광장 일원",
        sources: ["runningmap"],
      }),
    ];

    const result = deduplicateRaces(races);

    expect(result).toHaveLength(2);
    expect(new Set(result.map(dedupKey)).size).toBe(2);
  });

  it("keeps similar names on the same external host when venues conflict", () => {
    const races = [
      race("2026 서울 평화 마라톤", "https://events.example/race-a", { venue: "서울" }),
      race("2026 서울 평화 국제마라톤", "https://events.example/race-b", {
        venue: "부산",
        sources: ["marathonmoa"],
      }),
    ];

    expect(deduplicateRaces(races)).toHaveLength(2);
  });

  it("keeps exact names on the same date when venues and destinations conflict", () => {
    const races = [
      race("2026 시민 마라톤", "https://seoul.example/apply", { venue: "서울" }),
      race("2026 시민 마라톤", "https://busan.example/apply", {
        venue: "부산",
        sources: ["marathonmoa"],
      }),
    ];

    expect(deduplicateRaces(races)).toHaveLength(2);
  });

  it("keeps unrelated names that normalize to an empty key", () => {
    const races = [
      race("[서울] 마라톤", "https://seoul.example/apply"),
      race("[부산] 마라톤", "https://busan.example/apply", { sources: ["marathonmoa"] }),
    ];

    expect(deduplicateRaces(races)).toHaveLength(2);
  });

  it("recognizes trailing-dot aggregator hosts as fallbacks", () => {
    const races = [
      race("2026 서울 평화 마라톤", "https://runningmap.kr./race-a", { venue: "서울" }),
      race("2026 서울 평화 국제마라톤", "https://runningmap.kr./race-b", {
        venue: "서울 평화광장",
        sources: ["runningmap"],
      }),
    ];

    expect(deduplicateRaces(races)).toHaveLength(2);
  });

  it("keeps the same normalized name on different dates", () => {
    const races = [
      race("2026 쿨밸리트레일레이스", "http://rocknrun.kr/", {
        eventDate: "2026-07-19",
      }),
      race("2026 쿨밸리트레일레이스", "http://rocknrun.kr/", {
        eventDate: "2026-08-01",
        sources: ["marathonmoa"],
      }),
    ];

    expect(deduplicateRaces(races)).toHaveLength(2);
  });
});
