import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionOutputSchema } from "../src/contract.js";
import { collect } from "../src/orchestrator.js";
import {
  FIXTURES_DIR,
  adapter,
  createOutputDir,
  noDelay,
  officialPage,
  removeOutputDir,
} from "./orchestrator-helpers.js";

const TMP_DIR = resolve(import.meta.dirname, "__tmp_output_fixtures__");

beforeEach(() => createOutputDir(TMP_DIR));
afterEach(() => removeOutputDir(TMP_DIR));

describe("orchestrator fixtures", () => {
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
        ...noDelay,
        fetchOfficialPage,
      },
    );

    expect(result.races.map((race) => race.eventDate)).toEqual(["2026-03-01", "2026-09-01"]);
    expect(
      result.races.every(
        (race) => race.generatedAt === noDelay.now() && race.updatedAt === noDelay.now(),
      ),
    ).toBe(true);
  });

  it("runs fixture adapters through official fixtures without invoking live fetch", async () => {
    const fetchOfficialPage = vi.fn(() => Promise.reject(new Error("network attempted")));
    const sleep = vi.fn(() => Promise.resolve());

    const result = await collect(
      { projectRoot: TMP_DIR, fixtureBaseDir: FIXTURES_DIR },
      { now: noDelay.now, fetchOfficialPage, sleep },
    );

    const metadataIds = result.collectionMetadata.map((item) => item.id);
    const officialMetadata = result.collectionMetadata.at(-1);
    const publishedUrls = result.races.flatMap((race) => [
      race.applicationUrl,
      race.officialSiteUrl ?? "",
    ]);
    const marathonGoRace = result.races.find(
      (race) => race.officialSiteUrl === "https://saunarun-official.example.org/2026",
    );

    expect(fetchOfficialPage).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(CollectionOutputSchema.safeParse(result).success).toBe(true);
    expect(metadataIds).toEqual([
      "gorunning",
      "marathongo",
      "kormarathon",
      "emarathon",
      "maedal",
      "kaaf",
      "marathonmoa",
      "runningmap",
      "marathonmate",
      "official-sites",
    ]);
    expect(officialMetadata).toMatchObject({ id: "official-sites", recordCount: 5 });
    expect(marathonGoRace).toMatchObject({
      name: "2026 사우나런 올림픽공원 공식대회",
      eventDate: "2026-07-31",
      venue: "서울 올림픽공원 평화의광장",
      applicationUrl: "https://entry.saunarun-official.example.org/register/2026",
      officialSiteUrl: "https://saunarun-official.example.org/2026",
      sources: ["official-sites"],
      verified: true,
    });
    expect(publishedUrls.every((url) => !url.includes("marathongo.co.kr"))).toBe(true);
    expect(publishedUrls.every((url) => !url.includes("saunarun.com/products"))).toBe(true);
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
        now: noDelay.now,
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
        "seed=1 fetched=1 accepted=0 rejected=1 policyRejected=0 fetchRejected=1",
      ),
    });
  });
});
