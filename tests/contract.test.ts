import { describe, expect, it } from "vitest";
import type { DiscoveredRaceLink } from "../src/adapters/types.js";
import {
  CollectionOutputSchema,
  RaceSchema,
  SourceRecordSchema,
  computeRegistrationStatus,
} from "../src/contract.js";
import { dedupKey } from "../src/normalize.js";

describe("RaceSchema", () => {
  const validRace = {
    name: "2025 서울국제마라톤",
    eventDate: "2025-03-16",
    registrationDeadline: "2025-02-28",
    venue: "서울시청 앞 광장",
    courses: [{ name: "풀", price: 70000 }],
    applicationUrl: "https://www.gorunning.co.kr/race/view.php?idx=1001",
    sources: ["gorunning"],
    verified: true,
    lastVerified: "2025-01-15T12:00:00.000Z",
    updatedAt: "2025-01-15T12:00:00.000Z",
    generatedAt: "2025-01-15T12:00:00.000Z",
    registrationStatus: "open" as const,
  };

  it("validates a complete race record", () => {
    const result = RaceSchema.safeParse(validRace);
    expect(result.success).toBe(true);
  });

  it("allows officialSiteUrl to be absent", () => {
    const result = RaceSchema.safeParse(validRace);
    expect(result.success).toBe(true);
  });

  it.each(["https://race.example.com/event", "http://race.example.com/event"])(
    "accepts an HTTP(S) officialSiteUrl: %s",
    (officialSiteUrl) => {
      const result = RaceSchema.safeParse({ ...validRace, officialSiteUrl });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.officialSiteUrl).toBe(officialSiteUrl);
      }
    },
  );

  it.each([
    "not-a-url",
    "javascript:alert(1)",
    "ftp://race.example.com/event",
    "https://organizer@race.example.com/event",
    "https://:secret@race.example.com/event",
    "https://organizer:secret@race.example.com/event",
  ])("rejects an unsafe officialSiteUrl: %s", (officialSiteUrl) => {
    const result = RaceSchema.safeParse({ ...validRace, officialSiteUrl });
    expect(result.success).toBe(false);
  });

  it("requires name to be non-empty", () => {
    const result = RaceSchema.safeParse({ ...validRace, name: "" });
    expect(result.success).toBe(false);
  });

  it("requires eventDate in YYYY-MM-DD format", () => {
    const result = RaceSchema.safeParse({ ...validRace, eventDate: "2025/03/16" });
    expect(result.success).toBe(false);
  });

  it.each(["2026-00-15", "2026-13-15", "2026-99-15", "2026-04-00", "2026-04-31", "2025-02-29"])(
    "rejects impossible ISO calendar eventDate: %s",
    (eventDate) => {
      expect(RaceSchema.safeParse({ ...validRace, eventDate }).success).toBe(false);
    },
  );

  it.each(["2026-00-15", "2026-13-15", "2026-99-15", "2026-04-00", "2026-04-31", "2025-02-29"])(
    "rejects impossible ISO calendar registrationDeadline: %s",
    (registrationDeadline) => {
      expect(RaceSchema.safeParse({ ...validRace, registrationDeadline }).success).toBe(false);
    },
  );

  it("accepts a real leap-day ISO calendar date", () => {
    expect(
      RaceSchema.safeParse({
        ...validRace,
        eventDate: "2024-02-29",
        registrationDeadline: "2024-02-29",
      }).success,
    ).toBe(true);
  });

  it("allows null registrationDeadline", () => {
    const result = RaceSchema.safeParse({ ...validRace, registrationDeadline: null });
    expect(result.success).toBe(true);
  });

  it("allows no courses when a source does not publish distances", () => {
    const result = RaceSchema.safeParse({ ...validRace, courses: [] });
    expect(result.success).toBe(true);
  });

  it("rejects non-canonical course text", () => {
    const result = RaceSchema.safeParse({
      ...validRace,
      courses: [{ name: "10km 솔직 후기 5만 원", price: null }],
    });
    expect(result.success).toBe(false);
  });

  it("requires at least one source", () => {
    const result = RaceSchema.safeParse({ ...validRace, sources: [] });
    expect(result.success).toBe(false);
  });

  it("allows null course price", () => {
    const result = RaceSchema.safeParse({
      ...validRace,
      courses: [{ name: "하프", price: null }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts all registration status values", () => {
    for (const status of ["open", "closing-soon", "closed", "unknown"]) {
      const result = RaceSchema.safeParse({
        ...validRace,
        registrationStatus: status,
      });
      expect(result.success).toBe(true);
    }
  });

  it("strips internal discovered-link fields from parsed races", () => {
    const result = RaceSchema.parse({
      ...validRace,
      dedupKey: dedupKey(RaceSchema.parse(validRace)),
      kind: "official-site",
      url: "https://race.example.com",
      sourceId: "gorunning",
      sourcePageUrl: validRace.applicationUrl,
      evidence: "explicit-label",
    });

    expect(result).not.toHaveProperty("dedupKey");
    expect(result).not.toHaveProperty("kind");
    expect(result).not.toHaveProperty("url");
    expect(result).not.toHaveProperty("sourceId");
    expect(result).not.toHaveProperty("sourcePageUrl");
    expect(result).not.toHaveProperty("evidence");
  });
});

describe("DiscoveredRaceLink", () => {
  it("binds an internal official-site discovery to its associated race", () => {
    const associatedRace = RaceSchema.parse({
      name: "2025 서울국제마라톤",
      eventDate: "2025-03-16",
      registrationDeadline: "2025-02-28",
      venue: "서울시청 앞 광장",
      courses: [{ name: "풀", price: 70000 }],
      applicationUrl: "https://www.gorunning.co.kr/race/view.php?idx=1001",
      sources: ["gorunning"],
      verified: true,
      lastVerified: "2025-01-15T12:00:00.000Z",
      updatedAt: "2025-01-15T12:00:00.000Z",
      generatedAt: "2025-01-15T12:00:00.000Z",
      registrationStatus: "open",
    });
    const link = {
      dedupKey: dedupKey(associatedRace),
      kind: "official-site",
      url: "https://race.example.com",
      sourceId: "gorunning",
      sourcePageUrl: "https://gorunning.kr/races/1001",
      evidence: "explicit-label",
    } satisfies DiscoveredRaceLink;
    const racesByDedupKey = new Map([[dedupKey(associatedRace), associatedRace]]);

    expect(link.dedupKey).toBe(dedupKey(associatedRace));
    expect(racesByDedupKey.get(link.dedupKey)).toBe(associatedRace);
  });
});

describe("SourceRecordSchema", () => {
  it("validates a complete source record", () => {
    const result = SourceRecordSchema.safeParse({
      id: "gorunning",
      attempted: true,
      succeeded: true,
      recordCount: 5,
      message: "Collected 5 races",
    });
    expect(result.success).toBe(true);
  });

  it("allows zero recordCount", () => {
    const result = SourceRecordSchema.safeParse({
      id: "gorunning",
      attempted: true,
      succeeded: false,
      recordCount: 0,
      message: "Failed",
    });
    expect(result.success).toBe(true);
  });
});

describe("CollectionOutputSchema", () => {
  it("validates a complete output", () => {
    const result = CollectionOutputSchema.safeParse({
      generatedAt: "2025-01-15T12:00:00.000Z",
      races: [],
      collectionMetadata: [],
    });
    expect(result.success).toBe(true);
  });

  it("validates with races and metadata", () => {
    const officialSiteUrl = "https://race.example.com/event";
    const result = CollectionOutputSchema.safeParse({
      generatedAt: "2025-01-15T12:00:00.000Z",
      races: [
        {
          name: "Test Race",
          eventDate: "2025-06-01",
          registrationDeadline: null,
          venue: "Seoul",
          courses: [{ name: "10K", price: 50000 }],
          applicationUrl: "https://example.com",
          officialSiteUrl,
          sources: ["test"],
          verified: false,
          lastVerified: null,
          updatedAt: "2025-01-15T12:00:00.000Z",
          generatedAt: "2025-01-15T12:00:00.000Z",
          registrationStatus: "open",
        },
      ],
      collectionMetadata: [
        {
          id: "test",
          attempted: true,
          succeeded: true,
          recordCount: 1,
          message: "OK",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.races[0]?.officialSiteUrl).toBe(officialSiteUrl);
    }
  });
});

describe("computeRegistrationStatus", () => {
  it("returns unknown when deadline is null", () => {
    expect(computeRegistrationStatus(null, "2025-12-31")).toBe("unknown");
  });

  it("returns closed when deadline has passed", () => {
    expect(computeRegistrationStatus("2020-01-01", "2025-12-31")).toBe("closed");
  });

  it("returns closed when event date has passed", () => {
    expect(computeRegistrationStatus("2099-01-01", "2020-01-01")).toBe("closed");
  });

  it("returns open when deadline is far in the future", () => {
    expect(computeRegistrationStatus("2099-12-31", "2099-12-31")).toBe("open");
  });
});
