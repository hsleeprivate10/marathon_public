import { describe, expect, it } from "vitest";
import { RaceSchema } from "../src/contract.js";
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

  it("retains an absolute HTTPS logoUrl without transforming it", () => {
    // Given
    const logoUrl = "https://cdn.example.com/races/seoul-logo.png?size=2#mark";

    // When
    const result = RaceSchema.safeParse({ ...validRace, logoUrl });

    // Then
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logoUrl).toBe(logoUrl);
    }
  });

  it("retains a canonical logoUrl with one trailing FQDN dot", () => {
    // Given
    const logoUrl = "https://cdn.example.com./races/seoul-logo.png";

    // When
    const result = RaceSchema.safeParse({ ...validRace, logoUrl });

    // Then
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logoUrl).toBe(logoUrl);
    }
  });

  it.each([
    " https://cdn.example.com/races/seoul-logo.png",
    "https://cdn.example.com/races/seoul-logo.png ",
    "https://cdn.example.com/races/seoul\n-logo.png",
    "https://cdn.example.com/races/seoul\t-logo.png",
    "https://cdn.example.com/races/seoul\u0000-logo.png",
    "https://cdn.example.com/races/seoul\u007f-logo.png",
    "https://CDN.EXAMPLE.com/races/seoul-logo.png",
    "https://./races/seoul-logo.png",
    "https://../races/seoul-logo.png",
    "https://race..example.com/races/seoul-logo.png",
  ])("rejects a non-canonical logoUrl: %s", (logoUrl) => {
    // Given / When
    const result = RaceSchema.safeParse({ ...validRace, logoUrl });

    // Then
    expect(result.success).toBe(false);
  });

  it("allows logoUrl to be absent", () => {
    // Given / When
    const result = RaceSchema.safeParse(validRace);

    // Then
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("logoUrl");
    }
  });

  it.each([
    "http://cdn.example.com/races/seoul-logo.png",
    "data:image/png;base64,AAAA",
    "https://organizer:secret@cdn.example.com/races/seoul-logo.png",
    "https://localhost/races/seoul-logo.png",
    "https://10.0.0.1/races/seoul-logo.png",
    "https://cdn.example.com/favicon.ico",
  ])("rejects an unsafe logoUrl: %s", (logoUrl) => {
    // Given / When
    const result = RaceSchema.safeParse({ ...validRace, logoUrl });

    // Then
    expect(result.success).toBe(false);
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
      kind: "official",
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
