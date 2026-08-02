import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarathonGoAdapter } from "../src/adapters/marathongo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures/marathongo");
const MULTI_FIXTURES_DIR = resolve(FIXTURES_DIR, "multi");
const CURRENT_DETAIL_FIXTURES_DIR = resolve(FIXTURES_DIR, "current-detail");
const CURRENT_DETAIL_NEGATIVE_FIXTURES_DIR = resolve(FIXTURES_DIR, "current-detail-negative");
const CURRENT_DETAIL_IDENTITY_FIXTURES_DIR = resolve(FIXTURES_DIR, "current-detail-identity");
const TTUKSEOM_ALIAS_FIXTURES_DIR = resolve(FIXTURES_DIR, "ttukseom-alias");
const MALFORMED_ALIAS_FIXTURES_DIR = resolve(FIXTURES_DIR, "malformed-alias");
const originalFetch = globalThis.fetch;

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

describe("MarathonGo adapter", () => {
  it("emits source-detail candidates and typed application traversal seeds without public races", async () => {
    // Given: a fixture list with duplicate, malformed, related-card, and two valid details.
    trapNetwork();

    // When: the unregistered MarathonGo adapter collects in fixture mode.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: MULTI_FIXTURES_DIR,
      detailBudget: 200,
    });

    // Then: it reads only fixtures and emits transient detail evidence plus application seeds.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("races");
    expect(result.discoveryCandidates).toHaveLength(2);
    expect(result.traversalSeeds.map((seed) => ({ kind: seed.kind, url: seed.url }))).toEqual([
      {
        kind: "application",
        url: "https://saunarun.com/products/z64zdfxy4mc9?variant=44332211",
      },
      { kind: "application", url: "https://river-night.example/apply?race=2026" },
    ]);
    expect(result.stageCounters).toEqual({
      discoveryCandidates: 2,
      sourceDetailsFetched: 2,
      traversalSeeds: 2,
      rejectedCandidates: 0,
      budgetSkipped: 0,
    });
  });

  it("respects detailBudget zero by returning owned candidates but no traversal seeds", async () => {
    // Given: fixture mode and a zero detail budget.
    trapNetwork();

    // When: collection is limited to the list page.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: MULTI_FIXTURES_DIR,
      detailBudget: 0,
    });

    // Then: detail candidates remain transient and no detail fixture is read or emitted.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.discoveryCandidates).toHaveLength(2);
    expect(result.traversalSeeds).toEqual([]);
    expect(result.stageCounters).toMatchObject({
      sourceDetailsFetched: 0,
      traversalSeeds: 0,
      budgetSkipped: 2,
    });
  });

  it("fails closed for missing details, poison details, unsafe CTAs, self-links, and malformed slugs", async () => {
    // Given: negative fixtures for malformed input and prompt-injection-like source detail HTML.
    trapNetwork();

    // When: the adapter collects the negative MarathonGo fixture set.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: `${FIXTURES_DIR}/negative`,
      detailBudget: 200,
    });

    // Then: no unsafe or source-owned application evidence becomes a traversal seed.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.discoveryCandidates).toHaveLength(4);
    expect(result.traversalSeeds).toEqual([]);
    expect(result.stageCounters).toEqual({
      discoveryCandidates: 4,
      sourceDetailsFetched: 3,
      traversalSeeds: 0,
      rejectedCandidates: 4,
      budgetSkipped: 0,
    });
  });

  it("emits application seeds from bounded current-shape detail pages", async () => {
    // Given: a current-shape fixture whose detail page has a plain main and button CTA.
    trapNetwork();

    // When: the adapter collects with a bounded detail budget.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: CURRENT_DETAIL_FIXTURES_DIR,
      detailBudget: 2,
    });

    // Then: current-shape detail evidence becomes a typed application traversal seed only.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.discoveryCandidates.length).toBeGreaterThan(0);
    expect(result.traversalSeeds.map((seed) => ({ kind: seed.kind, url: seed.url }))).toEqual([
      { kind: "application", url: "https://current-detail.example/apply?race=2026" },
    ]);
    expect(result.stageCounters).toEqual({
      discoveryCandidates: 1,
      sourceDetailsFetched: 1,
      traversalSeeds: 1,
      rejectedCandidates: 0,
      budgetSkipped: 0,
    });
  });

  it("rejects unsafe current-shape detail CTAs without leaking related or inert chrome", async () => {
    // Given: current-shape details with source-self, unsafe, related, nav, footer, script, and template CTAs.
    trapNetwork();

    // When: the adapter collects the negative current-shape detail fixture set.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: CURRENT_DETAIL_NEGATIVE_FIXTURES_DIR,
      detailBudget: 4,
    });

    // Then: all negative current-shape details fail closed without traversal seeds.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.discoveryCandidates).toHaveLength(4);
    expect(result.traversalSeeds).toEqual([]);
    expect(result.stageCounters).toEqual({
      discoveryCandidates: 4,
      sourceDetailsFetched: 4,
      traversalSeeds: 0,
      rejectedCandidates: 4,
      budgetSkipped: 0,
    });
  });

  it("prefers precise owned detail identity evidence for application traversal seeds", async () => {
    // Given: noisy list identity and a fetched owned detail with precise title/date and safe CTA.
    trapNetwork();

    // When: the adapter emits application traversal seeds from the detail fixture.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: CURRENT_DETAIL_IDENTITY_FIXTURES_DIR,
      detailBudget: 2,
    });

    // Then: the seed identity and dedup key use detail name/date while no public records are emitted.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("races");
    expect(result.discoveryCandidates[0]?.identityEvidence).toEqual({
      titleHints: ["마라톤GO 접수중 곧 마감"],
      dateHints: ["2026-08-15"],
      organizerHints: [],
    });
    expect(result.traversalSeeds).toHaveLength(1);
    expect(result.traversalSeeds[0]).toMatchObject({
      kind: "application",
      dedupKey: "2026커런트디테일런|2026-07-31|미상",
      identityEvidence: {
        titleHints: ["2026 커런트 디테일 런"],
        dateHints: ["2026-07-31"],
        organizerHints: [],
      },
      trustedDetail: {
        kind: "marathongo-detail",
        sourceId: "marathongo",
        sourceDetailUrl: "https://marathongo.co.kr/raceDetail/domestic/current-identity-2026-07-31",
        eventDate: "2026-07-31",
      },
      url: "https://current-detail.example/apply?race=identity",
    });
    expect(result.stageCounters).toEqual({
      discoveryCandidates: 1,
      sourceDetailsFetched: 1,
      traversalSeeds: 1,
      rejectedCandidates: 0,
      budgetSkipped: 0,
    });
  });

  it("adds source-specific MarathonGo title aliases and owned detail provenance to seeds", async () => {
    // Given: a live-shape detail whose external page names the race with local word order.
    trapNetwork();

    // When: MarathonGo emits its application traversal seed.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: MULTI_FIXTURES_DIR,
      detailBudget: 1,
    });

    // Then: identity variants are source scoped and the trusted detail is internal seed provenance.
    expect(result.traversalSeeds[0]).toMatchObject({
      kind: "application",
      sourceId: "marathongo",
      identityEvidence: {
        titleHints: [
          "2026 사우나런 올림픽공원",
          "2026 사우나런 in 올림픽공원",
          "2026 올림픽공원 사우나런",
        ],
        dateHints: ["2026-07-31"],
      },
      trustedDetail: {
        kind: "marathongo-detail",
        sourceId: "marathongo",
        eventDate: "2026-07-31",
        venue: "서울 올림픽공원 평화의광장",
      },
    });
  });

  it("adds a source-specific no-year A-in-B title alias without sorting unrelated names", async () => {
    // Given: a MarathonGo detail name whose external page uses location-first word order.
    trapNetwork();

    // When: MarathonGo emits its no-year application traversal seed.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: TTUKSEOM_ALIAS_FIXTURES_DIR,
      detailBudget: 1,
    });

    // Then: the original hint is preserved and only the strict MarathonGo no-year alias is added.
    expect(result.traversalSeeds[0]).toMatchObject({
      kind: "application",
      sourceId: "marathongo",
      identityEvidence: {
        titleHints: ["사우나런 in 뚝섬한강공원", "뚝섬한강공원 사우나런"],
        dateHints: ["2026-07-31"],
      },
      trustedDetail: {
        kind: "marathongo-detail",
        sourceId: "marathongo",
        eventDate: "2026-07-31",
        venue: "서울 뚝섬한강공원 수변마당",
      },
      url: "https://ttukseom-saunarun.example/event",
    });
  });

  it("does not add source-specific aliases for malformed multiple-in titles", async () => {
    // Given: a MarathonGo detail name with ambiguous repeated in separators.
    trapNetwork();

    // When: MarathonGo emits its application traversal seed.
    const result = await MarathonGoAdapter.collect({
      fixtureDir: MALFORMED_ALIAS_FIXTURES_DIR,
      detailBudget: 1,
    });

    // Then: only the original malformed name is retained.
    expect(result.traversalSeeds[0]?.identityEvidence.titleHints).toEqual([
      "사우나런 in 뚝섬 in 한강공원",
    ]);
  });
});
