import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KaafAdapter } from "../src/adapters/kaaf.js";
import { MaedalAdapter } from "../src/adapters/maedal.js";
import { MarathonMateAdapter } from "../src/adapters/marathonmate.js";
import { MarathonMoaAdapter } from "../src/adapters/marathonmoa.js";
import type { SourceAdapter } from "../src/adapters/types.js";
import { dedupKey } from "../src/normalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");

const cases: ReadonlyArray<{
  readonly adapter: SourceAdapter;
  readonly positiveName: string;
  readonly officialUrl: string;
  readonly applicationUrl: string;
  readonly secondName: string;
  readonly secondOfficialUrl: string;
  readonly secondApplicationUrl: string;
}> = [
  {
    adapter: MaedalAdapter,
    positiveName: "서울 봄 마라톤",
    officialUrl: "https://seoul-spring.example.com/event",
    applicationUrl: "https://apply.seoul-spring.example.com/register",
    secondName: "부산 바다 마라톤",
    secondOfficialUrl: "https://busan-sea.example.com/event",
    secondApplicationUrl: "https://apply.busan-sea.example.com/register",
  },
  {
    adapter: KaafAdapter,
    positiveName: "서울 시민 마라톤대회",
    officialUrl: "https://seoul-citizen.example.org/race",
    applicationUrl: "https://entry.seoul-citizen.example.org/apply",
    secondName: "부산 시민 마라톤대회",
    secondOfficialUrl: "https://busan-citizen.example.org/race",
    secondApplicationUrl: "https://entry.busan-citizen.example.org/apply",
  },
  {
    adapter: MarathonMoaAdapter,
    positiveName: "2025 한강 나이트 마라톤",
    officialUrl: "https://hangang-night.example.net/home",
    applicationUrl: "https://entry.hangang-night.example.net/register",
    secondName: "2025 금강 새벽 마라톤",
    secondOfficialUrl: "https://geumgang-dawn.example.net/home",
    secondApplicationUrl: "https://entry.geumgang-dawn.example.net/register",
  },
  {
    adapter: MarathonMateAdapter,
    positiveName: "대구 달빛 마라톤",
    officialUrl: "https://daegu-moonlight.example.com/official",
    applicationUrl: "https://entry.daegu-moonlight.example.com/join",
    secondName: "광주 별빛 마라톤",
    secondOfficialUrl: "https://gwangju-starlight.example.com/official",
    secondApplicationUrl: "https://entry.gwangju-starlight.example.com/join",
  },
];

async function collect(adapter: SourceAdapter, fixtureName: string) {
  return adapter.collect({
    fixtureDir: `${FIXTURES_DIR}/${adapter.id}/${fixtureName}`,
    detailBudget: 0,
  });
}

describe("community adapter official link discovery", () => {
  for (const item of cases) {
    it(`${item.adapter.id}: emits only explicit race-bound homepage/application links`, async () => {
      const result = await collect(item.adapter, "official-positive");

      expect(result.metadata.succeeded).toBe(true);
      expect(result.races).toHaveLength(1);
      const race = result.races[0];
      expect(race).toBeDefined();
      if (race === undefined) throw new Error("expected one parsed race");
      expect(race.name).toBe(item.positiveName);
      expect(race.courses).toEqual([]);
      expect(race.applicationUrl).toBe(item.applicationUrl);

      const key = dedupKey(race);
      expect(result.discoveredLinks).toEqual([
        {
          dedupKey: key,
          kind: "official-site",
          url: item.officialUrl,
          sourceId: item.adapter.id,
          sourcePageUrl: expect.any(String),
          evidence: "explicit-label",
        },
        {
          dedupKey: key,
          kind: "application",
          url: item.applicationUrl,
          sourceId: item.adapter.id,
          sourcePageUrl: expect.any(String),
          evidence: "explicit-label",
        },
      ]);
    });

    it(`${item.adapter.id}: keeps adjacent race official/application links on their owning race`, async () => {
      const result = await collect(item.adapter, "official-cross-race");

      expect(result.metadata.succeeded).toBe(true);
      expect(result.races.map((race) => race.name)).toEqual([item.positiveName, item.secondName]);
      expect(result.races.map((race) => race.applicationUrl)).toEqual([
        item.applicationUrl,
        item.secondApplicationUrl,
      ]);

      const raceA = result.races[0];
      const raceB = result.races[1];
      if (raceA === undefined || raceB === undefined) throw new Error("expected two parsed races");
      const keyA = dedupKey(raceA);
      const keyB = dedupKey(raceB);
      expect(keyA).not.toBe(keyB);
      expect(result.discoveredLinks).toEqual([
        {
          dedupKey: keyA,
          kind: "official-site",
          url: item.officialUrl,
          sourceId: item.adapter.id,
          sourcePageUrl: expect.any(String),
          evidence: "explicit-label",
        },
        {
          dedupKey: keyA,
          kind: "application",
          url: item.applicationUrl,
          sourceId: item.adapter.id,
          sourcePageUrl: expect.any(String),
          evidence: "explicit-label",
        },
        {
          dedupKey: keyB,
          kind: "official-site",
          url: item.secondOfficialUrl,
          sourceId: item.adapter.id,
          sourcePageUrl: expect.any(String),
          evidence: "explicit-label",
        },
        {
          dedupKey: keyB,
          kind: "application",
          url: item.secondApplicationUrl,
          sourceId: item.adapter.id,
          sourcePageUrl: expect.any(String),
          evidence: "explicit-label",
        },
      ]);
    });

    it(`${item.adapter.id}: rejects placeholders, finder/nav, internal, social, payment, malformed, and unlabeled links`, async () => {
      const result = await collect(item.adapter, "official-negative");

      expect(result.metadata.succeeded).toBe(true);
      expect(result.discoveredLinks).toEqual([]);
      for (const race of result.races) {
        expect(race.applicationUrl).not.toMatch(
          /payment|checkout|order|pay|instagram|youtube|facebook/i,
        );
      }
    });
  }
});
