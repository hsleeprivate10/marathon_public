import { describe, expect, it } from "vitest";
import { CollectionOutputSchema, RaceSchema, SourceRecordSchema } from "../src/contract.js";

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
  it("retains logoUrl while removing collection-only urlScheme from public output", () => {
    const logoUrl = "https://cdn.example.com/races/public-race-logo.png";
    const race = RaceSchema.parse({
      name: "Public Race",
      eventDate: "2026-09-20",
      registrationDeadline: null,
      venue: "Seoul",
      courses: [],
      applicationUrl: "https://example.com/public-race",
      logoUrl,
      urlScheme: "https://identity.example/public-race",
      sources: ["test"],
      verified: false,
      lastVerified: null,
      updatedAt: "2026-01-02T03:04:05.000Z",
      generatedAt: "2026-01-02T03:04:05.000Z",
      registrationStatus: "unknown",
    });

    const result = CollectionOutputSchema.parse({
      generatedAt: "2026-01-02T03:04:05.000Z",
      races: [race],
      collectionMetadata: [],
    });

    expect(result.races[0]?.logoUrl).toBe(logoUrl);
    expect(result.races[0]).not.toHaveProperty("urlScheme");
  });

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
    const logoUrl = "https://cdn.example.com/races/test-race-logo.png";
    const result = CollectionOutputSchema.safeParse({
      generatedAt: "2025-01-15T12:00:00.000Z",
      races: [
        {
          name: "Test Race",
          eventDate: "2025-06-01",
          registrationDeadline: null,
          venue: "Seoul",
          courses: [{ name: "10K", price: 50000 }],
          applicationUrl: "https://example.com/event",
          officialSiteUrl,
          logoUrl,
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
      expect(result.data.races[0]?.logoUrl).toBe(logoUrl);
    }
  });
});
