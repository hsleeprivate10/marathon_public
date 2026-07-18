import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { checkOfficialPageIdentity } from "../../src/official-sites/identity.js";
import type { OfficialJsonLdEvent } from "../../src/official-sites/jsonld-events.js";
import type { OfficialPageData } from "../../src/official-sites/parser.js";

const race: Race = {
  name: "2026 서울국제마라톤",
  eventDate: "2026-03-15",
  registrationDeadline: null,
  venue: "미상",
  courses: [],
  applicationUrl: "https://source.example/apply",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "unknown",
};
const event = (name: string, eventDate: string | null, venue: string): OfficialJsonLdEvent => ({
  name,
  eventDate,
  eventDateStatus: eventDate === null ? { kind: "absent" } : { kind: "valid", value: eventDate },
  venue,
  registrationDeadline: null,
  courses: [],
  registrationUrl: null,
});
const page = (overrides: Partial<OfficialPageData>): OfficialPageData => ({
  names: [],
  eventDate: null,
  eventDates: [],
  venue: null,
  registrationDeadline: null,
  courses: [],
  registrationUrl: null,
  events: [],
  bodyNames: [],
  bodyEventDates: [],
  bodyVenue: null,
  bodyRegistrationDeadline: null,
  bodyCourses: [],
  bodyRegistrationUrl: null,
  ...overrides,
});

describe("identity final Event/body date semantics", () => {
  it("accepts and deterministically selects first matching undated Event without associated body race dates", () => {
    const first = event("서울국제마라톤", null, "첫 장소");
    const second = event("2026 서울국제마라톤", null, "둘째 장소");
    const result = checkOfficialPageIdentity(race, page({ events: [first, second] }));
    expect(result).toMatchObject({ accepted: true, selection: { kind: "event", event: first } });
  });

  it("accepts a matching undated Event when matching body race dates are present", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          events: [event("서울국제마라톤", null, "첫 장소")],
          bodyNames: ["서울국제마라톤"],
          bodyEventDates: ["2026-03-15"],
        }),
      ),
    ).toMatchObject({ accepted: true, selection: { kind: "event" } });
  });

  it("rejects a selected exact-date Event when associated body race dates conflict", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          events: [event("2026 서울국제마라톤", "2026-03-15", "첫 장소")],
          bodyNames: ["서울국제마라톤"],
          bodyEventDates: ["2027-03-15"],
        }),
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
  });

  it("rejects a matching undated Event when associated body race dates conflict", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          events: [event("서울국제마라톤", null, "첫 장소")],
          bodyNames: ["서울국제마라톤"],
          bodyEventDates: ["2027-03-15"],
        }),
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
  });

  it("rejects an undated matching Event when body race date conflicts even without body names", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          events: [event("서울국제마라톤", null, "오염장소")],
          bodyEventDates: ["2027-03-15"],
        }),
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
  });

  it("rejects an exact-date matching Event when body race date conflicts even without body names", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          events: [event("2026 서울국제마라톤", "2026-03-15", "오염장소")],
          bodyEventDates: ["2027-03-15"],
        }),
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
  });

  it("allows duplicate matching body race dates", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          names: ["서울국제마라톤"],
          bodyNames: ["서울국제마라톤"],
          bodyEventDates: ["2026-03-15", "2026-03-15"],
        }),
      ),
    ).toMatchObject({ accepted: true, selection: { kind: "body" } });
  });

  it("still rejects any same-name Event full date that differs", () => {
    expect(
      checkOfficialPageIdentity(
        race,
        page({
          events: [
            event("서울국제마라톤", null, "첫"),
            event("서울국제마라톤", "2027-03-15", "둘째"),
          ],
        }),
      ),
    ).toEqual({ accepted: false, reason: "date-mismatch" });
  });
});
