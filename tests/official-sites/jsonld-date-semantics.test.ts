import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { checkOfficialPageIdentity } from "../../src/official-sites/identity.js";
import { mergeOfficialPage } from "../../src/official-sites/merge.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

const race = (eventDate = "2026-03-15"): Race => ({
  name: "2026 서울국제마라톤",
  eventDate,
  registrationDeadline: null,
  venue: "원래장소",
  courses: [],
  applicationUrl: "https://source.example/apply",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "unknown",
});
const html = (startDate: string | undefined, name = "2026 서울국제마라톤") =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "Event",
    name,
    ...(startDate === undefined ? {} : { startDate }),
    location: "선택장소",
    registrationUrl: "https://apply.example/jsonld",
  })}</script>`;
const identity = (date: string | undefined, raceDate = "2026-03-15") =>
  checkOfficialPageIdentity(
    race(raceDate),
    parseOfficialPage(html(date), "https://official.example"),
  );

describe("JSON-LD Event date semantics", () => {
  it("accepts exact date and local-prefix ISO datetimes without timezone shift", () => {
    for (const date of [
      "2026-03-15",
      "2026-03-15T23:30:00Z",
      "2026-03-15T00:30:00+14:00",
      "2026-03-15T23:30:00-12:00",
      "2026-03-15T09:00",
      "2026-03-15T09:00:00.123",
    ]) {
      const parsed = parseOfficialPage(html(date), "https://official.example");
      expect(parsed.eventDate, date).toBe("2026-03-15");
      expect(parsed.eventDates, date).toEqual(["2026-03-15"]);
      expect(checkOfficialPageIdentity(race(), parsed), date).toMatchObject({ accepted: true });
    }
  });

  it("rejects valid datetimes whose published date prefix differs from race date", () => {
    expect(identity("2026-03-16T00:30:00+14:00")).toEqual({
      accepted: false,
      reason: "date-mismatch",
    });
  });

  it("accepts leap date/datetime and rejects impossible leap dates as invalid concrete dates", () => {
    expect(identity("2024-02-29", "2024-02-29")).toMatchObject({ accepted: true });
    expect(identity("2024-02-29T12:00:00Z", "2024-02-29")).toMatchObject({ accepted: true });
    expect(identity("2025-02-29")).toEqual({ accepted: false, reason: "invalid-date" });
  });

  it("rejects invalid concrete JSON-LD date and datetime strings instead of accepting as undated", () => {
    for (const date of [
      "2026-00-15",
      "2026-13-15",
      "2026-04-31",
      "2026/03/15",
      "2026-3-15",
      "2026-03-5",
      "2026-03-15T24:00:00Z",
      "2026-03-15T23:60:00Z",
      "2026-03-15T23:30:60Z",
      "2026-03-15T23:30:00+24:00",
      "2026-03-15T23:30:00+09",
      "2026-03-15T9:30:00Z",
    ]) {
      const parsed = parseOfficialPage(html(date), "https://official.example");
      expect(parsed.eventDate, date).toBeNull();
      expect(identity(date), date).toEqual({ accepted: false, reason: "invalid-date" });
    }
  });

  it("rejects out-of-range and malformed timezone offsets while accepting exact plus/minus fourteen", () => {
    for (const date of ["2026-03-15T23:30:00+14:00", "2026-03-15T23:30:00-14:00"]) {
      expect(identity(date), date).toMatchObject({ accepted: true });
    }
    for (const date of [
      "2026-03-15T23:30:00+14:01",
      "2026-03-15T23:30:00+15:00",
      "2026-03-15T23:30:00+09:60",
      "2026-03-15T23:30:00+0900",
      "2026-03-15T23:30:00+09",
      "2026-03-15T23:30:00+9:00",
    ]) {
      expect(identity(date), date).toEqual({ accepted: false, reason: "invalid-date" });
    }
  });

  it("rejects whitespace coercion, trailing junk, and concrete natural date-like strings", () => {
    for (const date of [
      "2026-03-15 ",
      " 2026-03-15",
      "2026-03-15abc",
      "2026.03.15",
      "2026년 3월 15일",
      "2026/03/15",
      "March 15, 2026",
      "15 March 2026",
      "2026-3-15",
      "2026-03-5",
    ]) {
      const parsed = parseOfficialPage(html(date), "https://official.example");
      expect(parsed.events?.[0]?.eventDateStatus, date).toMatchObject({ kind: "invalid" });
      expect(identity(date), date).toEqual({ accepted: false, reason: "invalid-date" });
    }
  });

  it("keeps only approved placeholders absent using trimmed case-normalized placeholder matching", () => {
    for (const date of ["TBD", " tbd ", "TBA", "추후 공지", " 추후공지 "]) {
      expect(identity(date), date).toMatchObject({ accepted: true });
    }
    for (const date of ["coming soon", "soon", "미정 아님", "공지 예정입니다"]) {
      expect(identity(date), date).toEqual({ accepted: false, reason: "invalid-date" });
    }
  });

  it("uses startDate precedence: invalid startDate is invalid even when eventDate is valid", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15 ","eventDate":"2026-03-15"}</script>`,
      "https://official.example",
    );
    expect(parsed.events?.[0]?.eventDateStatus).toMatchObject({ kind: "invalid" });
    expect(checkOfficialPageIdentity(race(), parsed)).toEqual({
      accepted: false,
      reason: "invalid-date",
    });
  });

  it("falls back to eventDate only when startDate is absent", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","eventDate":"2026-03-15"}</script>`,
      "https://official.example",
    );
    expect(parsed.eventDate).toBe("2026-03-15");
    expect(checkOfficialPageIdentity(race(), parsed)).toMatchObject({ accepted: true });
  });

  it("keeps absent and non-concrete placeholder dates undated", () => {
    for (const date of [undefined, "TBD", "추후 공지"]) {
      expect(identity(date), String(date)).toMatchObject({ accepted: true });
    }
  });

  it("ignores invalid concrete dates on unrelated Events", () => {
    const parsed = parseOfficialPage(
      `${html("2025-02-29", "부산바다마라톤")}${html("2026-03-15")}`,
      "https://official.example",
    );
    expect(checkOfficialPageIdentity(race(), parsed)).toMatchObject({ accepted: true });
  });

  it("leaves the exact original race unchanged on invalid concrete date merge rejection", () => {
    const original = race();
    const parsed = parseOfficialPage(html("2025-02-29"), "https://official.example");
    expect(mergeOfficialPage(original, parsed, "https://official.example/final")).toEqual({
      accepted: false,
      reason: "invalid-date",
      race: original,
    });
  });
});
