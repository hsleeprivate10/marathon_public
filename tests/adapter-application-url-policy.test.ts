import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMarathonAdapter } from "../src/adapters/emarathon.js";
import { GoRunningAdapter } from "../src/adapters/gorunning.js";
import { KaafAdapter } from "../src/adapters/kaaf.js";
import { KorMarathonAdapter } from "../src/adapters/kormarathon.js";
import { MaedalAdapter } from "../src/adapters/maedal.js";
import { MarathonMateAdapter } from "../src/adapters/marathonmate.js";
import { MarathonMoaAdapter } from "../src/adapters/marathonmoa.js";
import { RunningMapAdapter } from "../src/adapters/runningmap.js";
import type { SourceAdapter } from "../src/adapters/types.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

type AdapterCase = {
  readonly adapter: SourceAdapter;
  readonly fixtureDir: string;
  readonly fixtureFile: string;
  readonly sourceOfficialUrl: string;
  readonly sourceApplicationUrl: string;
  readonly unsafeApplicationUrl: string;
  readonly detailBudget: number;
};

const cases: readonly AdapterCase[] = [
  {
    adapter: GoRunningAdapter,
    fixtureDir: "gorunning/official",
    fixtureFile: "L3JhY2Uvdmlldy5waHA_aWR4PTkxMDE.html",
    sourceOfficialUrl: "https://official-gorun.example/race?utm_source=x&id=9101#top",
    sourceApplicationUrl: "https://apply-gorun.example/register?utm_campaign=y&race=9101#form",
    unsafeApplicationUrl: "http://localhost/register",
    detailBudget: 5,
  },
  {
    adapter: KorMarathonAdapter,
    fixtureDir: "kormarathon/official",
    fixtureFile: "L2tvL3JhY2UvOTEwMQ.html",
    sourceOfficialUrl: "https://official-kor.example/home?utm_medium=x&eventId=9101#x",
    sourceApplicationUrl: "https://apply-kor.example/start?race=9101",
    unsafeApplicationUrl: "https://race.local/register",
    detailBudget: 5,
  },
  {
    adapter: EMarathonAdapter,
    fixtureDir: "emarathon/official",
    fixtureFile: "L3JhY2Uvdmlldy85MTAx.html",
    sourceOfficialUrl: "https://official-emarathon.example/main?utm_source=x&race=9101",
    sourceApplicationUrl: "https://apply-emarathon.example/register?race=9101",
    unsafeApplicationUrl: "https://user:secret@apply.example/register",
    detailBudget: 5,
  },
  {
    adapter: RunningMapAdapter,
    fixtureDir: "runningmap/official",
    fixtureFile: "L3JhY2Uvb2ZmaWNpYWwtbWFwLTkxMDE.html",
    sourceOfficialUrl: "https://official-runningmap.example/event?utm_campaign=x&id=9101",
    sourceApplicationUrl: "https://apply-runningmap.example/start?id=9101",
    unsafeApplicationUrl: "http://127.0.0.1/register",
    detailBudget: 5,
  },
  {
    adapter: MaedalAdapter,
    fixtureDir: "maedal/official-positive",
    fixtureFile: "home.html",
    sourceOfficialUrl: "https://seoul-spring.example.com/event",
    sourceApplicationUrl: "https://apply.seoul-spring.example.com/register?utm_campaign=x",
    unsafeApplicationUrl: "http://10.0.0.1/register",
    detailBudget: 0,
  },
  {
    adapter: KaafAdapter,
    fixtureDir: "kaaf/official-positive",
    fixtureFile: "home.html",
    sourceOfficialUrl: "https://seoul-citizen.example.org/race",
    sourceApplicationUrl: "https://entry.seoul-citizen.example.org/apply?utm_source=kaaf",
    unsafeApplicationUrl: "http://169.254.1.1/register",
    detailBudget: 0,
  },
  {
    adapter: MarathonMoaAdapter,
    fixtureDir: "marathonmoa/official-positive",
    fixtureFile: "home.html",
    sourceOfficialUrl: "https://hangang-night.example.net/event/501",
    sourceApplicationUrl: "https://entry.hangang-night.example.net/register?gclid=abc",
    unsafeApplicationUrl: "http://[fc00::1]/register",
    detailBudget: 0,
  },
  {
    adapter: MarathonMateAdapter,
    fixtureDir: "marathonmate/official-positive",
    fixtureFile: "L3JhY2UvNzAx.html",
    sourceOfficialUrl: "https://daegu-moonlight.example.com/official",
    sourceApplicationUrl: "https://entry.daegu-moonlight.example.com/join?mc_cid=x",
    unsafeApplicationUrl: "http://[fe80::1]/register",
    detailBudget: 0,
  },
];

