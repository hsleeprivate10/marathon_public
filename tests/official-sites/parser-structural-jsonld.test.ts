import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { checkOfficialPageIdentity } from "../../src/official-sites/identity.js";
import { mergeOfficialPage } from "../../src/official-sites/merge.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

const race: Race = {
  name: "2026 서울국제마라톤",
  eventDate: "2026-03-15",
  registrationDeadline: null,
  venue: "미상",
  courses: [{ name: "풀", price: null }],
  applicationUrl: "https://source.example/apply",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "unknown",
};

function merge(html: string) {
  return mergeOfficialPage(
    race,
    parseOfficialPage(html, "https://official.example/seoul"),
    "https://official.example/final",
    "2026-01-02T00:00:00.000Z",
  );
}

describe("structural JSON-LD official parser", () => {
  it("detects only exact parse5 script type application/ld+json attributes", () => {
    const exact = parseOfficialPage(
      `<script TYPE="application/ld+json" data-x="1">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15"}</script>`,
      "https://official.example/seoul",
    );
    expect(exact.eventDate).toBe("2026-03-15");
    expect(exact.names).toEqual(["2026 서울국제마라톤"]);

    for (const attrs of [
      `notype="application/ld+json"`,
      `data-type="application/ld+json"`,
      `x-type="application/ld+json"`,
      "",
      `type="application/ld+json; charset=utf-8"`,
      `type=" application/ld+json"`,
      `type="application/ld+json "`,
    ]) {
      const parsed = parseOfficialPage(
        `<script ${attrs}>{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15"}</script>`,
        "https://official.example/seoul",
      );
      expect(parsed.eventDate, attrs).toBeNull();
      expect(parsed.names, attrs).toEqual([]);
    }
  });

  it("merges the target second Event without contamination from an unrelated first Event", () => {
    const result = merge(
      `<script type="application/ld+json">{"@type":"Event","name":"부산바다마라톤","startDate":"2026-03-15","location":"부산","registrationDeadline":"2026-01-01","registrationUrl":"https://busan.example/apply","offers":[{"name":"10K","price":"10000"}]}</script>
      <script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"서울","registrationDeadline":"2026-02-28","registrationUrl":"https://apply.example/seoul","offers":[{"name":"하프","price":"55000"}]}</script>`,
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.venue).toBe("서울");
    expect(result.race.registrationDeadline).toBe("2026-02-28");
    expect(result.race.applicationUrl).toBe("https://apply.example/seoul");
    expect(result.race.courses).toEqual([
      { name: "풀", price: null },
      { name: "하프", price: 55000, priceSource: "structured" },
    ]);
  });

  it("rejects same-name later conflicting dates but ignores unrelated different-date Events", () => {
    const conflicting = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15"}</script>
      <script type="application/ld+json">{"@type":"Event","name":"서울국제마라톤","startDate":"2027-03-15"}</script>`,
      "https://official.example/seoul",
    );
    expect(checkOfficialPageIdentity(race, conflicting)).toEqual({
      accepted: false,
      reason: "date-mismatch",
    });

    const unrelated = merge(
      `<script type="application/ld+json">{"@type":"Event","name":"부산바다마라톤","startDate":"2027-03-15","location":"부산"}</script>
      <script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"서울"}</script>`,
    );
    expect(unrelated.accepted).toBe(true);
    if (!unrelated.accepted) throw new Error(unrelated.reason);
    expect(unrelated.race.venue).toBe("서울");
  });

  it("selects the first same-name exact-date Event deterministically across duplicates", () => {
    const result = merge(
      `<script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"첫 서울","offers":[{"name":"풀","price":"70000"}]}</script>
      <script type="application/ld+json">{"@type":"Event","name":"서울국제마라톤","eventDate":"2026-03-15","location":"둘째 서울","offers":[{"name":"하프","price":"55000"}]}</script>`,
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.venue).toBe("첫 서울");
    expect(result.race.courses).toContainEqual({
      name: "풀",
      price: 70000,
      priceSource: "structured",
    });
  });

  it("preserves arrays, @graph, malformed script isolation, and body fallback", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{bad json</script>
      <script type="application/ld+json">[{"@type":"Organization","name":"Org"},{"@graph":[{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15"}]}]</script>
      <script type="application/ld+json">not json</script>`,
      "https://official.example/seoul",
    );
    expect(parsed.eventDates).toEqual(["2026-03-15"]);
    expect(parsed.names).toEqual(["2026 서울국제마라톤"]);

    const fallback = merge(
      "<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><p>장소: 서울광장</p><p>참가종목: 10K 40000원</p>",
    );
    expect(fallback.accepted).toBe(true);
    if (!fallback.accepted) throw new Error(fallback.reason);
    expect(fallback.race.name).toBe(race.name);
    expect(fallback.race.eventDate).toBe(race.eventDate);
    expect(fallback.race.venue).toBe("서울광장");
  });
});
