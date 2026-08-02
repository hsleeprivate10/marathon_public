import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMarathonAdapter } from "../src/adapters/emarathon.js";
import { GoRunningAdapter } from "../src/adapters/gorunning.js";
import { KorMarathonAdapter } from "../src/adapters/kormarathon.js";
import type { AdapterResult } from "../src/adapters/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const originalFetch = globalThis.fetch;

const logoCases = [
  {
    adapter: GoRunningAdapter,
    fixtureName: "gorunning",
  },
  {
    adapter: KorMarathonAdapter,
    fixtureName: "kormarathon",
  },
  {
    adapter: EMarathonAdapter,
    fixtureName: "emarathon",
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

function expectNoLegacyPublicFields(result: AdapterResult): void {
  expect(result).not.toHaveProperty("races");
  expect(result).not.toHaveProperty("discoveredLinks");
}

describe("detail-rich adapter event logo extraction", () => {
  it("attaches event-specific logos from already fetched detail fixtures without network", async () => {
    for (const item of logoCases) {
      trapNetwork();
      const result = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "logo-positive"),
        detailBudget: 1,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expectNoLegacyPublicFields(result);
      expect(result.discoveryCandidates).toHaveLength(1);
    }
  });

  it("omits generic, cross-event, missing-detail, and zero-budget logos", async () => {
    for (const item of logoCases) {
      trapNetwork();
      const negative = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "logo-negative"),
        detailBudget: 1,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expectNoLegacyPublicFields(negative);
      expect(negative.traversalSeeds).toEqual([]);

      trapNetwork();
      const zero = await item.adapter.collect({
        fixtureDir: fixtureDir(item, "logo-positive"),
        detailBudget: 0,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expectNoLegacyPublicFields(zero);
      expect(zero.traversalSeeds).toEqual([]);
    }
  });
});
