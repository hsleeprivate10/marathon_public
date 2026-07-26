import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMarathonAdapter } from "../src/adapters/emarathon.js";
import { GoRunningAdapter } from "../src/adapters/gorunning.js";
import { KorMarathonAdapter } from "../src/adapters/kormarathon.js";
import type { AdapterResult } from "../src/adapters/types.js";
import type { Race } from "../src/contract.js";
import { mergeOfficialPage } from "../src/official-sites/merge.js";
import { parseOfficialPage } from "../src/official-sites/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const originalFetch = globalThis.fetch;

const task4Cases = [
  {
    adapter: GoRunningAdapter,
    fixtureName: "gorunning",
    officialUrl: "https://official-gorun.example/race?id=9101",
  },
  {
    adapter: KorMarathonAdapter,
    fixtureName: "kormarathon",
    officialUrl: "https://official-kor.example/home?eventId=9101",
  },
  {
    adapter: EMarathonAdapter,
    fixtureName: "emarathon",
    officialUrl: "https://official-emarathon.example/main?race=9101",
  },
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function trapNetwork(): void {
  globalThis.fetch = Object.assign(
    vi.fn(() => Promise.reject(new Error("fixture mode attempted network fetch"))),
    { preconnect: originalFetch.preconnect },
  );
}

function fixtureDir(item: { readonly fixtureName: string }, variant: string): string {
  return `${FIXTURES_DIR}/${item.fixtureName}/${variant}`;
}

function expectNoPublishableAdapterFields(result: AdapterResult): void {
  expect(result).not.toHaveProperty("races");
  expect(result).not.toHaveProperty("discoveredLinks");
}

function transientRaceForMaterialization(result: AdapterResult): Race {
  const candidate = result.discoveryCandidates[0];
  if (candidate === undefined) throw new Error("expected discovery candidate");
  const name = candidate.identityEvidence.titleHints[0];
  const eventDate = candidate.identityEvidence.dateHints[0];
  if (name === undefined || eventDate === undefined) {
    throw new Error("expected title/date identity hints");
  }
  return {
    name,
    eventDate,
    registrationDeadline: "2026-01-01",
    venue: "가짜 목록 장소",
    courses: [{ name: "풀", price: 99999 }],
    applicationUrl: candidate.sourceDetailUrl,
    logoUrl: "https://source.example/fake-logo.png",
    notes: "poisoned source note",
    region: "poison-region",
    sources: [candidate.sourceId],
    verified: false,
    lastVerified: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    generatedAt: "2026-01-01T00:00:00.000Z",
    registrationStatus: "open",
  };
}

describe("Task 4 discovery-only adapters", () => {
  it("discovers official homepage candidates from owned details without publishing source races", async () => {
    for (const item of task4Cases) {
      trapNetwork();
      const result = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "official"),
        detailBudget: 5,
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expectNoPublishableAdapterFields(result);
      expect(result.discoveryCandidates).toHaveLength(1);
      expect(result.discoveredOfficialCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "official-site",
            sourceId: item.adapter.id,
            url: item.officialUrl,
            evidence: "explicit-label",
          }),
        ]),
      );
      expect(result.discoveredOfficialCandidates.some((link) => link.kind === "application")).toBe(
        false,
      );
      expect(result.stageCounters).toMatchObject({
        discoveryCandidates: 1,
        sourceDetailsFetched: 1,
        discoveredOfficialCandidates: result.discoveredOfficialCandidates.length,
        rejectedCandidates: 0,
        budgetSkipped: 0,
      });
    }
  });

  it("keeps poisoned list metadata transient and lets official materialization use official fields only", async () => {
    for (const item of task4Cases) {
      const result = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "poison"),
        detailBudget: 5,
      });
      const officialRace = transientRaceForMaterialization(result);
      const officialUrl = result.discoveredOfficialCandidates[0]?.url;
      if (officialUrl === undefined) throw new Error("expected official candidate");
      const merged = mergeOfficialPage(
        officialRace,
        parseOfficialPage(
          `<h1>${officialRace.name}</h1><p>대회일: ${officialRace.eventDate}</p><p>장소: 공식 검증 경기장</p><p>종목: 10K 40,000원</p>`,
          officialUrl,
        ),
        officialUrl,
        "2026-01-02T00:00:00.000Z",
      );

      expectNoPublishableAdapterFields(result);
      expect(result.discoveryCandidates[0]?.identityEvidence.titleHints).toContain(
        officialRace.name,
      );
      if (!merged.accepted) throw new Error(merged.reason);
      expect(merged.race).toMatchObject({
        venue: "공식 검증 경기장",
        courses: [{ name: "10K", price: 40000, priceSource: "body-text" }],
        applicationUrl: officialUrl,
        officialSiteUrl: officialUrl,
        sources: ["official-sites"],
      });
      expect(merged.race).not.toHaveProperty("notes");
      expect(merged.race).not.toHaveProperty("region");
      expect(merged.race).not.toHaveProperty("logoUrl");
    }
  });

  it("fails closed for missing details, missing official pages, zero budget, and application-only details", async () => {
    for (const item of task4Cases) {
      for (const variant of ["missing-detail", "negative"] as const) {
        trapNetwork();
        const result = await item.adapter.collect({
          fixtureDir: fixtureDir(item, variant),
          detailBudget: 5,
        });

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expectNoPublishableAdapterFields(result);
        expect(result.discoveredOfficialCandidates).toEqual([]);
        expect(result.stageCounters.discoveryCandidates).toBe(1);
        expect(result.stageCounters.rejectedCandidates).toBe(1);
      }

      const zero = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "official"),
        detailBudget: 0,
      });
      expectNoPublishableAdapterFields(zero);
      expect(zero.discoveredOfficialCandidates).toEqual([]);
      expect(zero.stageCounters).toMatchObject({
        discoveryCandidates: 1,
        sourceDetailsFetched: 0,
        discoveredOfficialCandidates: 0,
        rejectedCandidates: 0,
        budgetSkipped: 1,
      });
    }
  });
});
