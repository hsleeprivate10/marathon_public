import { describe, expect, it } from "vitest";
import type { Race } from "../src/contract.js";
import { filterRaces } from "../src/filters.js";

const baseRace: Race = {
  name: "테스트 대회",
  eventDate: "2026-07-12",
  registrationDeadline: null,
  venue: "서울",
  region: "서울",
  courses: [{ name: "10K", price: null }],
  applicationUrl: "https://example.com",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-07-01T00:00:00.000Z",
  generatedAt: "2026-07-01T00:00:00.000Z",
  registrationStatus: "unknown",
};

describe("calendar filters", () => {
  it("treats empty filters as wildcards", () => {
    const races = [baseRace, { ...baseRace, name: "부산 대회", region: "부산", venue: "부산" }];

    expect(filterRaces(races, { region: "", distance: "", status: "" })).toEqual(races);
  });

  it("keeps only races matching the active region filter", () => {
    const busanRace: Race = { ...baseRace, name: "부산 대회", region: "부산", venue: "부산" };

    expect(
      filterRaces([baseRace, busanRace], { region: "서울", distance: "", status: "" }),
    ).toEqual([baseRace]);
  });

  it("keeps only races matching the active distance filter", () => {
    const halfRace: Race = {
      ...baseRace,
      name: "하프 대회",
      courses: [{ name: "하프", price: null }],
    };

    expect(filterRaces([baseRace, halfRace], { region: "", distance: "10K", status: "" })).toEqual([
      baseRace,
    ]);
  });

  it("keeps only races matching the active status filter", () => {
    const closedRace: Race = { ...baseRace, name: "마감 대회", registrationStatus: "closed" };

    expect(
      filterRaces([baseRace, closedRace], { region: "", distance: "", status: "unknown" }),
    ).toEqual([baseRace]);
  });

  it("keeps only races matching every active filter", () => {
    const wrongRegion: Race = { ...baseRace, name: "부산 대회", region: "부산" };
    const wrongCourse: Race = {
      ...baseRace,
      name: "하프 대회",
      courses: [{ name: "하프", price: null }],
    };
    const wrongStatus: Race = { ...baseRace, name: "마감 대회", registrationStatus: "closed" };

    expect(
      filterRaces([baseRace, wrongRegion, wrongCourse, wrongStatus], {
        region: "서울",
        distance: "10K",
        status: "unknown",
      }),
    ).toEqual([baseRace]);
  });

  it("excludes races missing an active region or course", () => {
    const missingRegion: Race = { ...baseRace, name: "지역 미정", region: undefined };
    const missingCourse: Race = { ...baseRace, name: "코스 미정", courses: [] };

    expect(
      filterRaces([missingRegion, missingCourse], {
        region: "서울",
        distance: "10K",
        status: "",
      }),
    ).toEqual([]);
  });

  it("returns no races when no race matches", () => {
    expect(filterRaces([baseRace], { region: "부산", distance: "", status: "" })).toEqual([]);
  });
});
