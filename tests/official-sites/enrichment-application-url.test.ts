import { describe, expect, it, vi } from "vitest";
import {
  type DiscoveredApplicationUrl,
  type DiscoveredOfficialUrl,
  type DiscoveredRaceLink,
  type SourceDiscoveryCandidate,
  type TransientRaceIdentityEvidence,
  discoveredApplicationUrl,
  discoveredOfficialHomepageUrl,
  discoveredOfficialUrl,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../../src/adapters/types.js";
import {
  type OfficialEnrichmentInput,
  type OfficialPageLoader,
  enrichOfficialSites,
} from "../../src/official-sites/enrichment.js";

const NOW = "2026-01-02T03:04:05.000Z";
const SOURCE_ID = sourceId("source");
const SOURCE_DETAIL_URL = sourceDetailUrl("https://source.example/detail");
const unsafeApplicationUrls = [
  "http://localhost/register",
  "https://race.local/register",
  "https://user:secret@apply.example/register",
  "http://127.0.0.1/register",
  "http://10.0.0.1/register",
  "http://169.254.1.1/register",
  "http://[::1]/register",
  "http://[fc00::1]/register",
  "http://[fe80::1]/register",
  "https://payments.example/checkout",
] as const;

type CandidateFixture = {
  readonly name: string;
  readonly eventDate: string;
};

function candidateFixture(name: string): CandidateFixture {
  return { name, eventDate: "2026-03-15" };
}

function identityEvidence(owner: CandidateFixture): TransientRaceIdentityEvidence {
  return {
    titleHints: [transientIdentityHint(owner.name)],
    dateHints: [transientIdentityHint(owner.eventDate)],
    organizerHints: [],
  };
}

function discoveryCandidate(owner: CandidateFixture): SourceDiscoveryCandidate {
  return {
    sourceId: SOURCE_ID,
    sourceDetailUrl: SOURCE_DETAIL_URL,
    identityEvidence: identityEvidence(owner),
  };
}

function enrichmentInput(
  owner: CandidateFixture,
  discoveredOfficialCandidates: readonly DiscoveredRaceLink[],
): OfficialEnrichmentInput {
  return {
    discoveryCandidates: [discoveryCandidate(owner)],
    discoveredOfficialCandidates,
  };
}

function applicationLink(owner: CandidateFixture, url: string): DiscoveredRaceLink {
  return {
    dedupKey: transientIdentityHint(`${owner.name}|${owner.eventDate}|application`),
    kind: "application",
    url: requiredDiscoveredApplicationUrl(url),
    sourceId: SOURCE_ID,
    sourceDetailUrl: SOURCE_DETAIL_URL,
    identityEvidence: identityEvidence(owner),
    evidence: "explicit-label",
  };
}

function officialLink(owner: CandidateFixture, url: string): DiscoveredRaceLink {
  return {
    dedupKey: transientIdentityHint(`${owner.name}|${owner.eventDate}|official`),
    kind: "official-site",
    url: requiredDiscoveredOfficialUrl(url),
    sourceId: SOURCE_ID,
    sourceDetailUrl: SOURCE_DETAIL_URL,
    identityEvidence: identityEvidence(owner),
    evidence: "explicit-label",
  };
}

function requiredDiscoveredApplicationUrl(url: string): DiscoveredApplicationUrl {
  const parsed = discoveredApplicationUrl(url);
  if (parsed === null) throw new Error(`Expected safe application fixture URL: ${url}`);
  return parsed;
}

function requiredDiscoveredOfficialUrl(url: string): DiscoveredOfficialUrl {
  const parsed = discoveredOfficialUrl(url) ?? discoveredOfficialHomepageUrl(url);
  if (parsed === null) throw new Error(`Expected safe official fixture URL: ${url}`);
  return parsed;
}

function options(loadPage: OfficialPageLoader) {
  return {
    today: "2026-01-01",
    verifiedAt: NOW,
    maxFetches: 40,
    courtesyDelayMs: 0,
    loadPage,
    sleep: () => Promise.resolve(),
  };
}

describe("enrichment application URL policy", () => {
  it("rejects and never fetches a payment official URL", async () => {
    const loadPage = vi.fn<OfficialPageLoader>();

    expect(discoveredOfficialUrl("https://payments.example/checkout")).toBeNull();
    expect(loadPage).not.toHaveBeenCalled();
  });

  it.each([
    "https://official.example/register",
    "https://official.example/events/%2561pply",
    "https://official.example/entry.php",
    "https://official.example/SIGNUP.aspx.",
    "https://official.example/join.do",
    "https://official.example/register.action",
    "https://official.example/apply.cgi",
    "https://official.example/entry.pl",
    "https://official.example/signup.cfm",
    "https://official.example/join.shtml",
  ])("ignores manually constructed official registration candidate %s", async (url) => {
    const owner = candidateFixture(`신청 공식 후보 차단 ${url}`);
    const loadPage = vi.fn<OfficialPageLoader>();

    const result = await enrichOfficialSites(
      enrichmentInput(owner, [officialLink(owner, url)]),
      options(loadPage),
    );

    expect(result.races).toEqual([]);
    expect(loadPage).not.toHaveBeenCalled();
    expect(result.counts).toEqual({
      candidate: 0,
      fetched: 0,
      accepted: 0,
      rejected: 0,
      budgetSkipped: 0,
    });
  });

  it.each(unsafeApplicationUrls)(
    "rejects and never fetches unsafe application URL %s",
    async (url) => {
      const loadPage = vi.fn<OfficialPageLoader>();

      expect(discoveredApplicationUrl(url)).toBeNull();
      expect(loadPage).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://generic-organizer.example/",
    "https://generic-organizer.example/index.asp",
    "https://emarathon.or.kr",
  ])("does not apply a generic application candidate %s", async (url) => {
    const loadPage = vi.fn<OfficialPageLoader>();

    expect(discoveredApplicationUrl(url)).toBeNull();
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("excludes explicit and structured application candidates from loader calls and publication", async () => {
    const owner = candidateFixture("신청 링크만 별도 대회");
    const officialUrl = "https://official.example.com/event/source-application-policy";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: `<h1>${owner.name}</h1><p>대회일 ${owner.eventDate}</p><p>장소 공식 장소</p>`,
    }));

    const result = await enrichOfficialSites(
      enrichmentInput(owner, [
        applicationLink(owner, "https://event.example.com/register"),
        {
          ...applicationLink(owner, "https://organizer.example.com/Application.aspx"),
          evidence: "structured-organizer",
        },
        officialLink(owner, officialUrl),
      ]),
      options(loadPage),
    );

    expect(loadPage.mock.calls.map(([url]) => url)).toEqual([officialUrl]);
    expect(result.races[0]).toMatchObject({
      applicationUrl: officialUrl,
      officialSiteUrl: officialUrl,
    });
    expect(result.counts.candidate).toBe(1);
  });

  it.each([
    "https://apply.example/register",
    "http://apply.example/register",
    "https://payments-marathon.example/register",
  ])("keeps public application URL %s as negative evidence only", async (url) => {
    const owner = candidateFixture(`허용 ${url}`);
    const loadPage = vi.fn<OfficialPageLoader>();

    const result = await enrichOfficialSites(
      enrichmentInput(owner, [applicationLink(owner, url)]),
      options(loadPage),
    );

    expect(result.races).toEqual([]);
    expect(loadPage).not.toHaveBeenCalled();
    expect(result.counts).toEqual({
      candidate: 0,
      fetched: 0,
      accepted: 0,
      rejected: 0,
      budgetSkipped: 0,
    });
  });
});
