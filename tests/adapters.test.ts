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
  it("discovers source-detail candidates from fixture HTML", async () => {
    const result = await collectFromFixture(GoRunningAdapter);
    expect(result.metadata.id).toBe("gorunning");
    expect(result.metadata.attempted).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.stageCounters.discoveryCandidates).toBe(result.discoveryCandidates.length);
  });

  it("does not publish courses or prices from list/detail pages", async () => {
    const result = await collectFromFixture(GoRunningAdapter);
    expect(result.discoveryCandidates[0]).not.toHaveProperty("courses");
    expect(result.discoveryCandidates[0]).not.toHaveProperty("venue");
    expect(result.discoveryCandidates[0]).not.toHaveProperty("applicationUrl");
  });

  it("does not make live requests when fixtureDir is provided", async () => {
    const result = await collectFromFixture(GoRunningAdapter);
    expect(result.metadata.succeeded).toBe(true);
  });

  it("fails closed when a legacy detail fixture is missing", async () => {
    const result = await GoRunningAdapter.collect({
      fixtureDir: `${FIXTURES_DIR}/gorunning/missing-detail`,
      detailBudget: 5,
    });

    expect(result.discoveryCandidates).toHaveLength(1);
    expect(result.discoveredOfficialCandidates).toEqual([]);
    expect(result.stageCounters).toMatchObject({ rejectedCandidates: 1, sourceDetailsFetched: 0 });
  });
});

describe("KorMarathon adapter", () => {
  it("discovers source-detail candidates from SSR HTML fixture", async () => {
    const result = await collectFromFixture(KorMarathonAdapter);
    expect(result.metadata.id).toBe("kormarathon");
    expect(result.metadata.attempted).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates.length).toBeGreaterThanOrEqual(0);
  });

  it("never fails the pipeline even with minimal data", async () => {
    const result = await collectFromFixture(KorMarathonAdapter);
    // Even if no races found, metadata should be successful
    expect(result.metadata.succeeded).toBe(true);
  });
});

describe("e-Marathon adapter", () => {
  it("discovers candidates without publishing body-text prices", async () => {
    const result = await collectFromFixture(EMarathonAdapter);
    expect(result.metadata.id).toBe("emarathon");
    expect(result.metadata.attempted).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result.discoveryCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.discoveryCandidates[0]).not.toHaveProperty("courses");
    expect(result.discoveryCandidates[0]).not.toHaveProperty("venue");
  });

  it("preserves absolute detail URLs as source-detail candidates only", async () => {
    const result = await collectFromFixture(EMarathonAdapter);

    expect(result.discoveryCandidates[0]?.sourceDetailUrl).toBe(
      "https://emarathon.or.kr/race/view/9101",
    );
  });
});

describe("Maedal adapter", () => {
  it("does not publish metadata-only links without a real event date", async () => {
    const result = await collectFromFixture(MaedalAdapter);
    expect(result.metadata.id).toBe("maedal");
    expect(result.metadata.attempted).toBe(true);
    expect(result.metadata.succeeded).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates.length).toBeGreaterThanOrEqual(1);
    expect(
      result.discoveryCandidates.every((candidate) =>
        candidate.identityEvidence.dateHints.every((date) => date !== "2025-01-01"),
      ),
    ).toBe(true);
  });
});

describe("KAAF adapter", () => {
  it("returns candidate-only output from ASP fixture", async () => {
    const result = await collectFromFixture(KaafAdapter);
    expect(result.metadata.id).toBe("kaaf");
    expect(result.metadata.attempted).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates.length).toBeGreaterThanOrEqual(0);
  });

  it("publishes no races while exposing safe official candidates", async () => {
    const result = await collectFromFixture(KaafAdapter);
    expect(result.metadata.succeeded).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveredOfficialCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.stageCounters.discoveredOfficialCandidates).toBe(
      result.discoveredOfficialCandidates.length,
    );
  });
});

describe("Marathon Moa adapter", () => {
  it("does not publish community records that only have a generic source path", async () => {
    const result = await collectFromFixture(MarathonMoaAdapter);
    expect(result.metadata.id).toBe("marathonmoa");
    expect(result.metadata.attempted).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores registration URLs embedded in the public RSC payload", async () => {
    const result = await MarathonMoaAdapter.collect({
      fixtureDir: `${FIXTURES_DIR}/marathonmoa/registration-rsc`,
      detailBudget: 0,
    });

    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveredOfficialCandidates).toEqual([]);
  });

  it("rejects an embedded generic organizer homepage as an official candidate", async () => {
    const result = await MarathonMoaAdapter.collect({
      fixtureDir: `${FIXTURES_DIR}/marathonmoa/registration-root`,
      detailBudget: 0,
    });

    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveredOfficialCandidates.map((link) => link.url)).not.toContain(
      "https://generic-organizer.example/",
    );
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
  it("discovers only source-detail candidates from dated list entries", async () => {
    const result = await collectFromFixture(RunningMapAdapter);
    expect(result.metadata.id).toBe("runningmap");
    expect(result.metadata.attempted).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates.length).toBeGreaterThanOrEqual(1);
  });
});

describe("MarathonMate adapter", () => {
  it("does not treat race-finder links as source-detail candidates", async () => {
    const result = await collectFromFixture(MarathonMateAdapter);
    expect(result.metadata.id).toBe("marathonmate");
    expect(result.metadata.attempted).toBe(true);
    expect(result).not.toHaveProperty("races");
    expect(result).not.toHaveProperty("discoveredLinks");
    expect(result.discoveryCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.metadata.succeeded).toBe(true);
  });
});

describe("Adapter result contract", () => {
  for (const adapter of adapters) {
    it(`${adapter.id}: returns discovered links outside public races`, async () => {
      const result = await collectFromFixture(adapter);

      if (adapter.id === "kaaf") {
        expect(result).not.toHaveProperty("races");
        expect(result).not.toHaveProperty("discoveredLinks");
        expect(result.discoveredOfficialCandidates.length).toBeGreaterThanOrEqual(1);
        return;
      }
      expect(result).not.toHaveProperty("races");
      expect(result).not.toHaveProperty("discoveredLinks");
      for (const candidate of result.discoveryCandidates) {
        expect(candidate.identityEvidence.dateHints).not.toContain("2025-01-01");
        expect(candidate).not.toHaveProperty("courses");
        expect(candidate).not.toHaveProperty("venue");
        expect(candidate).not.toHaveProperty("applicationUrl");
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
      if (adapter.id === "kaaf") {
        expect(result.discoveryCandidates).toEqual([]);
        expect(result.discoveredOfficialCandidates).toEqual([]);
        return;
      }
      expect(result.discoveryCandidates).toEqual([]);
      expect(result.discoveredOfficialCandidates).toEqual([]);
    });
  }
});
