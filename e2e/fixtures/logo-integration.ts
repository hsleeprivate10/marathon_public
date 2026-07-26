import { readFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";
import type { CollectionOutput, Race } from "../../src/contract.js";
import { airQualityResponse, reverseLocationResponse, weatherResponse } from "./weather.js";

const generatedAt = "2026-07-20T00:00:00.000Z";
const remoteOrigin = "https://logos.example";
const remoteLogoBody = readFileSync(new URL("../../public/logo1.png", import.meta.url));

export const integrationLogos = {
  success: `${remoteOrigin}/success.png`,
  failure: `${remoteOrigin}/failure.png`,
  far: `${remoteOrigin}/far.png`,
} as const;

export const integrationNames = {
  success: "통합 원격 성공 대회",
  missing: "통합 로고 없음 대회",
  rejected: "통합 일반 사이트 로고 거부 대회",
  failure: "통합 원격 실패 대회",
  far: "통합 지연 원격 대회",
} as const;

type RemoteLogoRequest = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly status: number;
};

type NetworkRequest = {
  readonly url: string;
  readonly resourceType: string;
};

export type LogoIntegrationEvidence = {
  readonly remoteRequests: RemoteLogoRequest[];
  readonly logo1Requests: string[];
  readonly blockedRequests: NetworkRequest[];
};

type RaceInput = {
  readonly name: string;
  readonly eventDate: string;
  readonly applicationId: string;
  readonly logoUrl?: string;
};

function race(input: RaceInput): Race {
  return {
    name: input.name,
    eventDate: input.eventDate,
    registrationDeadline: null,
    venue: "서울 시민운동장",
    region: "서울",
    courses: [{ name: "10K", price: null }],
    applicationUrl: `https://example.com/${input.applicationId}`,
    sources: ["logo-integration-fixture"],
    verified: true,
    lastVerified: generatedAt,
    updatedAt: generatedAt,
    generatedAt,
    registrationStatus: "open",
    ...(input.logoUrl === undefined ? {} : { logoUrl: input.logoUrl }),
  };
}

const namedRaces = [
  race({
    name: integrationNames.success,
    eventDate: "2026-08-01",
    applicationId: "integration-success",
    logoUrl: integrationLogos.success,
  }),
  race({
    name: integrationNames.missing,
    eventDate: "2026-08-02",
    applicationId: "integration-missing",
  }),
  race({
    name: integrationNames.rejected,
    eventDate: "2026-08-03",
    applicationId: "integration-rejected",
  }),
  race({
    name: integrationNames.failure,
    eventDate: "2026-08-04",
    applicationId: "integration-failure",
    logoUrl: integrationLogos.failure,
  }),
] as const;

const spacerRaces = Array.from({ length: 24 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 8 + index, 1)).toISOString().slice(0, 10);
  return race({
    name: `통합 지연 간격 대회 ${String(index + 1).padStart(2, "0")}`,
    eventDate: date,
    applicationId: `integration-spacer-${index + 1}`,
  });
});

const farRace = race({
  name: integrationNames.far,
  eventDate: "2028-09-01",
  applicationId: "integration-far",
  logoUrl: integrationLogos.far,
});

const deterministicServices = [
  { prefix: "https://api.open-meteo.com/v1/forecast?", body: weatherResponse },
  {
    prefix: "https://air-quality-api.open-meteo.com/v1/air-quality?",
    body: airQualityResponse,
  },
  {
    prefix: "https://nominatim.openstreetmap.org/reverse?",
    body: reverseLocationResponse,
  },
] as const;

export const logoIntegrationCollection: CollectionOutput = {
  generatedAt,
  races: [...namedRaces, ...spacerRaces, farRace],
  collectionMetadata: [
    {
      id: "logo-integration-fixture",
      attempted: true,
      succeeded: true,
      recordCount: namedRaces.length + spacerRaces.length + 1,
      message: "deterministic production logo integration fixture",
    },
  ],
};

export async function routeLogoIntegration(page: Page, holdFailure = false) {
  const evidence: LogoIntegrationEvidence = {
    remoteRequests: [],
    logo1Requests: [],
    blockedRequests: [],
  };
  let releaseGate: (() => void) | undefined;
  const failureGate = holdFailure
    ? new Promise<void>((resolve) => {
        releaseGate = resolve;
      })
    : Promise.resolve();

  await page.route("**/races.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(logoIntegrationCollection),
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/marathon/logo1.png")
      evidence.logo1Requests.push(request.url());
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const parsedUrl = new URL(url);
    if (
      parsedUrl.origin === "http://127.0.0.1:4177" &&
      parsedUrl.pathname.startsWith("/marathon/")
    ) {
      await route.fallback();
      return;
    }
    const requestRecord = {
      url,
      resourceType: request.resourceType(),
    };
    const service = deterministicServices.find(({ prefix }) => url.startsWith(prefix));
    if (service !== undefined) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(service.body) });
      return;
    }
    const approvedLogo =
      request.resourceType() === "image" &&
      (url === integrationLogos.success ||
        url === integrationLogos.failure ||
        url === integrationLogos.far);
    if (!approvedLogo) {
      evidence.blockedRequests.push(requestRecord);
      await route.abort("blockedbyclient");
      return;
    }
    const status = url === integrationLogos.failure ? 404 : 200;
    if (status === 404) await failureGate;
    evidence.remoteRequests.push({ url, headers: await request.allHeaders(), status });
    await route.fulfill({
      status,
      contentType: "image/png",
      body: status === 200 ? remoteLogoBody : "not found",
    });
  });
  if (process.env.TASK10_INJECT_REFERER === "1") {
    await page.route(integrationLogos.success, async (route) => {
      await route.fallback({
        headers: {
          ...(await route.request().allHeaders()),
          referer: "https://privacy-regression.example/",
        },
      });
    });
  }

  return { evidence, releaseFailure: () => releaseGate?.() };
}

export async function observeLocalLogoCoalescing(browser: Browser, logoUrl: string) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  let requests = 0;
  let responses = 0;
  page.on("request", (request) => {
    if (request.url() === logoUrl) requests += 1;
  });
  page.on("response", (response) => {
    if (response.url() === logoUrl) responses += 1;
  });
  try {
    await page.goto(new URL("./", logoUrl).href);
    await page.evaluate(() => performance.clearResourceTimings());
    await page.evaluate((url) => {
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 6; index += 1) {
        const image = new Image();
        image.alt = `consumer ${index + 1}`;
        image.src = url;
        fragment.append(image);
      }
      document.body.replaceChildren(fragment);
    }, logoUrl);
    const decodedWidths = await page.locator("img").evaluateAll(async (nodes) =>
      Promise.all(
        nodes.map(async (node) => {
          if (!(node instanceof HTMLImageElement)) return 0;
          await node.decode();
          return node.naturalWidth;
        }),
      ),
    );
    await page.waitForFunction(
      (url) => performance.getEntriesByName(url, "resource").length > 0,
      logoUrl,
    );
    const resources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .flatMap((entry) =>
          "transferSize" in entry && typeof entry.transferSize === "number"
            ? [{ name: entry.name, transferSize: entry.transferSize }]
            : [],
        ),
    );
    const logoResources = resources.filter(({ name }) => name === logoUrl);
    return {
      consumers: decodedWidths.length,
      decodedWidths,
      requests,
      responses,
      resources: logoResources,
    };
  } finally {
    await context.close();
  }
}
