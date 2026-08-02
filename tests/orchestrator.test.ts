import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionOutputSchema } from "../src/contract.js";
import { collect } from "../src/orchestrator.js";
import {
  adapter,
  createOutputDir,
  noDelay,
  officialPage,
  removeOutputDir,
} from "./orchestrator-helpers.js";

const TMP_DIR = resolve(import.meta.dirname, "__tmp_output_core__");

beforeEach(() => createOutputDir(TMP_DIR));
afterEach(() => removeOutputDir(TMP_DIR));

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
        ...noDelay,
        fetchOfficialPage,
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
        ...noDelay,
        fetchOfficialPage,
      },
    );

    expect(fetchOfficialPage).toHaveBeenCalledTimes(1);
    expect(result.races).toHaveLength(1);
    expect(result.collectionMetadata.at(-1)).toEqual({
      id: "official-sites",
      attempted: true,
      succeeded: true,
      recordCount: 1,
      message:
        "seed=1 fetched=1 accepted=1 rejected=0 policyRejected=0 fetchRejected=0 identityRejected=0 depthSkipped=0 cycleSkipped=0 hostBudgetSkipped=0 runBudgetSkipped=0",
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
        ...noDelay,
        fetchOfficialPage,
      },
    );

    expect(fetchOfficialPage.mock.calls.map(([url]) => url)).toEqual([firstUrl, secondUrl]);
    expect(result.races).toHaveLength(1);
    expect(result.collectionMetadata.at(-1)).toMatchObject({ recordCount: 2 });
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
        ...noDelay,
        fetchOfficialPage,
      },
    );

    expect(result.races[0]?.applicationUrl).toBe(officialUrl);
    expect(result.races[0]?.applicationUrl).not.toBe(sourceApplication);
  });

  it("materializes an official race through an application-only traversal seed", async () => {
    const applicationUrl = "https://apply.example/register";
    const finalOfficialUrl = "https://official.example/application-final";
    const fetchOfficialPage = vi.fn(async (url: string) => ({
      kind: "success" as const,
      url,
      address: "203.0.113.6",
      contentType: "text/html",
      body:
        url === applicationUrl
          ? `<h1>2026 신청 경유 대회</h1><p>대회일 2026년 8월 1일</p><a href="${finalOfficialUrl}">공식 홈페이지</a>`
          : officialPage({
              name: "2026 신청 경유 대회",
              eventDate: "2026-08-01",
              venue: "공식 공원",
            }),
    }));

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: undefined },
      {
        adapters: [
          adapter({
            id: "source",
            name: "2026 신청 경유 대회",
            eventDate: "2026-08-01",
            applicationUrls: [applicationUrl],
          }),
        ],
        ...noDelay,
        fetchOfficialPage,
      },
    );

    expect(fetchOfficialPage.mock.calls.map(([url]) => url)).toEqual([
      applicationUrl,
      finalOfficialUrl,
    ]);
    expect(result.races[0]).toMatchObject({
      officialSiteUrl: finalOfficialUrl,
      applicationUrl: "https://official.example/entry",
    });
    expect(result.collectionMetadata.at(-1)).toMatchObject({ recordCount: 1 });
  });
});
