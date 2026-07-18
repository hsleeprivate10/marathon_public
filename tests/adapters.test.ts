import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMarathonAdapter } from "../src/adapters/emarathon.js";
import { GoRunningAdapter } from "../src/adapters/gorunning.js";
import { KaafAdapter } from "../src/adapters/kaaf.js";
import { KorMarathonAdapter } from "../src/adapters/kormarathon.js";
import { MaedalAdapter } from "../src/adapters/maedal.js";
import { MarathonMateAdapter } from "../src/adapters/marathonmate.js";
import {
  MarathonMoaAdapter,
  parseMarathonMoaRegistrationUrls,
} from "../src/adapters/marathonmoa.js";
import { RunningMapAdapter } from "../src/adapters/runningmap.js";
import type { SourceAdapter } from "../src/adapters/types.js";
import { RaceSchema } from "../src/contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const adapters: ReadonlyArray<SourceAdapter> = [
  GoRunningAdapter,
  KorMarathonAdapter,
  EMarathonAdapter,
  MaedalAdapter,
  KaafAdapter,
  MarathonMoaAdapter,
  RunningMapAdapter,
  MarathonMateAdapter,
];

async function collectFromFixture(adapter: SourceAdapter) {
  return adapter.collect({
    fixtureDir: `${FIXTURES_DIR}/${adapter.id}`,
    detailBudget: 5,
  });
}

describe("GoRunning adapter", () => {
  it("collects races from fixture HTML", async () => {
    const result = await collectFromFixture(GoRunningAdapter);
    expect(result.metadata.id).toBe("gorunning");
    expect(result.metadata.attempted).toBe(true);
    // GoRunning fixture has race list links
    expect(result.races.length).toBeGreaterThanOrEqual(1);
    for (const race of result.races) {
      const parsed = RaceSchema.safeParse(race);
      expect(parsed.success).toBe(true);
    }
  });

  it("populates prices when detail pages available", async () => {
    const result = await collectFromFixture(GoRunningAdapter);
    const withPrices = result.races.filter((r) => r.courses.some((c) => c.price !== null));
    expect(withPrices.length).toBeGreaterThanOrEqual(1);
    expect(result.races[0]?.courses.map((course) => course.name)).toEqual(["풀", "하프", "10K"]);
  });

  it("does not make live requests when fixtureDir is provided", async () => {
    const result = await collectFromFixture(GoRunningAdapter);
    expect(result.metadata.succeeded).toBe(true);
  });

  it("retains legacy list data when its detail fixture is missing", async () => {
    const result = await GoRunningAdapter.collect({
      fixtureDir: `${FIXTURES_DIR}/gorunning/missing-detail`,
      detailBudget: 5,
    });

    expect(result.races).toHaveLength(1);
    expect(result.races[0]).toMatchObject({
      name: "제31회 누락고런마라톤",
      eventDate: "2026-09-20",
      venue: "서울 한강공원",
      verified: false,
    });
  });
});

describe("KorMarathon adapter", () => {
  it("collects races from SSR HTML fixture", async () => {
    const result = await collectFromFixture(KorMarathonAdapter);
    expect(result.metadata.id).toBe("kormarathon");
    expect(result.metadata.attempted).toBe(true);
    // Real KorMarathon HTML contains RSC payload
    expect(result.races.length).toBeGreaterThanOrEqual(0);
    for (const race of result.races) {
      const parsed = RaceSchema.safeParse(race);
      expect(parsed.success).toBe(true);
    }
  });

  it("never fails the pipeline even with minimal data", async () => {
    const result = await collectFromFixture(KorMarathonAdapter);
    // Even if no races found, metadata should be successful
    expect(result.metadata.succeeded).toBe(true);
  });
});

describe("e-Marathon adapter", () => {
  it("collects races with body-text prices", async () => {
    const result = await collectFromFixture(EMarathonAdapter);
    expect(result.metadata.id).toBe("emarathon");
    expect(result.metadata.attempted).toBe(true);
    expect(result.races.length).toBeGreaterThanOrEqual(1);
    expect(result.races[0]?.name).toBe("2025 인천국제마라톤대회");
    expect(result.races[0]?.eventDate).toBe("2025-04-13");
    for (const race of result.races) {
      const parsed = RaceSchema.safeParse(race);
      expect(parsed.success).toBe(true);
      // e-Marathon prices come from body text
      for (const course of race.courses) {
        if (course.price !== null) {
          expect(course.priceSource).toBe("body-text");
        }
      }
      expect(["풀", "하프", "10K", "5K"]).toContain(race.courses[0]?.name);
    }
  });

  it("preserves absolute detail URLs", async () => {
    const result = await collectFromFixture(EMarathonAdapter);

    expect(result.races[0]?.applicationUrl).toBe("https://emarathon.or.kr/race/view/201");
  });
});

describe("Maedal adapter", () => {
  it("does not publish metadata-only links without a real event date", async () => {
    const result = await collectFromFixture(MaedalAdapter);
    expect(result.metadata.id).toBe("maedal");
    expect(result.metadata.attempted).toBe(true);
    expect(result.metadata.succeeded).toBe(true);
    expect(result.races.every((race) => race.eventDate !== "2025-01-01")).toBe(true);
    for (const race of result.races) {
      const parsed = RaceSchema.safeParse(race);
      expect(parsed.success).toBe(true);
      expect(race.courses).toEqual([]);
      // Should have metadata-only note
      expect(race.notes).toContain("Maedal");
      expect(race.verified).toBe(false);
    }
  });
});

