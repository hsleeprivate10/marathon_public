import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// allow: SIZE_OK - Task 8 enrichment acceptance scenarios are confined to this existing shared test file; splitting would create out-of-scope files.
import {
  type DiscoveredRaceLink,
  type SourceDiscoveryCandidate,
  type TransientRaceIdentityEvidence,
  discoveredApplicationUrl,
  discoveredOfficialHomepageUrl,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../../src/adapters/types.js";
import {
  type OfficialEnrichmentInput,
  type OfficialPageLoader,
  enrichOfficialSites,
} from "../../src/official-sites/enrichment.js";
import {
  OfficialFixtureIndexError,
  createFixtureOfficialPageLoader,
} from "../../src/official-sites/fixture-loader.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/official-sites");
const NOW = "2026-01-02T03:04:05.000Z";

type OfficialPageFixture = {
  readonly name: string;
  readonly eventDate: string;
  readonly venue?: string;
  readonly registrationPath?: string;
};

function evidence(name: string, eventDate: string): TransientRaceIdentityEvidence {
  return {
    titleHints: [transientIdentityHint(name)],
    dateHints: [transientIdentityHint(eventDate)],
    organizerHints: [],
  };
}

function discovery(name: string, eventDate: string, source = "source"): SourceDiscoveryCandidate {
  const id = sourceId(source);
  return {
    sourceId: id,
    sourceDetailUrl: sourceDetailUrl(
      `https://${source}.example/detail/${encodeURIComponent(name)}`,
    ),
    identityEvidence: evidence(name, eventDate),
  };
}

function officialLink(
  candidate: SourceDiscoveryCandidate,
  url: string,
  linkEvidence = candidate.identityEvidence,
): DiscoveredRaceLink {
  const parsed = discoveredOfficialHomepageUrl(url);
  if (parsed === null) throw new TypeError(`unsafe official URL: ${url}`);
  return {
    dedupKey: transientIdentityHint(
      `${linkEvidence.titleHints[0] ?? "race"}|${linkEvidence.dateHints[0] ?? "date"}`,
    ),
    kind: "official-site",
    url: parsed,
    sourceId: candidate.sourceId,
    sourceDetailUrl: candidate.sourceDetailUrl,
    identityEvidence: linkEvidence,
    evidence: "explicit-label",
  };
}

function applicationLink(candidate: SourceDiscoveryCandidate, url: string): DiscoveredRaceLink {
  const parsed = discoveredApplicationUrl(url);
  if (parsed === null) throw new TypeError(`unsafe application URL: ${url}`);
  return {
    dedupKey: transientIdentityHint(`${candidate.identityEvidence.titleHints[0] ?? "race"}|apply`),
    kind: "application",
    url: parsed,
    sourceId: candidate.sourceId,
    sourceDetailUrl: candidate.sourceDetailUrl,
    identityEvidence: candidate.identityEvidence,
    evidence: "explicit-label",
  };
}

function input(
  discoveryCandidates: readonly SourceDiscoveryCandidate[],
  discoveredOfficialCandidates: readonly DiscoveredRaceLink[],
): OfficialEnrichmentInput {
  return { discoveryCandidates, discoveredOfficialCandidates };
}

function page(fixture: OfficialPageFixture): string {
  const venue = fixture.venue ?? "공식 장소";
  const registrationPath = fixture.registrationPath ?? "/register";
  return `<title>${fixture.name}</title><h1>${fixture.name}</h1><p>대회일 ${fixture.eventDate}</p><p>장소: ${venue}</p><a href="${registrationPath}">참가신청</a>`;
}

function options(loadPage: OfficialPageLoader, maxFetches = 40) {
  return {
    today: "2026-01-01",
    verifiedAt: NOW,
    maxFetches,
    courtesyDelayMs: 0,
    loadPage,
    sleep: vi.fn(() => Promise.resolve()),
  };
}

