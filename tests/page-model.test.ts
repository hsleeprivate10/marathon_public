import { describe, expect, it } from "vitest";
import type { Race } from "../src/contract.js";
import { groupRacesByMonth, parsePageRoute } from "../src/page-model.js";

const baseRace: Race = {
  name: "테스트 대회",
  eventDate: "2026-07-12",
  registrationDeadline: null,
  venue: "서울",
  courses: [{ name: "10K", price: null }],
  applicationUrl: "https://example.com",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-07-01T00:00:00.000Z",
  generatedAt: "2026-07-01T00:00:00.000Z",
  registrationStatus: "unknown",
};

describe("page route parsing", () => {
  it.each(["", "#"])("returns home when the hash is %j", (hash) => {
    // Given a root hash, when it is parsed, then the home page is selected.
    expect(parsePageRoute(hash)).toBe("home");
  });

  it("returns calendar when the hash targets the calendar", () => {
    // Given the calendar hash, when it is parsed, then the calendar page is selected.
    expect(parsePageRoute("#/calendar")).toBe("calendar");
  });

  it("returns home when the hash is unknown", () => {
    // Given an unsupported hash, when it is parsed, then the safe home fallback is selected.
    expect(parsePageRoute("#/unknown")).toBe("home");
  });
});

describe("race month grouping", () => {
  it("returns no groups when there are no races", () => {
    // Given no races, when they are grouped, then no month groups are returned.
    expect(groupRacesByMonth([])).toEqual([]);
  });

  it("groups races by YYYY-MM in chronological order without mutating the input", () => {
    // Given races spanning years in reverse order,
    const januaryRace: Race = { ...baseRace, name: "1월 대회", eventDate: "2027-01-03" };
    const novemberRace: Race = { ...baseRace, name: "11월 대회", eventDate: "2026-11-20" };
    const earlierNovemberRace: Race = {
      ...baseRace,
      name: "이른 11월 대회",
      eventDate: "2026-11-02",
    };
    const races: readonly Race[] = [januaryRace, novemberRace, earlierNovemberRace];

    // When they are grouped,
    const groups = groupRacesByMonth(races);

    // Then groups and their races are chronological while the input remains unchanged.
    expect(groups).toEqual([
      { month: "2026-11", races: [earlierNovemberRace, novemberRace] },
      { month: "2027-01", races: [januaryRace] },
    ]);
    expect(races).toEqual([januaryRace, novemberRace, earlierNovemberRace]);
  });
});
