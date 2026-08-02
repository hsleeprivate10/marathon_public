import { readFileSync } from "node:fs";
import { marathonGoTrustedDetail, sourceDetailUrl, sourceId } from "../../src/adapters/types.js";
import type { Race } from "../../src/contract.js";

export const fixture = (name: string): string =>
  readFileSync(`tests/fixtures/official-sites/${name}`, "utf8");

export const baseRace = (overrides: Partial<Race> = {}): Race => ({
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

export const trustedSaunarunDetail = () =>
  marathonGoTrustedDetail({
    sourceId: sourceId("marathongo"),
    sourceDetailUrl: sourceDetailUrl(
      "https://marathongo.co.kr/raceDetail/domestic/saunarun-olympicpark-2026-07-31",
    ),
    eventDate: "2026-07-31",
    venue: "서울 올림픽공원 평화의광장",
  });
