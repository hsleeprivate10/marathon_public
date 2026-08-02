import { describe, expect, it, vi } from "vitest";
import type { OfficialPageLoader } from "../../src/official-sites/enrichment.js";
import { enrichOfficialSites } from "../../src/official-sites/enrichment.js";
import {
  applicationLink,
  discovery,
  input,
  officialLink,
  options,
  page,
} from "./enrichment-helpers.js";

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
      seed: 1,
      fetched: 1,
      accepted: 1,
      rejected: 0,
      policyRejected: 0,
      fetchRejected: 0,
      identityRejected: 0,
      depthSkipped: 0,
      cycleSkipped: 0,
      hostBudgetSkipped: 0,
      runBudgetSkipped: 0,
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
    expect(result.counts).toMatchObject({ seed: 1, fetched: 1, accepted: 1, rejected: 0 });
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

    expect(loadPage.mock.calls.map(([url]) => url)).toEqual([sourceApplication, officialUrl]);
    expect(result.races[0]?.applicationUrl).toBe("https://official.example/register");
    expect(result.races[0]?.applicationUrl).not.toBe(sourceApplication);
    expect(result.counts).toMatchObject({ seed: 2, fetched: 2, accepted: 1, rejected: 1 });
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
    expect(result.counts).toMatchObject({ seed: 1, fetched: 1, accepted: 0, rejected: 1 });
  });
});
