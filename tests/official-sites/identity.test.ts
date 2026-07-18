import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { checkOfficialPageIdentity } from "../../src/official-sites/identity.js";
import type { OfficialPageData } from "../../src/official-sites/parser.js";

const race: Race = {
  name: "2026 서울국제마라톤",
  eventDate: "2026-03-15",
  registrationDeadline: null,
  venue: "미상",
  courses: [],
  applicationUrl: "https://source.example",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "unknown",
};
const page = (overrides: Partial<OfficialPageData>): OfficialPageData => ({
  names: [],
  eventDate: null,
  venue: null,
  registrationDeadline: null,
  courses: [],
  registrationUrl: null,
  eventDates: [],
  events: [],
  bodyNames: overrides.names ?? [],
  bodyEventDates:
    overrides.eventDates ??
    (overrides.eventDate === null || overrides.eventDate === undefined
      ? []
      : [overrides.eventDate]),
  bodyVenue: overrides.venue ?? null,
  bodyRegistrationDeadline: overrides.registrationDeadline ?? null,
  bodyCourses: overrides.courses ?? [],
  bodyRegistrationUrl: overrides.registrationUrl ?? null,
  ...overrides,
});

describe("checkOfficialPageIdentity", () => {
  it("accepts a containment name match with exact full published date", () => {
    expect(
      checkOfficialPageIdentity(race, page({ names: ["서울국제"], eventDate: "2026-03-15" })),
    ).toMatchObject({ accepted: true });
  });

  it("rejects when any explicitly published full race date conflicts", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          names: ["서울국제마라톤"],
          eventDate: "2026-03-15",
          eventDates: ["2026-03-15", "2027-03-15"],
        }),
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
  });

  it("rejects repeated labeled race dates when a later date conflicts", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          names: ["서울국제마라톤"],
          eventDate: "2026-03-15",
          eventDates: ["2026-03-15", "2027-03-15"],
        }),
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
  });

  it("rejects conflicting dates collected from later JSON-LD Events while accepting deduped repeats", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          names: ["2026 서울국제마라톤", "2027 서울국제마라톤"],
          eventDate: "2026-03-15",
          eventDates: ["2026-03-15", "2027-03-15"],
        }),
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          names: ["2026 서울국제마라톤", "서울국제마라톤"],
          eventDate: "2026-03-15",
          eventDates: ["2026-03-15"],
        }),
      ),
    ).toMatchObject({ accepted: true });
  });

  it("rejects short identity names below four alphanumeric/Korean chars", () => {
    expect(checkOfficialPageIdentity(race, page({ names: ["서울"] }))).toEqual({
      accepted: false,
      reason: "name-too-short",
    });
  });

  it("rejects mismatched names and conflicting race dates", () => {
    expect(checkOfficialPageIdentity(race, page({ names: ["부산바다마라톤"] }))).toEqual({
      accepted: false,
      reason: "name-mismatch",
    });
    expect(
      checkOfficialPageIdentity(race, page({ names: ["서울국제마라톤"], eventDate: "2027-03-15" })),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
  });
});
