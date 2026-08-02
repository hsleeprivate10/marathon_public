import { describe, expect, it, vi } from "vitest";
import { marathonGoTrustedDetail, sourceDetailUrl, sourceId } from "../../src/adapters/types.js";
import type { OfficialPageLoader } from "../../src/official-sites/enrichment.js";
import { enrichOfficialSites } from "../../src/official-sites/enrichment.js";
import {
  applicationLink,
  collectMarathonGoAliasFixture,
  conflictingMarathonGoApplicationLink,
  discovery,
  input,
  marathonGoApplicationLink,
  options,
  page,
} from "./enrichment-helpers.js";

describe("official-site enrichment traversal", () => {
  it("traverses duplicate canonical application seeds once while retaining source evidence", async () => {
    const weak = discovery("2026 중복 신청 대회", "2026-08-01", "weak");
    const strong = discovery("2026 중복 신청 대회", "2026-08-01", "strong");
    const applicationUrl = "https://apply.example/register#section";
    const finalOfficialUrl = "https://official.example/duplicate-final";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url: url.replace("#section", ""),
      body: url.startsWith("https://apply.example/register")
        ? `<h1>2026 중복 신청 대회</h1><p>대회일 2026년 8월 1일</p><a href="${finalOfficialUrl}">공식 홈페이지</a>`
        : page({ name: "2026 중복 신청 대회", eventDate: "2026-08-01", venue: "공식 공원" }),
    }));

    const result = await enrichOfficialSites(
      input(
        [weak, strong],
        [applicationLink(weak, applicationUrl), applicationLink(strong, applicationUrl)],
      ),
      options(loadPage),
    );

    expect(loadPage.mock.calls.map(([url]) => url)).toEqual([
      "https://apply.example/register#section",
      finalOfficialUrl,
    ]);
    expect(result.races).toEqual([
      expect.objectContaining({
        name: "2026 중복 신청 대회",
        eventDate: "2026-08-01",
        venue: "공식 공원",
        officialSiteUrl: finalOfficialUrl,
      }),
    ]);
    expect(result.counts).toMatchObject({ seed: 1, fetched: 2, accepted: 1, rejected: 0 });
  });

  it("rejects a grouped same-url MarathonGo trusted date conflict without accepting non-MarathonGo evidence", async () => {
    const sourceCandidate = discovery("2026 올림픽공원 사우나런", "2026-08-01", "gorunning");
    const marathonGoCandidate = discovery("2026 올림픽공원 사우나런", "2026-08-01", "marathongo");
    const applicationUrl = "https://saunarun.com/products/z64zdfxy4mc9";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: page({
        name: "2026 올림픽공원 사우나런",
        eventDate: "2026-08-01",
        venue: "서울 올림픽공원 평화의광장",
      }),
    }));

    const result = await enrichOfficialSites(
      input(
        [sourceCandidate, marathonGoCandidate],
        [
          applicationLink(sourceCandidate, applicationUrl),
          conflictingMarathonGoApplicationLink(marathonGoCandidate, applicationUrl),
        ],
      ),
      options(loadPage),
    );

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(result.races).toEqual([]);
    expect(result.counts).toMatchObject({ seed: 1, fetched: 1, accepted: 0, rejected: 1 });
  });

  it("completes a live-shape MarathonGo same-race page with trusted date and venue", async () => {
    const candidate = discovery("2026 사우나런 in 올림픽공원", "2026-07-31", "marathongo");
    const productUrl = "https://saunarun.com/products/z64zdfxy4mc9?variant=44332211";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: `<title>2026 올림픽공원 사우나런</title><h1>2026 올림픽공원 사우나런</h1><a href="https://entry.saunarun.com/register/2026">참가신청</a>`,
    }));

    const result = await enrichOfficialSites(
      input([candidate], [marathonGoApplicationLink(candidate, productUrl)]),
      options(loadPage),
    );

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(result.races).toEqual([
      expect.objectContaining({
        name: "2026 올림픽공원 사우나런",
        eventDate: "2026-07-31",
        venue: "서울 올림픽공원 평화의광장",
        officialSiteUrl: productUrl,
        applicationUrl: "https://entry.saunarun.com/register/2026",
        sources: ["official-sites", "marathongo"],
      }),
    ]);
    expect(JSON.stringify(result.races[0])).not.toContain("marathongo.co.kr");
  });

  it("accepts MarathonGo no-year A-in-B aliases while leaving other sources unchanged", async () => {
    const applicationUrl = "https://ttukseom-saunarun.example/event";
    const marathonGo = await collectMarathonGoAliasFixture();
    const other = discovery("사우나런 in 뚝섬한강공원", "2026-07-31", "other-source");
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: `<title>뚝섬 한강공원 사우나런</title><h1>뚝섬 한강공원 사우나런</h1><a href="https://entry.ttukseom-saunarun.example/apply">참가신청</a>`,
    }));

    const otherResult = await enrichOfficialSites(
      input([other], [applicationLink(other, applicationUrl)]),
      options(loadPage),
    );
    const marathonGoResult = await enrichOfficialSites(marathonGo, options(loadPage));

    expect(otherResult.races).toEqual([]);
    expect(marathonGoResult.races).toEqual([
      expect.objectContaining({
        name: "뚝섬 한강공원 사우나런",
        eventDate: "2026-07-31",
        venue: "서울 뚝섬한강공원 수변마당",
        officialSiteUrl: applicationUrl,
        applicationUrl: "https://entry.ttukseom-saunarun.example/apply",
        sources: ["official-sites", "marathongo"],
      }),
    ]);
    expect(JSON.stringify(marathonGoResult.races[0])).not.toContain("marathongo.co.kr");
  });

  it("fetches duplicate canonical seeds once while retaining MarathonGo trusted provenance", async () => {
    const other = discovery("2026 올림픽공원 사우나런", "2026-07-31", "aaa-source");
    const marathongo = discovery("2026 사우나런 in 올림픽공원", "2026-07-31", "marathongo");
    const productUrl = "https://saunarun.com/products/z64zdfxy4mc9?variant=44332211";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: "<h1>2026 올림픽공원 사우나런</h1>",
    }));

    const result = await enrichOfficialSites(
      input(
        [other, marathongo],
        [applicationLink(other, productUrl), marathonGoApplicationLink(marathongo, productUrl)],
      ),
      options(loadPage),
    );

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(result.races[0]).toMatchObject({
      eventDate: "2026-07-31",
      venue: "서울 올림픽공원 평화의광장",
      sources: ["official-sites", "marathongo"],
    });
  });

  it("rejects unowned and conflicting trusted detail completion", async () => {
    const other = discovery("2026 올림픽공원 사우나런", "2026-07-31", "other-source");
    const first = discovery("2026 올림픽공원 사우나런", "2026-07-31", "marathongo");
    const second = discovery("2026 올림픽공원 사우나런", "2026-07-31", "marathongo");
    const productUrl = "https://saunarun.com/products/z64zdfxy4mc9?variant=44332211";
    const loadPage = vi.fn<OfficialPageLoader>(async (url) => ({
      kind: "success",
      url,
      body: "<h1>2026 올림픽공원 사우나런</h1>",
    }));
    const conflictingTrustedDetail = marathonGoTrustedDetail({
      sourceId: sourceId("marathongo"),
      sourceDetailUrl: sourceDetailUrl(
        "https://marathongo.co.kr/raceDetail/domestic/saunarun-olympicpark-2026-07-31",
      ),
      eventDate: "2026-07-31",
      venue: "부산 해운대",
    });
    if (conflictingTrustedDetail === undefined) throw new TypeError("invalid conflict detail");
    const conflictingSeed = {
      ...marathonGoApplicationLink(second, productUrl),
      trustedDetail: conflictingTrustedDetail,
    };

    await expect(
      enrichOfficialSites(input([other], [applicationLink(other, productUrl)]), options(loadPage)),
    ).resolves.toMatchObject({ races: [] });
    await expect(
      enrichOfficialSites(
        input([first, second], [marathonGoApplicationLink(first, productUrl), conflictingSeed]),
        options(loadPage),
      ),
    ).resolves.toMatchObject({ races: [] });
  });
});
