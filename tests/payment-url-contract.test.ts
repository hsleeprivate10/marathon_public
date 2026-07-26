import { describe, expect, it } from "vitest";
import { RaceSchema } from "../src/contract.js";

const race = {
  name: "공개 URL 정책 대회",
  eventDate: "2026-12-01",
  registrationDeadline: null,
  venue: "서울",
  courses: [],
  applicationUrl: "https://race.example/event",
  sources: ["source"],
  verified: true,
  lastVerified: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
  generatedAt: "2026-07-17T00:00:00.000Z",
  registrationStatus: "open" as const,
};

describe("RaceSchema public non-payment URL contract", () => {
  it.each([
    "http://localhost/event",
    "https://race.local/event",
    "http://127.0.0.1/event",
    "http://10.0.0.1/event",
    "http://169.254.1.1/event",
    "http://[::1]/event",
    "https://payments.example/checkout",
  ])("rejects an unsafe officialSiteUrl: %s", (officialSiteUrl) => {
    expect(RaceSchema.safeParse({ ...race, officialSiteUrl }).success).toBe(false);
  });

  it("accepts a non-dedicated payment-like official hostname", () => {
    expect(
      RaceSchema.safeParse({
        ...race,
        officialSiteUrl: "https://payments-marathon.example/event",
      }).success,
    ).toBe(true);
  });

  it.each(["/register", "/apply.cgi", "/entry.pl", "/signup.cfm", "/join.shtml"])(
    "rejects a registration officialSiteUrl: %s",
    (path) =>
      expect(
        RaceSchema.safeParse({ ...race, officialSiteUrl: `https://race.example${path}` }).success,
      ).toBe(false),
  );
});
