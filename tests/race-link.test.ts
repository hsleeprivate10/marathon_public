import { describe, expect, it } from "vitest";
import {
  safeEMarathonDetailUrl,
  safeGoRunningDetailUrl,
  safeRunningMapDetailUrl,
} from "../src/adapters/detail-source-url.js";
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

describe("live aggregator detail URL policy", () => {
  it("accepts the current e-Marathon board detail route", () => {
    expect(
      safeEMarathonDetailUrl(
        "https://emarathon.or.kr/bbs/board.php?bo_table=emara04_01&wr_id=1594",
      ),
    ).toBe("https://emarathon.or.kr/bbs/board.php?bo_table=emara04_01&wr_id=1594");
  });

  it("accepts a current RunningMap race detail route with a Korean slug", () => {
    expect(safeRunningMapDetailUrl("/race/2026-서울신문-마라톤-2026-05-16")).toBe(
      "https://runningmap.kr/race/2026-%EC%84%9C%EC%9A%B8%EC%8B%A0%EB%AC%B8-%EB%A7%88%EB%9D%BC%ED%86%A4-2026-05-16",
    );
  });
});
