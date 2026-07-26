import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { mergeOfficialPage } from "../../src/official-sites/merge.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

const baseRace = (overrides: Partial<Race> = {}): Race => ({
  name: "2026 서울국제마라톤",
  eventDate: "2026-03-15",
  registrationDeadline: null,
  venue: "미상",
  courses: [
    { name: "풀", price: null },
    { name: "5K", price: 10000 },
  ],
  applicationUrl: "https://source.example/apply",
  sources: ["gorunning"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "unknown",
  ...overrides,
});

describe("official page materialization", () => {
  it.each([
    [
      "official name",
      {
        names: [],
        eventDate: "2026-03-15",
        eventDates: ["2026-03-15"],
        venue: "서울월드컵공원 평화광장",
        registrationDeadline: null,
        courses: [],
        registrationUrl: null,
      },
      "no-name",
    ],
    [
      "official event date",
      {
        names: ["2026 서울국제마라톤"],
        eventDate: null,
        eventDates: [],
        venue: "서울월드컵공원 평화광장",
        registrationDeadline: null,
        courses: [],
        registrationUrl: null,
      },
      "missing-event-date",
    ],
    [
      "official venue",
      {
        names: ["2026 서울국제마라톤"],
        eventDate: "2026-03-15",
        eventDates: ["2026-03-15"],
        venue: null,
        registrationDeadline: null,
        courses: [],
        registrationUrl: null,
      },
      "missing-venue",
    ],
  ])(
    "rejects when %s is absent instead of falling back to source hints",
    (_field, parsed, reason) => {
      const race = baseRace({
        venue: "가짜 출처 장소",
        registrationDeadline: "2026-03-01",
        courses: [{ name: "풀", price: 99999 }],
        applicationUrl: "https://source.example/fake-apply",
      });

      expect(
        mergeOfficialPage(
          race,
          parsed,
          "https://official.example/final",
          "2026-01-02T00:00:00.000Z",
        ),
      ).toEqual({ accepted: false, reason });
    },
  );

  it("rejects invalid official event dates without using the source event date", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-02-30","location":"서울월드컵공원 평화광장"}</script>`,
      "https://official.example/seoul",
    );

    expect(mergeOfficialPage(baseRace(), parsed, "https://official.example/final")).toEqual({
      accepted: false,
      reason: "invalid-date",
    });
  });

  it("materializes accepted races only from official fields and drops fully populated source hints", () => {
    const race = baseRace({
      registrationDeadline: "2026-03-01",
      venue: "가짜 출처 장소",
      courses: [
        { name: "풀", price: 99999 },
        { name: "5K", price: 88888 },
      ],
      applicationUrl: "https://source.example/fake-apply",
      logoUrl: "https://source.example/fake-logo.png",
      notes: "source-only note",
      region: "source-region",
      urlScheme: "https://source.example/identity",
      sources: ["gorunning", "marathonmoa"],
    });
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"서울월드컵공원 평화광장","offers":[{"name":"10K","price":"40000"}]}</script>`,
      "https://official.example/seoul",
    );

    const result = mergeOfficialPage(
      race,
      parsed,
      "https://official.example/final",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race).toEqual({
      name: "2026 서울국제마라톤",
      eventDate: "2026-03-15",
      registrationDeadline: null,
      venue: "서울월드컵공원 평화광장",
      courses: [{ name: "10K", price: 40000, priceSource: "structured" }],
      applicationUrl: "https://official.example/final",
      officialSiteUrl: "https://official.example/final",
      sources: ["official-sites"],
      verified: true,
      lastVerified: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      generatedAt: "2026-01-01T00:00:00.000Z",
      registrationStatus: "unknown",
    });
  });

  it("rejects conflicting transient identity hints without using them to fill official fields", () => {
    const race = baseRace({ name: "2026 부산바다마라톤", venue: "부산 출처 장소" });
    const parsed = {
      names: ["2026 서울국제마라톤"],
      eventDate: "2026-03-15",
      eventDates: ["2026-03-15"],
      venue: "서울월드컵공원 평화광장",
      registrationDeadline: null,
      courses: [],
      registrationUrl: null,
    };

    expect(mergeOfficialPage(race, parsed, "https://official.example/final")).toEqual({
      accepted: false,
      reason: "name-mismatch",
    });
  });
});
