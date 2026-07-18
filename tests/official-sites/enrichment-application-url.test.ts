import { describe, expect, it, vi } from "vitest";
import type { DiscoveredRaceLink } from "../../src/adapters/types.js";
import type { Race } from "../../src/contract.js";
import { dedupKey } from "../../src/normalize.js";
import {
  type OfficialPageLoader,
  enrichOfficialSites,
} from "../../src/official-sites/enrichment.js";

const NOW = "2026-01-02T03:04:05.000Z";
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

function race(name: string): Race {
  return {
    name,
    eventDate: "2026-03-15",
    registrationDeadline: null,
    venue: "미상",
    courses: [],
    applicationUrl: "https://source.example/original",
    sources: ["source"],
    verified: true,
    lastVerified: NOW,
    updatedAt: NOW,
    generatedAt: NOW,
    registrationStatus: "unknown",
  };
}

function applicationLink(owner: Race, url: string): DiscoveredRaceLink {
  return {
    dedupKey: dedupKey(owner),
    kind: "application",
    url,
    sourceId: "source",
    sourcePageUrl: "https://source.example/detail",
    evidence: "explicit-label",
  };
}

function officialLink(owner: Race, url: string): DiscoveredRaceLink {
  return { ...applicationLink(owner, url), kind: "official-site" };
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
    const original = race("결제 공식 URL 차단");
    const loadPage = vi.fn<OfficialPageLoader>();

    const result = await enrichOfficialSites(
      [original],
      [officialLink(original, "https://payments.example/checkout")],
      options(loadPage),
    );

    expect(result.races).toEqual([original]);
    expect(loadPage).not.toHaveBeenCalled();
    expect(result.counts).toEqual({
      candidate: 0,
      fetched: 0,
      accepted: 0,
      rejected: 0,
      budgetSkipped: 0,
    });
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
  ])("counts and rejects manually constructed official registration candidate %s", async (url) => {
    const original = race(`신청 공식 후보 차단 ${url}`);
    const loadPage = vi.fn<OfficialPageLoader>();

    const result = await enrichOfficialSites(
      [original],
      [officialLink(original, url)],
      options(loadPage),
    );

    expect(result.races).toEqual([original]);
    expect(loadPage).not.toHaveBeenCalled();
    expect(result.counts).toEqual({
      candidate: 1,
      fetched: 0,
      accepted: 0,
      rejected: 1,
      budgetSkipped: 0,
    });
  });

  it.each(unsafeApplicationUrls)(
    "rejects and never fetches unsafe application URL %s",
    async (url) => {
      const original = race(`차단 ${url}`);
      const loadPage = vi.fn<OfficialPageLoader>();

      const result = await enrichOfficialSites(
        [original],
        [applicationLink(original, url)],
        options(loadPage),
      );

      expect(result.races).toEqual([original]);
      expect(result.races[0]?.officialSiteUrl).toBeUndefined();
      expect(loadPage).not.toHaveBeenCalled();
      expect(result.counts).toEqual({
        candidate: 0,
        fetched: 0,
        accepted: 0,
        rejected: 0,
        budgetSkipped: 0,
      });
    },
  );

  it("excludes explicit and structured application candidates from loader calls while applying fallback applicationUrl", async () => {
    const original = race("신청 링크만 별도 대회");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: `<h1>${original.name}</h1><p>대회일 ${original.eventDate}</p>`,
    }));

    const result = await enrichOfficialSites(
      [original],
      [
        applicationLink(original, "https://event.example.com/register"),
        {
          ...applicationLink(original, "https://organizer.example.com/Application.aspx"),
          evidence: "structured-organizer",
        },
        officialLink(original, "https://official.example.com/home"),
      ],
      options(loadPage),
    );

    expect(loadPage.mock.calls.map(([url]) => url)).toEqual(["https://official.example.com/home"]);
    expect(result.races[0]).toMatchObject({
      applicationUrl: "https://event.example.com/register",
      officialSiteUrl: "https://official.example.com/home",
    });
    expect(result.counts.candidate).toBe(1);
  });

  it.each([
    "https://apply.example/register",
    "http://apply.example/register",
    "https://payments-marathon.example/register",
  ])("allows public application URL %s without fetching it", async (url) => {
    const original = race(`허용 ${url}`);
    const loadPage = vi.fn<OfficialPageLoader>();

    const result = await enrichOfficialSites(
      [original],
      [applicationLink(original, url)],
      options(loadPage),
    );

    expect(result.races[0]?.applicationUrl).toBe(url);
    expect(result.races[0]?.officialSiteUrl).toBeUndefined();
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
