import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// allow: SIZE_OK - Task 8 orchestration acceptance scenarios are confined to this existing shared test file; splitting would create out-of-scope files.
import {
  type DiscoveredRaceLink,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  type TransientRaceIdentityEvidence,
  discoveredApplicationUrl,
  discoveredOfficialHomepageUrl,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../src/adapters/types.js";
import { CollectionOutputSchema } from "../src/contract.js";
import { collect } from "../src/orchestrator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "fixtures");
const TMP_DIR = resolve(__dirname, "__tmp_output__");
const NOW = "2026-01-02T03:04:05.000Z";

type AdapterFixture = {
  readonly id: string;
  readonly name: string;
  readonly eventDate: string;
  readonly officialUrls?: readonly string[];
  readonly applicationUrls?: readonly string[];
};

type OfficialPageFixture = {
  readonly name: string;
  readonly eventDate: string;
  readonly venue?: string;
  readonly registrationPath?: string | null;
};

function identityEvidence(name: string, eventDate: string): TransientRaceIdentityEvidence {
  return {
    titleHints: [transientIdentityHint(name)],
    dateHints: [transientIdentityHint(eventDate)],
    organizerHints: [],
  };
}

function discoveryCandidate(fixture: AdapterFixture): SourceDiscoveryCandidate {
  const id = sourceId(fixture.id);
  return {
    sourceId: id,
    sourceDetailUrl: sourceDetailUrl(
      `https://${fixture.id}.example/detail/${encodeURIComponent(fixture.name)}`,
    ),
    identityEvidence: identityEvidence(fixture.name, fixture.eventDate),
  };
}

function officialLink(candidate: SourceDiscoveryCandidate, url: string): DiscoveredRaceLink {
  const parsed = discoveredOfficialHomepageUrl(url);
  if (parsed === null) throw new TypeError(`unsafe official URL: ${url}`);
  return {
    dedupKey: transientIdentityHint(
      `${candidate.identityEvidence.titleHints[0] ?? "race"}|${candidate.identityEvidence.dateHints[0] ?? "date"}`,
    ),
    kind: "official-site",
    url: parsed,
    sourceId: candidate.sourceId,
    sourceDetailUrl: candidate.sourceDetailUrl,
    identityEvidence: candidate.identityEvidence,
    evidence: "explicit-label",
  };
}

function applicationLink(candidate: SourceDiscoveryCandidate, url: string): DiscoveredRaceLink {
  const parsed = discoveredApplicationUrl(url);
  if (parsed === null) throw new TypeError(`unsafe application URL: ${url}`);
  return {
    dedupKey: transientIdentityHint(
      `${candidate.identityEvidence.titleHints[0] ?? "race"}|application`,
    ),
    kind: "application",
    url: parsed,
    sourceId: candidate.sourceId,
    sourceDetailUrl: candidate.sourceDetailUrl,
    identityEvidence: candidate.identityEvidence,
    evidence: "explicit-label",
  };
}

function adapter(fixture: AdapterFixture): SourceAdapter {
  return {
    id: fixture.id,
    name: fixture.id,
    baseUrl: `https://${fixture.id}.example`,
    allowedPaths: ["/"],
    collect: async () => {
      const candidate = discoveryCandidate(fixture);
      const officialUrls = fixture.officialUrls ?? [];
      const applicationUrls = fixture.applicationUrls ?? [];
      return {
        discoveryCandidates: [candidate],
        discoveredOfficialCandidates: [
          ...officialUrls.map((url) => officialLink(candidate, url)),
          ...applicationUrls.map((url) => applicationLink(candidate, url)),
        ],
        metadata: {
          id: fixture.id,
          attempted: true,
          succeeded: true,
          recordCount: officialUrls.length,
          message: "ok",
        },
        stageCounters: {
          discoveryCandidates: 1,
          sourceDetailsFetched: 1,
          discoveredOfficialCandidates: officialUrls.length,
          rejectedCandidates: 0,
          budgetSkipped: 0,
        },
      };
    },
  };
}

function emptyAdapter(id: string): SourceAdapter {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.example`,
    allowedPaths: ["/"],
    collect: async () => ({
      discoveryCandidates: [],
      discoveredOfficialCandidates: [],
      metadata: { id, attempted: true, succeeded: true, recordCount: 0, message: "empty" },
      stageCounters: {
        discoveryCandidates: 0,
        sourceDetailsFetched: 0,
        discoveredOfficialCandidates: 0,
        rejectedCandidates: 0,
        budgetSkipped: 0,
      },
    }),
  };
}

function officialPage(fixture: OfficialPageFixture): string {
  const venue = fixture.venue ?? "공식 장소";
  const registrationPath =
    fixture.registrationPath === undefined ? "/entry" : fixture.registrationPath;
  const registration =
    registrationPath === null ? "" : `<a href="${registrationPath}">참가신청</a>`;
  return `<title>${fixture.name}</title><h1>${fixture.name}</h1><p>대회일 ${fixture.eventDate}</p><p>장소: ${venue}</p>${registration}`;
}

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("orchestrator", () => {
  it("materializes official candidates before RaceSchema acceptance and publication", async () => {
    const officialUrl = "https://official.example/seoul-spring";
    const fetchOfficialPage = vi.fn(async () => ({
      kind: "success" as const,
      url: officialUrl,
      address: "203.0.113.1",
      contentType: "text/html",
      body: officialPage({
        name: "2026 서울 봄꽃 마라톤",
        eventDate: "2026-03-15",
        venue: "잠실종합운동장",
      }),
    }));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [
          adapter({
            id: "source",
            name: "2026 서울 봄꽃 마라톤",
            eventDate: "2026-03-15",
            officialUrls: [officialUrl],
          }),
        ],
        now: () => NOW,
        fetchOfficialPage,
        sleep: vi.fn(() => Promise.resolve()),
        courtesyDelayMs: 0,
      },
    );
    const published = JSON.parse(await readFile(resolve(TMP_DIR, "public", "races.json"), "utf8"));

    expect(CollectionOutputSchema.safeParse(published).success).toBe(true);
    expect(result.races).toEqual([
      expect.objectContaining({
        name: "2026 서울 봄꽃 마라톤",
        eventDate: "2026-03-15",
        venue: "잠실종합운동장",
        applicationUrl: "https://official.example/entry",
        officialSiteUrl: officialUrl,
        sources: ["official-sites"],
      }),
    ]);
    expect(result.races[0]).not.toHaveProperty("urlScheme");
    expect(published).toEqual(result);
  });

  it("coalesces exact official URLs before fetch and records deterministic counters", async () => {
    const officialUrl = "https://official.example/shared-event";
    const fetchOfficialPage = vi.fn(async () => ({
      kind: "success" as const,
      url: officialUrl,
      address: "203.0.113.2",
      contentType: "text/html",
      body: officialPage({ name: "2026 공유 공식 대회", eventDate: "2026-04-01" }),
    }));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [
          adapter({
            id: "primary",
            name: "2026 공유 공식 대회",
            eventDate: "2026-04-01",
            officialUrls: [officialUrl],
          }),
          adapter({
            id: "secondary",
            name: "2026 공유 공식 대회",
            eventDate: "2026-04-01",
            officialUrls: [officialUrl],
          }),
        ],
        now: () => NOW,
        fetchOfficialPage,
        sleep: vi.fn(() => Promise.resolve()),
        courtesyDelayMs: 0,
      },
    );

    expect(fetchOfficialPage).toHaveBeenCalledTimes(1);
    expect(result.races).toHaveLength(1);
    expect(result.collectionMetadata.at(-1)).toEqual({
      id: "official-sites",
      attempted: true,
      succeeded: true,
      recordCount: 1,
      message: "candidate=1 fetched=1 accepted=1 rejected=0 budgetSkipped=0",
    });
  });

  it("semantic-deduplicates only after distinct official pages materialize the same event", async () => {
    const firstUrl = "https://official.example/event-a";
    const secondUrl = "https://backup.example/event-b";
    const fetchOfficialPage = vi.fn(async (url: string) => ({
      kind: "success" as const,
      url,
      address: "203.0.113.3",
      contentType: "text/html",
      body: officialPage({
        name: "2026 한강 나이트 런",
        eventDate: "2026-05-02",
        venue: "한강공원",
      }),
    }));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [
          adapter({
            id: "first",
            name: "2026 한강 나이트 런",
            eventDate: "2026-05-02",
            officialUrls: [firstUrl],
          }),
          adapter({
            id: "second",
            name: "한강 나이트런 2026",
            eventDate: "2026-05-02",
            officialUrls: [secondUrl],
          }),
        ],
        now: () => NOW,
        fetchOfficialPage,
        sleep: vi.fn(() => Promise.resolve()),
        courtesyDelayMs: 0,
      },
    );

    expect(fetchOfficialPage.mock.calls.map(([url]) => url)).toEqual([firstUrl, secondUrl]);
    expect(result.races).toHaveLength(1);
    expect(result.collectionMetadata.at(-1)).toMatchObject({
      recordCount: 2,
      message: "candidate=2 fetched=2 accepted=2 rejected=0 budgetSkipped=0",
    });
  });

  it("never publishes source-site application candidates as final applicationUrl", async () => {
    const officialUrl = "https://official.example/no-registration";
    const sourceApplication = "https://source-apply.example/register/123";
    const fetchOfficialPage = vi.fn(async () => ({
      kind: "success" as const,
      url: officialUrl,
      address: "203.0.113.4",
      contentType: "text/html",
      body: officialPage({
        name: "2026 공식 링크 우선 대회",
        eventDate: "2026-06-01",
        venue: "서울광장",
        registrationPath: null,
      }),
    }));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [
          adapter({
            id: "source",
            name: "2026 공식 링크 우선 대회",
            eventDate: "2026-06-01",
            officialUrls: [officialUrl],
            applicationUrls: [sourceApplication],
          }),
        ],
        now: () => NOW,
        fetchOfficialPage,
        sleep: vi.fn(() => Promise.resolve()),
        courtesyDelayMs: 0,
      },
    );

    expect(result.races[0]?.applicationUrl).toBe(officialUrl);
    expect(result.races[0]?.applicationUrl).not.toBe(sourceApplication);
  });

  it("preserves the existing live file when no official pages are accepted", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");
    const officialUrl = "https://official.example/rejected";

    await expect(
      collect(
        { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
        {
          adapters: [
            adapter({
              id: "source",
              name: "2026 거절 대회",
              eventDate: "2026-07-01",
              officialUrls: [officialUrl],
            }),
          ],
          now: () => NOW,
          fetchOfficialPage: vi.fn(async () => ({
            kind: "failed" as const,
            url: officialUrl,
            reason: "network" as const,
          })),
          sleep: vi.fn(() => Promise.resolve()),
          courtesyDelayMs: 0,
        },
      ),
    ).rejects.toThrow(
      "Live collection produced no publishable race data; existing output preserved",
    );
    expect(await readFile(resolve(publicDir, "races.json"), "utf-8")).toBe("live-sentinel");
  });

  it("preserves the existing live file when every adapter fails", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");
    const failedAdapter: SourceAdapter = {
      ...emptyAdapter("failed"),
      collect: async () => {
        throw new Error("source unavailable");
      },
    };

    await expect(
      collect(
        { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
        { adapters: [failedAdapter], now: () => NOW },
      ),
    ).rejects.toThrow(
      "Live collection produced no publishable race data; existing output preserved",
    );
    expect(await readFile(resolve(publicDir, "races.json"), "utf-8")).toBe("live-sentinel");
  });

  it("preserves the existing live file when successful adapters provide no official candidates", async () => {
    const publicDir = resolve(TMP_DIR, "public");
    await mkdir(publicDir, { recursive: true });
    await writeFile(resolve(publicDir, "races.json"), "live-sentinel", "utf-8");

    await expect(
      collect(
        { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
        { adapters: [emptyAdapter("empty")], now: () => NOW },
      ),
    ).rejects.toThrow(
      "Live collection produced no publishable race data; existing output preserved",
    );
    expect(await readFile(resolve(publicDir, "races.json"), "utf-8")).toBe("live-sentinel");
  });

  it("sorts materialized official races by eventDate after status refresh", async () => {
    const lateUrl = "https://official.example/late";
    const earlyUrl = "https://official.example/early";
    const fetchOfficialPage = vi.fn(async (url: string) => ({
      kind: "success" as const,
      url,
      address: "203.0.113.5",
      contentType: "text/html",
      body:
        url === lateUrl
          ? officialPage({ name: "2026 늦은 공식 마라톤", eventDate: "2026-09-01" })
          : officialPage({ name: "2026 이른 공식 마라톤", eventDate: "2026-03-01" }),
    }));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [
          adapter({
            id: "late",
            name: "2026 늦은 공식 마라톤",
            eventDate: "2026-09-01",
            officialUrls: [lateUrl],
          }),
          adapter({
            id: "early",
            name: "2026 이른 공식 마라톤",
            eventDate: "2026-03-01",
            officialUrls: [earlyUrl],
          }),
        ],
        now: () => NOW,
        fetchOfficialPage,
        sleep: vi.fn(() => Promise.resolve()),
        courtesyDelayMs: 0,
      },
    );

    expect(result.races.map((race) => race.eventDate)).toEqual(["2026-03-01", "2026-09-01"]);
    expect(result.races.every((race) => race.generatedAt === NOW && race.updatedAt === NOW)).toBe(
      true,
    );
  });

  it("runs fixture adapters through official fixtures without invoking live fetch", async () => {
    const fetchOfficialPage = vi.fn(() => Promise.reject(new Error("network attempted")));
    const sleep = vi.fn(() => Promise.resolve());
    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: FIXTURES_DIR },
      { now: () => NOW, fetchOfficialPage, sleep },
    );

    expect(fetchOfficialPage).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(CollectionOutputSchema.safeParse(result).success).toBe(true);
    expect(result.collectionMetadata.slice(0, 8).map((item) => item.id)).toEqual([
      "gorunning",
      "kormarathon",
      "emarathon",
      "maedal",
      "kaaf",
      "marathonmoa",
      "runningmap",
      "marathonmate",
    ]);
    expect(result.collectionMetadata[8]?.id).toBe("official-sites");
  });

  it("retains candidate counts when the official fixture index is malformed", async () => {
    const fixtureRoot = resolve(TMP_DIR, "fixtures");
    await mkdir(resolve(fixtureRoot, "official-sites"), { recursive: true });
    await writeFile(resolve(fixtureRoot, "official-sites", "index.json"), "{broken", "utf8");
    const officialUrl = "https://official.example/fixture-race";
    const fetchOfficialPage = vi.fn(() => Promise.reject(new Error("network attempted")));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: fixtureRoot },
      {
        adapters: [
          adapter({
            id: "fixture",
            name: "2026 Fixture Race",
            eventDate: "2026-08-01",
            officialUrls: [officialUrl],
          }),
        ],
        now: () => NOW,
        fetchOfficialPage,
      },
    );

    expect(result.races).toEqual([]);
    expect(fetchOfficialPage).not.toHaveBeenCalled();
    expect(result.collectionMetadata.at(-1)).toMatchObject({
      id: "official-sites",
      succeeded: false,
      recordCount: 0,
      message: expect.stringContaining(
        "candidate=1 fetched=1 accepted=0 rejected=1 budgetSkipped=0 error=",
      ),
    });
  });
});
