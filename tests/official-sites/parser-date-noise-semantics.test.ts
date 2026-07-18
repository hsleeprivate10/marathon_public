import { describe, expect, it } from "vitest";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

describe("parseOfficialPage final date-noise semantics", () => {
  it("keeps missing JSON-LD Event dates missing and ignores footer/deadline/registration date noise", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"서울국제마라톤","location":"선택장소"}</script><h1>서울국제마라톤</h1><p>접수마감: 2026년 2월 28일</p><p>접수일시: 2026년 2월 1일</p><footer>Copyright 2024. 수정일 2027년 3월 15일</footer>`,
      "https://official.example/seoul",
    );
    expect(parsed.events?.[0]?.eventDate).toBeNull();
    expect(parsed.eventDate).toBeNull();
    expect(parsed.eventDates).toEqual([]);
    expect(parsed.bodyEventDates).toEqual([]);
    expect(parsed.registrationDeadline).toBe("2026-02-28");
  });
});
