import { describe, expect, it } from "vitest";
import type { Race } from "../src/contract.js";
import {
  dedupKey,
  deduplicateRaces,
  mergeRaces,
  normalizeRaceName,
  sortRaces,
} from "../src/normalize.js";

function makeRace(overrides: Partial<Race>): Race {
  const now = "2025-01-15T12:00:00.000Z";
  return {
    name: "Test Race",
    eventDate: "2025-06-01",
    registrationDeadline: null,
    venue: "서울",
    courses: [{ name: "풀", price: 50000 }],
    applicationUrl: "https://example.com",
    sources: ["test"],
    verified: false,
    lastVerified: null,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: "unknown",
    ...overrides,
  };
}

describe("normalizeRaceName", () => {
  it("collapses whitespace and strips trailing 마라톤", () => {
    expect(normalizeRaceName("제  25회  서울국제마라톤")).toBe("서울국제");
  });

  it("removes bracket content", () => {
    expect(normalizeRaceName("서울마라톤 [2025]")).toBe("서울마라톤");
  });

  it("removes parentheses", () => {
    expect(normalizeRaceName("서울마라톤 (국제)")).toBe("서울마라톤");
  });

  it("removes ordinal prefix 제N회 and trailing 마라톤", () => {
    expect(normalizeRaceName("제25회 서울국제마라톤")).toBe("서울국제");
  });

  it("normalizes case", () => {
    expect(normalizeRaceName("SEOUL MARATHON")).toBe("seoul marathon");
  });

  it("handles empty string", () => {
    expect(normalizeRaceName("")).toBe("");
  });

  it("strips trailing 마라톤", () => {
    expect(normalizeRaceName("서울 마라톤")).toBe("서울");
  });
});

describe("deduplicateRaces", () => {
  it("derives a region when the venue explicitly names one", () => {
    // Given a venue that names Seoul
    const race = makeRace({ venue: "서울특별시 마포구 평화의공원" });

    // When the record is prepared for publication
    const deduplicated = deduplicateRaces([race]);

    // Then the region filter can include the race
    expect(deduplicated[0]?.region).toBe("서울");
  });

  it("decodes HTML ampersand entities in published names", () => {
    const race = makeRace({ name: "시포레 RUN &amp; FIT", eventDate: "2026-07-15" });

    const deduplicated = deduplicateRaces([race]);

    expect(deduplicated[0]?.name).toBe("시포레 RUN & FIT");
  });

  it("excludes page titles and leaked markup", () => {
    const valid = makeRace({ name: "서울 마라톤", eventDate: "2026-03-15" });
    const pageTitle = makeRace({ name: "2026년 07월 마라톤 대회 일정", eventDate: "2026-07-01" });
    const markup = makeRace({ name: '가수 션 공연 class="w-full"', eventDate: "2026-07-12" });
    const markupVenue = makeRace({
      eventDate: "2026-07-13",
      venue: '&amp; 가수 션 공연) 🏃‍♂️🔥" class="w-full"',
    });
    const attributeVenue = makeRace({
      eventDate: "2026-07-14",
      venue: '·결과·참가자 후기를 고러닝에서 확인하세요.">',
    });

    const deduplicated = deduplicateRaces([valid, pageTitle, markup, markupVenue, attributeVenue]);

    expect(deduplicated).toHaveLength(3);
    expect(deduplicated[0]?.name).toBe(valid.name);
    expect(deduplicated[1]?.venue).toBe("미상");
    expect(deduplicated[2]?.venue).toBe("미상");
  });

  it("excludes review pages instead of publishing them as races", () => {
    const review = makeRace({ name: "지난 마라톤 대회 결과 및 후기" });

    expect(deduplicateRaces([review])).toEqual([]);
  });

  it("excludes generic navigation and registration placeholders", () => {
    const placeholders = ["마라톤 대회", "KorMarathon", "대회 등록 안내"].map((name) =>
      makeRace({ name }),
    );

    expect(deduplicateRaces(placeholders)).toEqual([]);
  });
});

describe("dedupKey", () => {
  it("generates consistent keys", () => {
    const race = makeRace({ name: "제25회 서울국제마라톤", eventDate: "2025-03-16" });
    const key = dedupKey(race);
    expect(key).toContain("2025-03-16");
    // normalizeRaceName strips 제N회 and trailing 마라톤
    expect(key).toContain("서울국제");
  });

  it("different races get different keys", () => {
    const a = makeRace({ name: "서울마라톤", eventDate: "2025-03-16" });
    const b = makeRace({ name: "부산마라톤", eventDate: "2025-05-18" });
    expect(dedupKey(a)).not.toBe(dedupKey(b));
  });
});

describe("mergeRaces", () => {
  it("preserves primary source name", () => {
    const existing = makeRace({
      name: "서울국제마라톤",
      sources: ["gorunning"],
    });
    const incoming = makeRace({
      name: "서울 국제 마라톤대회",
      sources: ["kormarathon"],
    });
    const merged = mergeRaces(existing, incoming);
    expect(merged.name).toBe("서울국제마라톤");
    expect(merged.sources).toContain("gorunning");
    expect(merged.sources).toContain("kormarathon");
  });

  it("does not manufacture a date from null", () => {
    const existing = makeRace({
      eventDate: "2025-03-16",
      registrationDeadline: null,
    });
    const incoming = makeRace({
      eventDate: "2025-03-16",
      registrationDeadline: "2025-02-28",
    });
    const merged = mergeRaces(existing, incoming);
    expect(merged.registrationDeadline).toBe("2025-02-28");
  });

  it("keeps non-null venue over 미상", () => {
    const existing = makeRace({ venue: "미상" });
    const incoming = makeRace({ venue: "서울시청" });
    const merged = mergeRaces(existing, incoming);
    expect(merged.venue).toBe("서울시청");
  });

  it("never drops an existing price", () => {
    const existing = makeRace({
      courses: [{ name: "풀", price: 70000 }],
    });
    const incoming = makeRace({
      courses: [{ name: "풀", price: null }],
    });
    const merged = mergeRaces(existing, incoming);
    expect(merged.courses[0]?.price).toBe(70000);
  });
});

describe("deduplicateRaces", () => {
  it("deduplicates races with same name+date", () => {
    const races = [
      makeRace({ name: "서울마라톤", eventDate: "2025-03-16", sources: ["gorunning"] }),
      makeRace({ name: "서울마라톤", eventDate: "2025-03-16", sources: ["kormarathon"] }),
    ];
    const deduped = deduplicateRaces(races);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.sources).toContain("gorunning");
    expect(deduped[0]?.sources).toContain("kormarathon");
  });

  it("keeps distinct races separate", () => {
    const races = [
      makeRace({ name: "서울마라톤", eventDate: "2025-03-16" }),
      makeRace({ name: "부산마라톤", eventDate: "2025-05-18" }),
    ];
    const deduped = deduplicateRaces(races);
    expect(deduped).toHaveLength(2);
  });
});

describe("sortRaces", () => {
  it("sorts by eventDate then name", () => {
    const races = [
      makeRace({ name: "B Race", eventDate: "2025-06-01" }),
      makeRace({ name: "A Race", eventDate: "2025-03-16" }),
      makeRace({ name: "A Race", eventDate: "2025-03-16" }),
    ];
    const sorted = sortRaces(races);
    expect(sorted[0]?.eventDate).toBe("2025-03-16");
    expect(sorted[2]?.eventDate).toBe("2025-06-01");
  });
});