describe("official-site enrichment", () => {
  it("materializes accepted official pages before publishing races", async () => {
    const candidate = discovery("2026 서울국제마라톤", "2026-03-15");
    const officialUrl = "https://official.example/seoul-2026";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: page({
        name: "2026 서울국제마라톤",
        eventDate: "2026-03-15",
        venue: "잠실종합운동장",
        registrationPath: "/entry",
      }),
    }));

    const result = await enrichOfficialSites(
      input([candidate], [officialLink(candidate, officialUrl)]),
      options(loadPage),
    );

    expect(result.races).toEqual([
      expect.objectContaining({
        name: "2026 서울국제마라톤",
        eventDate: "2026-03-15",
        venue: "잠실종합운동장",
        applicationUrl: "https://official.example/entry",
        officialSiteUrl: officialUrl,
        sources: ["official-sites"],
        verified: true,
      }),
    ]);
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(result.counts).toEqual({
      candidate: 1,
      fetched: 1,
      accepted: 1,
      rejected: 0,
      budgetSkipped: 0,
    });
  });

  it("coalesces duplicate exact official URLs before fetching", async () => {
    const first = discovery("2026 같은 공식 대회", "2026-04-01", "first");
    const second = discovery("2026 같은 공식 대회", "2026-04-01", "second");
    const officialUrl = "https://official.example/same-race";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: page({ name: "2026 같은 공식 대회", eventDate: "2026-04-01" }),
    }));

    const result = await enrichOfficialSites(
      input([first, second], [officialLink(first, officialUrl), officialLink(second, officialUrl)]),
      options(loadPage),
    );

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(result.races).toHaveLength(1);
    expect(result.counts).toEqual({
      candidate: 1,
      fetched: 1,
      accepted: 1,
      rejected: 0,
      budgetSkipped: 0,
    });
  });

  it("ignores source-site application candidates when materializing official pages", async () => {
    const candidate = discovery("2026 신청 링크 차단 대회", "2026-05-01");
    const officialUrl = "https://official.example/application-policy";
    const sourceApplication = "https://apply.example/register/123";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: page({ name: "2026 신청 링크 차단 대회", eventDate: "2026-05-01" }),
    }));

    const result = await enrichOfficialSites(
      input(
        [candidate],
        [applicationLink(candidate, sourceApplication), officialLink(candidate, officialUrl)],
      ),
      options(loadPage),
    );

    expect(loadPage.mock.calls.map(([url]) => url)).toEqual([officialUrl]);
    expect(result.races[0]?.applicationUrl).toBe("https://official.example/register");
    expect(result.races[0]?.applicationUrl).not.toBe(sourceApplication);
    expect(result.counts).toEqual({
      candidate: 1,
      fetched: 1,
      accepted: 1,
      rejected: 0,
      budgetSkipped: 0,
    });
  });

  it("rejects invalid official materialization before RaceSchema acceptance", async () => {
    const candidate = discovery("2026 날짜 없음 대회", "2026-06-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: "<title>2026 날짜 없음 대회</title><h1>2026 날짜 없음 대회</h1><p>장소: 공식 장소</p>",
    }));

    const result = await enrichOfficialSites(
      input([candidate], [officialLink(candidate, "https://official.example/missing-date")]),
      options(loadPage),
    );

    expect(result.races).toEqual([]);
    expect(result.counts).toEqual({
      candidate: 1,
      fetched: 1,
      accepted: 0,
      rejected: 1,
      budgetSkipped: 0,
    });
  });

  it("orders future candidates deterministically and applies the global fetch budget", async () => {
    const candidates = Array.from({ length: 45 }, (_, index) =>
      discovery(`예산 대회 ${String(index).padStart(2, "0")}`, "2026-04-01"),
    ).reverse();
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "fixture-rejected",
    }));

    const result = await enrichOfficialSites(
      input(
        candidates,
        candidates.map((candidate) =>
          officialLink(
            candidate,
            `https://official.example/${encodeURIComponent(candidate.identityEvidence.titleHints[0] ?? "race")}`,
          ),
        ),
      ),
      options(loadPage),
    );

    expect(loadPage).toHaveBeenCalledTimes(40);
    expect(decodeURIComponent(loadPage.mock.calls[0]?.[0] ?? "")).toContain("예산 대회 00");
    expect(result.races).toEqual([]);
    expect(result.counts).toEqual({
      candidate: 45,
      fetched: 40,
      accepted: 0,
      rejected: 40,
      budgetSkipped: 5,
    });
  });

  it("does not fetch past official candidates", async () => {
    const past = discovery("지난 대회", "2025-12-31");
    const future = discovery("미래 대회", "2026-02-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "failed",
      url,
      reason: "test",
    }));

    const result = await enrichOfficialSites(
      input(
        [past, future],
        [
          officialLink(past, "https://past.example/race"),
          officialLink(future, "https://future.example/first"),
          officialLink(future, "https://future.example/second"),
        ],
      ),
      options(loadPage, 1),
    );

    expect(loadPage.mock.calls.map(([url]) => url)).toEqual(["https://future.example/first"]);
    expect(result.counts).toEqual({
      candidate: 2,
      fetched: 1,
      accepted: 0,
      rejected: 1,
      budgetSkipped: 1,
    });
  });

  it("loads mapped fixtures and returns typed skips for missing or stale mappings", async () => {
    const loader = await createFixtureOfficialPageLoader(FIXTURES);

    await expect(loader("https://official.example/seoul-2026")).resolves.toMatchObject({
      kind: "success",
      url: "https://official.example/seoul-2026",
    });
    await expect(loader("https://missing.example/race")).resolves.toEqual({
      kind: "skipped",
      url: "https://missing.example/race",
      reason: "missing-mapping",
    });
    await expect(loader("https://stale.example/race")).resolves.toEqual({
      kind: "skipped",
      url: "https://stale.example/race",
      reason: "missing-file",
    });
  });

  it("delays repeated live hosts but not the first request to each host", async () => {
    const first = discovery("가 대회", "2026-04-01");
    const second = discovery("나 대회", "2026-04-01");
    const third = discovery("다 대회", "2026-04-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "test",
    }));
    const sleep = vi.fn(() => Promise.resolve());

    await enrichOfficialSites(
      input(
        [first, second, third],
        [
          officialLink(first, "https://same.example/a"),
          officialLink(second, "https://other.example/b"),
          officialLink(third, "https://same.example/c"),
        ],
      ),
      { ...options(loadPage), courtesyDelayMs: 1_000, sleep },
    );

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("does not delay fixture-host candidates when courtesy delay is disabled", async () => {
    const candidate = discovery("무지연 대회", "2026-04-01");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "rejected",
      url,
      reason: "fixture-rejected",
    }));
    const sleep = vi.fn(() => Promise.resolve());

    await enrichOfficialSites(
      input(
        [candidate],
        [
          officialLink(candidate, "https://fixture.example/first"),
          officialLink(candidate, "https://fixture.example/second"),
        ],
      ),
      { ...options(loadPage), sleep },
    );

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects a malformed fixture index at the fixture boundary", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "official-sites-"));
    try {
      await writeFile(resolve(directory, "index.json"), "{not-json", "utf8");
      await expect(createFixtureOfficialPageLoader(directory)).rejects.toBeInstanceOf(
        OfficialFixtureIndexError,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
