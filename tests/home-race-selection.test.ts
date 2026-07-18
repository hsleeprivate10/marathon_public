import { describe, expect, it } from "vitest";
import { raceSelectionOptions, visibleRaceMonths } from "../src/home-race-selection.js";

const raceMonths = ["2026-02", "2026-03", "2026-11", "2027-02", "2027-04"] as const;

describe("homepage race selection options", () => {
  it("offers all known years and month numbers when year is all", () => {
    // Given race sections across two years, when all years are selected, then all options are unique.
    expect(raceSelectionOptions(raceMonths, "")).toEqual({
      years: ["2026", "2027"],
      months: ["02", "03", "04", "11"],
    });
  });

  it("offers only month numbers available in a selected year", () => {
    // Given race sections across two years, when 2027 is selected, then only its months are offered.
    expect(raceSelectionOptions(raceMonths, "2027").months).toEqual(["02", "04"]);
  });
});

describe("homepage race section filtering", () => {
  it.each([
    [{ year: "", month: "" }, raceMonths],
    [{ year: "2027", month: "" }, ["2027-02", "2027-04"]],
    [{ year: "", month: "02" }, ["2026-02", "2027-02"]],
    [{ year: "2026", month: "03" }, ["2026-03"]],
    [{ year: "2027", month: "11" }, []],
  ])("returns exact visible sections for selection %j", (selection, expected) => {
    // Given known race months, when a year/month pair is applied, then only exact matches remain.
    expect(visibleRaceMonths(raceMonths, selection)).toEqual(expected);
  });
});
