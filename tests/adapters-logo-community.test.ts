import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MarathonMateAdapter } from "../src/adapters/marathonmate.js";
import type { SourceAdapter } from "../src/adapters/types.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

type Expected = {
  readonly adapter: SourceAdapter;
  readonly fixture: string;
  readonly recordCount: number;
};

const positiveCases: readonly Expected[] = [
  {
    adapter: MarathonMateAdapter,
    fixture: "logo-positive",
    recordCount: 1,
  },
];

const negativeCases: readonly Expected[] = [
  {
    adapter: MarathonMateAdapter,
    fixture: "logo-absent",
    recordCount: 1,
  },
];

async function collectObserved(expected: Expected, detailBudget: number) {
  let fetchCalls = 0;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    fetchCalls += 1;
    return Promise.reject(new Error(`unexpected fetch: ${String(input)}`));
  });
  try {
    const result = await expected.adapter.collect({
      fixtureDir: `${FIXTURES_DIR}/${expected.adapter.id}/${expected.fixture}`,
      detailBudget,
    });
    return {
      fetchCalls,
      recordCount: result.metadata.recordCount,
      hasLegacyRaces: "races" in result,
      hasLegacyDiscoveredLinks: "discoveredLinks" in result,
      discoveryCandidates: result.discoveryCandidates.length,
      discoveredOfficialCandidates: result.discoveredOfficialCandidates.length,
    };
  } finally {
    spy.mockRestore();
  }
}

async function expectExactInvariant(expected: Expected) {
  const low = await collectObserved(expected, 0);
  const high = await collectObserved(expected, 99);
  expect(low).toEqual(high);
  expect(low.fetchCalls).toBe(0);
  expect(low.recordCount).toBe(expected.recordCount);
  expect(low.hasLegacyRaces).toBe(false);
  expect(low.hasLegacyDiscoveredLinks).toBe(false);
  expect(low.discoveryCandidates).toBeGreaterThanOrEqual(1);
}

describe("community adapter event-logo coverage gaps", () => {
  for (const item of positiveCases) {
    it(`${item.adapter.id}: preserves exact logo-positive output for budgets 0 and 99`, async () => {
      await expectExactInvariant(item);
    });
  }

  for (const item of negativeCases) {
    it(`${item.adapter.id}/${item.fixture}: independently rejects absent or unsafe logo evidence`, async () => {
      await expectExactInvariant(item);
    });
  }
});
