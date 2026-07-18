import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { mergeOfficialPage } from "../../src/official-sites/merge.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

const race = (): Race => ({
  name: "2026 서울국제마라톤",
  eventDate: "2026-03-15",
  registrationDeadline: null,
  venue: "원래장소",
  courses: [{ name: "5K", price: 10000 }],
  applicationUrl: "https://source.example/apply",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "unknown",
});

describe("mergeOfficialPage final Event/body date semantics", () => {
  it("merges selected first matching undated Event fields when no explicit body race date exists", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"서울국제마라톤","location":"선택장소","offers":[{"name":"10K","price":"40000"}],"registrationUrl":"https://apply.example/undated"}</script><script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","location":"둘째장소"}</script><h1>서울국제마라톤</h1>`,
      "https://official.example/seoul",
    );
    const result = mergeOfficialPage(
      race(),
      parsed,
      "https://official.example/final",
      "2026-01-02T00:00:00.000Z",
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.name).toBe("2026 서울국제마라톤");
    expect(result.race.eventDate).toBe("2026-03-15");
    expect(result.race.venue).toBe("선택장소");
    expect(result.race.applicationUrl).toBe("https://apply.example/undated");
    expect(result.race.courses).toEqual([
      { name: "5K", price: 10000 },
      { name: "10K", price: 40000, priceSource: "structured" },
    ]);
  });

  it("rejects conflicting body context before merge and leaves race unchanged", () => {
    const original = race();
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"서울국제마라톤","location":"오염장소","registrationUrl":"https://apply.example/bad"}</script><h1>서울국제마라톤</h1><p>대회일시: 2027년 3월 15일</p><p>장소: 오염몸체</p>`,
      "https://official.example/seoul",
    );
    expect(
      mergeOfficialPage(
        original,
        parsed,
        "https://official.example/final",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toEqual({
      accepted: false,
      reason: "date-mismatch",
      race: original,
    });
  });

  it("rejects conflicting body race date without body names and leaves original race unchanged", () => {
    const original = race();
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"서울국제마라톤","location":"오염장소","registrationUrl":"https://apply.example/bad"}</script><p>대회일시: 2027년 3월 15일</p><p>장소: 오염몸체</p>`,
      "https://official.example/seoul",
    );
    expect(parsed.bodyNames).toEqual([]);
    expect(
      mergeOfficialPage(
        original,
        parsed,
        "https://official.example/final",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch", race: original });
  });

  it("rejects exact-date Event with conflicting body race date without body names", () => {
    const original = race();
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"오염장소"}</script><p>대회일시: 2027년 3월 15일</p>`,
      "https://official.example/seoul",
    );
    expect(parsed.bodyNames).toEqual([]);
    expect(
      mergeOfficialPage(
        original,
        parsed,
        "https://official.example/final",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch", race: original });
  });
});