const unsafeDetailCases = [
  {
    adapter: KaafAdapter,
    html: '<table><tr><td>2026-08-01</td><td><a href="https://race.local/race/view.asp">서울 경계 마라톤대회</a></td></tr></table>',
  },
  {
    adapter: MarathonMoaAdapter,
    html: '<article class="race-card"><a href="http://10.0.0.1/race/501">서울 경계 마라톤</a><span>2026-08-01</span></article>',
  },
  {
    adapter: MarathonMateAdapter,
    html: '<div class="race"><a href="http://169.254.1.1/race/701">서울 경계 마라톤</a><time>2026-08-01</time></div>',
  },
] as const;

async function collectWithUnsafeApplication(item: AdapterCase) {
  const fixtureRoot = await mkdtemp(`${tmpdir()}/marathon-application-url-`);
  try {
    await cp(resolve(FIXTURES_DIR, item.fixtureDir), fixtureRoot, { recursive: true });
    const fixtureFile = resolve(fixtureRoot, item.fixtureFile);
    const html = await readFile(fixtureFile, "utf8");
    const replaced = html.replace(item.sourceApplicationUrl, item.unsafeApplicationUrl);
    if (replaced === html)
      throw new Error(`application fixture URL not found for ${item.adapter.id}`);
    await writeFile(fixtureFile, replaced);
    return await item.adapter.collect({
      fixtureDir: fixtureRoot,
      detailBudget: item.detailBudget,
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function collectWithPaymentOfficialSite(item: AdapterCase) {
  const fixtureRoot = await mkdtemp(`${tmpdir()}/marathon-official-url-`);
  try {
    await cp(resolve(FIXTURES_DIR, item.fixtureDir), fixtureRoot, { recursive: true });
    const fixtureFile = resolve(fixtureRoot, item.fixtureFile);
    const html = await readFile(fixtureFile, "utf8");
    const replaced = html.replace(item.sourceOfficialUrl, "https://payments.example/checkout");
    if (replaced === html) throw new Error(`official fixture URL not found for ${item.adapter.id}`);
    await writeFile(fixtureFile, replaced);
    return await item.adapter.collect({ fixtureDir: fixtureRoot, detailBudget: item.detailBudget });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function collectWithGenericHomepageLinks(item: AdapterCase) {
  const fixtureRoot = await mkdtemp(`${tmpdir()}/marathon-generic-homepage-`);
  try {
    await cp(resolve(FIXTURES_DIR, item.fixtureDir), fixtureRoot, { recursive: true });
    const fixtureFile = resolve(fixtureRoot, item.fixtureFile);
    const html = await readFile(fixtureFile, "utf8");
    const withoutApplication = html.replace(
      item.sourceApplicationUrl,
      "https://generic-organizer.example/",
    );
    const replaced = withoutApplication.replace(
      item.sourceOfficialUrl,
      "https://generic-organizer.example/",
    );
    if (replaced === html) throw new Error(`fixture URLs not found for ${item.adapter.id}`);
    await writeFile(fixtureFile, replaced);
    return await item.adapter.collect({ fixtureDir: fixtureRoot, detailBudget: item.detailBudget });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

describe("adapter application URL publication policy", () => {
  for (const item of cases) {
    it(`${item.adapter.id}: treats source-detail application URLs as negative evidence when unsafe`, async () => {
      const result = await collectWithUnsafeApplication(item);

      expect(result.metadata.succeeded).toBe(true);
      expect(result).not.toHaveProperty("races");
      expect(result).not.toHaveProperty("discoveredLinks");
      expect(result.traversalSeeds.map((link) => link.url)).not.toContain(
        item.unsafeApplicationUrl,
      );
      expect(result.traversalSeeds.filter((link) => link.kind === "application")).toEqual([]);
    });

    it(`${item.adapter.id}: rejects a dedicated payment official URL without retaining it`, async () => {
      const result = await collectWithPaymentOfficialSite(item);

      expect(result.metadata.succeeded).toBe(true);
      expect(result).not.toHaveProperty("races");
      expect(result).not.toHaveProperty("discoveredLinks");
      expect(result.traversalSeeds.map((link) => link.url)).not.toContain(
        "https://payments.example/checkout",
      );
    });

    it(`${item.adapter.id}: never publishes a generic organizer homepage from the adapter stage`, async () => {
      const result = await collectWithGenericHomepageLinks(item);

      expect(result).not.toHaveProperty("races");
      expect(result).not.toHaveProperty("discoveredLinks");
      expect(result.traversalSeeds.filter((link) => link.kind === "application")).toEqual([]);
    });
  }

  for (const item of unsafeDetailCases) {
    it(`${item.adapter.id}: does not publish an unsafe source detail URL as its public source page`, async () => {
      const fixtureRoot = await mkdtemp(`${tmpdir()}/marathon-detail-url-`);
      try {
        await writeFile(resolve(fixtureRoot, "home.html"), item.html);

        const result = await item.adapter.collect({ fixtureDir: fixtureRoot, detailBudget: 0 });

        expect(result).not.toHaveProperty("races");
        expect(result.discoveryCandidates).toEqual([]);
        expect(result.traversalSeeds).toEqual([]);
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  }
});
