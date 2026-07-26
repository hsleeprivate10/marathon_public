import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { CollectionOutput, Race } from "../../src/contract.js";
import { routeWeather } from "./weather.js";

const generatedAt = "2026-07-19T00:00:00.000Z";
const remoteLogoUrl = "https://logos.example/event-logo.png";
const failedLogoUrl = "https://logos.example/missing-logo.png";
const remoteLogoBody = readFileSync(new URL("../../public/logo1.png", import.meta.url));

type LogoRaceFixture = {
  readonly name: string;
  readonly eventDate: string;
  readonly applicationUrl: string;
  readonly logoUrl?: string;
};

function race(fixture: LogoRaceFixture): Race {
  return {
    name: fixture.name,
    eventDate: fixture.eventDate,
    registrationDeadline: null,
    venue: "서울 시민운동장",
    region: "서울",
    courses: [{ name: "10K", price: null }],
    applicationUrl: fixture.applicationUrl,
    sources: ["logo-e2e-fixture"],
    verified: true,
    lastVerified: generatedAt,
    updatedAt: generatedAt,
    generatedAt,
    registrationStatus: "open",
    ...(fixture.logoUrl === undefined ? {} : { logoUrl: fixture.logoUrl }),
  };
}

export const logoFixture = {
  successName: "원격 로고 성공 대회",
  missingName: "로고 없는 대회",
  failureName: "원격 로고 실패 대회",
  remoteLogoUrl,
  failedLogoUrl,
  applicationUrls: [
    "https://example.com/logo-success",
    "https://example.com/logo-missing",
    "https://example.com/logo-failure",
  ],
} as const;

export type LogoRequestEvidence = {
  readonly successHeaders: Record<string, string>[];
  readonly failureHeaders: Record<string, string>[];
};

const logoCollection: CollectionOutput = {
  generatedAt,
  races: [
    race({
      name: logoFixture.successName,
      eventDate: "2026-08-10",
      applicationUrl: logoFixture.applicationUrls[0],
      logoUrl: remoteLogoUrl,
    }),
    race({
      name: logoFixture.missingName,
      eventDate: "2026-08-11",
      applicationUrl: logoFixture.applicationUrls[1],
    }),
    race({
      name: logoFixture.failureName,
      eventDate: "2026-08-12",
      applicationUrl: logoFixture.applicationUrls[2],
      logoUrl: failedLogoUrl,
    }),
  ],
  collectionMetadata: [
    {
      id: "logo-e2e-fixture",
      attempted: true,
      succeeded: true,
      recordCount: 3,
      message: "deterministic race-logo browser fixture",
    },
  ],
};

export async function routeLogoFixture(page: Page): Promise<LogoRequestEvidence> {
  const evidence: LogoRequestEvidence = { successHeaders: [], failureHeaders: [] };
  await routeWeather(page);
  await page.route("**/races.json", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(logoCollection) });
  });
  await page.route(remoteLogoUrl, async (route) => {
    evidence.successHeaders.push(await route.request().allHeaders());
    await route.fulfill({ status: 200, contentType: "image/png", body: remoteLogoBody });
  });
  await page.route(failedLogoUrl, async (route) => {
    evidence.failureHeaders.push(await route.request().allHeaders());
    await route.fulfill({ status: 404, contentType: "image/png", body: "not found" });
  });
  return evidence;
}

export async function routeMalformedLogoFixture(page: Page): Promise<void> {
  await page.route("**/races.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...logoCollection,
        races: [{ ...logoCollection.races[0], logoUrl: "javascript:alert(1)" }],
      }),
    });
  });
}
