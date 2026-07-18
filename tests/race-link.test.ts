import { describe, expect, it } from "vitest";
import { safeGoRunningDetailUrl } from "../src/adapters/detail-source-url.js";
import type { Race } from "../src/contract.js";
import { raceHref } from "../src/race-link.js";

const baseRace: Race = {
  name: "테스트 대회",
  eventDate: "2026-07-12",
  registrationDeadline: null,
  venue: "서울",
  region: "서울",
  courses: [{ name: "10K", price: null }],
  applicationUrl: "https://apply.example/race",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-07-01T00:00:00.000Z",
  generatedAt: "2026-07-01T00:00:00.000Z",
  registrationStatus: "unknown",
};

describe("race card link selection", () => {
  it("uses the registration URL even when an official site is available", () => {
    const race = { ...baseRace, officialSiteUrl: "https://official.example/race" };

    expect(raceHref(race)).toBe("https://apply.example/race");
  });

  it("falls back to the application URL when no official site is available", () => {
    expect(raceHref(baseRace)).toBe("https://apply.example/race");
  });
});

describe("GoRunning detail URL policy", () => {
  it("accepts the current numeric ID and slug route", () => {
    expect(safeGoRunningDetailUrl("/races/1169/2026-kma-cheongju-free-marathon/")).toBe(
      "https://gorunning.kr/races/1169/2026-kma-cheongju-free-marathon/",
    );
  });

  it("still rejects nested sensitive routes", () => {
    expect(safeGoRunningDetailUrl("/races/1169/admin/")).toBeNull();
  });
});
