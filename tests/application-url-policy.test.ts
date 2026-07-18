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
import { RaceSchema } from "../src/contract.js";
import { safeApplicationUrl } from "../src/official-sites/application-url-policy.js";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

const validRace = {
  name: "공개 대회",
  eventDate: "2026-12-01",
  registrationDeadline: null,
  venue: "서울",
  courses: [],
  applicationUrl: "https://source.example/detail",
  sources: ["source"],
  verified: true,
  lastVerified: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
  generatedAt: "2026-07-17T00:00:00.000Z",
  registrationStatus: "open" as const,
};

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
    sourceOfficialUrl: "https://hangang-night.example.net/home",
    sourceApplicationUrl: "https://entry.hangang-night.example.net/register?gclid=abc",
    unsafeApplicationUrl: "http://[fc00::1]/register",
    detailBudget: 0,
  },
  {
    adapter: MarathonMateAdapter,
    fixtureDir: "marathonmate/official-positive",
    fixtureFile: "home.html",
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
    fallbackApplicationUrl: "https://m.kaaf.or.kr/mobile/info/inside_all.asp",
  },
  {
    adapter: MarathonMoaAdapter,
    html: '<article class="race-card"><a href="http://10.0.0.1/race/501">서울 경계 마라톤</a><span>2026-08-01</span></article>',
    fallbackApplicationUrl: "https://marathon.me.kr/events",
  },
  {
    adapter: MarathonMateAdapter,
    html: '<div class="race"><a href="http://169.254.1.1/race/701">서울 경계 마라톤</a><time>2026-08-01</time></div>',
    fallbackApplicationUrl: "https://marathonmate.store/domestic",
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

function canonicalOfficialUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|gclid|fbclid|mc_)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

describe("RaceSchema application URL publication policy", () => {
  it.each([
    "not-a-url",
    "javascript:alert(1)",
    "ftp://apply.example/register",
    "https://user:secret@apply.example/register",
    "http://localhost/register",
    "https://race.local/register",
    "http://127.0.0.1/register",
    "http://10.0.0.1/register",
    "http://169.254.1.1/register",
    "http://[::1]/register",
    "http://[fc00::1]/register",
    "http://[fe80::1]/register",
    "https://payments.example/checkout",
    "https://race.example/checkout.php",
    "https://race.example/payment.html",
    "https://race.example/billing.do",
    "https://race.example/purchase-action",
    "https://race.example/race-checkout",
    "https://race.example/checkout;jsessionid=abc",
    "https://race.example/%63heckout%3Bjsessionid=abc",
    "https://race.example/pay:now",
    "https://race.example/payment~start",
  ])("rejects an unsafe applicationUrl: %s", (applicationUrl) => {
    expect(RaceSchema.safeParse({ ...validRace, applicationUrl }).success).toBe(false);
  });

  it.each([
    "https://apply.example/register",
    "http://apply.example/register",
    "https://payments-marathon.example/register",
  ])("accepts a public HTTP(S) applicationUrl: %s", (applicationUrl) => {
    expect(RaceSchema.safeParse({ ...validRace, applicationUrl }).success).toBe(true);
  });
});

describe("adapter application URL publication policy", () => {
  for (const item of cases) {
    it(`${item.adapter.id}: falls back to the safe official site when the application URL is unsafe`, async () => {
      const result = await collectWithUnsafeApplication(item);

      expect(result.metadata.succeeded).toBe(true);
      expect(result.races[0]?.applicationUrl).toBe(canonicalOfficialUrl(item.sourceOfficialUrl));
      expect(result.races.every((race) => RaceSchema.safeParse(race).success)).toBe(true);
      expect([
        ...result.races.map((race) => race.applicationUrl),
        ...result.discoveredLinks.map((link) => link.url),
      ]).not.toContain(item.unsafeApplicationUrl);
      expect(result.discoveredLinks.filter((link) => link.kind === "application")).toEqual([]);
    });

    it(`${item.adapter.id}: rejects a dedicated payment official URL while retaining its safe application URL`, async () => {
      const result = await collectWithPaymentOfficialSite(item);

      expect(result.metadata.succeeded).toBe(true);
      const applicationUrl = result.races[0]?.applicationUrl;
      expect(applicationUrl).toBeDefined();
      expect(applicationUrl === undefined ? null : safeApplicationUrl(applicationUrl)).toBe(
        applicationUrl,
      );
      expect(result.races.every((race) => RaceSchema.safeParse(race).success)).toBe(true);
      expect(result.discoveredLinks.map((link) => link.url)).not.toContain(
        "https://payments.example/checkout",
      );
    });
  }

  for (const item of unsafeDetailCases) {
    it(`${item.adapter.id}: replaces an unsafe source detail URL with its public source page`, async () => {
      const fixtureRoot = await mkdtemp(`${tmpdir()}/marathon-detail-url-`);
      try {
        await writeFile(resolve(fixtureRoot, "home.html"), item.html);

        const result = await item.adapter.collect({ fixtureDir: fixtureRoot, detailBudget: 0 });

        expect(result.races[0]?.applicationUrl).toBe(item.fallbackApplicationUrl);
        expect(result.races.every((race) => RaceSchema.safeParse(race).success)).toBe(true);
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  }
});