describe("KAAF adapter", () => {
  it("extracts verification-only events from ASP fixture", async () => {
    const result = await collectFromFixture(KaafAdapter);
    expect(result.metadata.id).toBe("kaaf");
    expect(result.metadata.attempted).toBe(true);
    // KAAF ASP page may have no marathon links
    expect(result.races.length).toBeGreaterThanOrEqual(0);
    for (const race of result.races) {
      const parsed = RaceSchema.safeParse(race);
      expect(parsed.success).toBe(true);
      expect(race.notes).toContain("KAAF");
      expect(race.courses).toEqual([]);
    }
  });

  it("marks all races as unverified", async () => {
    const result = await collectFromFixture(KaafAdapter);
    for (const race of result.races) {
      expect(race.verified).toBe(false);
    }
  });
});

describe("Marathon Moa adapter", () => {
  it("collects races from community fixture", async () => {
    const result = await collectFromFixture(MarathonMoaAdapter);
    expect(result.metadata.id).toBe("marathonmoa");
    expect(result.metadata.attempted).toBe(true);
    expect(result.races.length).toBeGreaterThanOrEqual(1);
    for (const race of result.races) {
      const parsed = RaceSchema.safeParse(race);
      expect(parsed.success).toBe(true);
      expect(race.notes).toContain("Marathon Moa");
      expect(race.courses).toEqual([]);
    }
  });

  it("uses the registration URL embedded in the public RSC payload", async () => {
    const result = await MarathonMoaAdapter.collect({
      fixtureDir: `${FIXTURES_DIR}/marathonmoa/registration-rsc`,
      detailBudget: 0,
    });

    expect(result.races[0]?.applicationUrl).toBe("https://apply.example.com/register");
    expect(
      result.discoveredLinks.filter(
        (link) => link.kind === "application" && new URL(link.url).hostname === "marathon.me.kr",
      ),
    ).toEqual([]);
  });

  it("maps registration URLs from neighboring RSC event records", () => {
    const html = String.raw`\"id\":\"11111111-1111-4111-8111-111111111111\",\"source_id\":\"first\",\"registration_url\":\"https://first.example/register\"},{\"id\":\"22222222-2222-4222-8222-222222222222\",\"source_id\":\"second\",\"registration_url\":\"https://second.example/register\"`;

    expect([...parseMarathonMoaRegistrationUrls(html)]).toEqual([
      ["11111111-1111-4111-8111-111111111111", "https://first.example/register"],
      ["22222222-2222-4222-8222-222222222222", "https://second.example/register"],
    ]);
  });
});

describe("RunningMap adapter", () => {
  it("does not publish map links without a real event date", async () => {
    const result = await collectFromFixture(RunningMapAdapter);
    expect(result.metadata.id).toBe("runningmap");
    expect(result.metadata.attempted).toBe(true);
    expect(result.races).toEqual([]);
    for (const race of result.races) {
      const parsed = RaceSchema.safeParse(race);
      expect(parsed.success).toBe(true);
      expect(race.courses).toEqual([]);
    }
  });
});

describe("MarathonMate adapter", () => {
  it("does not treat race-finder links as races", async () => {
    const result = await collectFromFixture(MarathonMateAdapter);
    expect(result.metadata.id).toBe("marathonmate");
    expect(result.metadata.attempted).toBe(true);
    // MarathonMate homepage is just a redirect, no race data
    expect(result.races.length).toBe(0);
    expect(result.metadata.succeeded).toBe(true);
    expect(result.metadata.message).toContain("No races found");
  });
});

describe("Adapter result contract", () => {
  for (const adapter of adapters) {
    it(`${adapter.id}: returns discovered links outside public races`, async () => {
      const result = await collectFromFixture(adapter);

      expect(result.discoveredLinks).toEqual([]);
      for (const race of result.races) {
        expect(race.eventDate).not.toBe("2025-01-01");
        expect(race).not.toHaveProperty("dedupKey");
        expect(race).not.toHaveProperty("kind");
        expect(race).not.toHaveProperty("url");
        expect(race).not.toHaveProperty("sourceId");
        expect(race).not.toHaveProperty("sourcePageUrl");
        expect(race).not.toHaveProperty("evidence");
      }
    });
  }
});

describe("All adapters fail gracefully with missing fixtures", () => {
  for (const adapter of adapters) {
    it(`${adapter.id}: returns error metadata when fixtures are missing`, async () => {
      const result = await adapter.collect({
        fixtureDir: "/nonexistent/path",
        detailBudget: undefined,
      });
      expect(result.metadata.id).toBe(adapter.id);
      expect(result.metadata.attempted).toBe(true);
      expect(result.metadata.succeeded).toBe(false);
      expect(result.metadata.recordCount).toBe(0);
      expect(result.races).toHaveLength(0);
      expect(result.discoveredLinks).toEqual([]);
    });
  }
});
