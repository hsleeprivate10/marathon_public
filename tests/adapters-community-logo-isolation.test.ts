import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { KaafAdapter } from "../src/adapters/kaaf.js";
import type { SourceAdapter } from "../src/adapters/types.js";
import { parseRaceLogoCandidates, selectRaceLogoCandidate } from "../src/race-logo-candidates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");

async function collect(adapter: SourceAdapter, fixtureName: string) {
  return adapter.collect({
    fixtureDir: `${FIXTURES_DIR}/${adapter.id}/${fixtureName}`,
    detailBudget: 0,
  });
}

async function collectWithNetworkTrap(adapter: SourceAdapter, fixtureName: string) {
  let fetchCalls = 0;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    fetchCalls += 1;
    return Promise.reject(new Error(`unexpected fixture network call: ${String(input)}`));
  });
  try {
    return { result: await collect(adapter, fixtureName), fetchCalls };
  } finally {
    fetchSpy.mockRestore();
  }
}

describe("community adapter isolated event logo extraction", () => {
  it("kaaf: proves complete-list logo scanning would leak a target-compatible adjacent row", async () => {
    const html = await readFile(resolve(FIXTURES_DIR, "kaaf/logo-neighbor/home.html"), "utf8");
    const targetRace = { name: "서울 시민 마라톤대회", eventDate: "2025-05-04" };

    const fullListLogo = selectRaceLogoCandidate(
      parseRaceLogoCandidates(html, "https://m.kaaf.or.kr/mobile/info/inside_all.asp"),
      targetRace,
    );
    const { result } = await collectWithNetworkTrap(KaafAdapter, "logo-neighbor");

    expect(fullListLogo).toBe("https://assets.seoul-citizen.example.org/leaked-target-logo.png");
    expect(result).not.toHaveProperty("races");
    expect(result.discoveryCandidates[0]?.identityEvidence.titleHints).toEqual([targetRace.name]);
  });

  it("kaaf: ignores row logos because KAAF source rows never publish races", async () => {
    const { result, fetchCalls } = await collectWithNetworkTrap(KaafAdapter, "logo-positive");

    expect(fetchCalls).toBe(0);
    expect(result).not.toHaveProperty("races");
    expect(result.traversalSeeds).toEqual([]);
  });
});
