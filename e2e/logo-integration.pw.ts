import { rm, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  integrationLogos,
  integrationNames,
  logoIntegrationCollection,
  observeLocalLogoCoalescing,
  routeLogoIntegration,
} from "./fixtures/logo-integration.js";
import { observeErrors } from "./helpers/browser.js";

const widths = [375, 768, 1280] as const;
const colorSchemes = ["light", "dark"] as const;
const expected404 =
  "Failed to load resource: the server responded with a status of 404 (Not Found)";
const imageAttributes = {
  alt: "",
  "aria-hidden": "true",
  width: "120",
  height: "90",
  loading: "lazy",
  decoding: "async",
  fetchpriority: "low",
  referrerpolicy: "no-referrer",
} as const;

const rowFor = (page: Page, name: string): Locator =>
  page.locator(".home-race-row").filter({ hasText: name });

async function expectImageContract(image: Locator): Promise<void> {
  await expect(image).toHaveCount(1);
  for (const [attribute, value] of Object.entries(imageAttributes))
    await expect(image).toHaveAttribute(attribute, value);
}

async function mediaBox(row: Locator) {
  return row.locator(".home-race-media").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
  });
}

async function expectDecoded(image: Locator, expectedPath: string): Promise<void> {
  await expect
    .poll(() =>
      image.evaluate((node) => {
        if (!(node instanceof HTMLImageElement)) return null;
        return {
          complete: node.complete,
          naturalWidth: node.naturalWidth,
          path: node.currentSrc === "" ? "" : new URL(node.currentSrc).pathname,
        };
      }),
    )
    .toEqual({ complete: true, naturalWidth: 256, path: expectedPath });
}

async function expectResponsiveIntegrity(page: Page): Promise<void> {
  const integrity = await page.evaluate(() => {
    const viewportWidth = innerWidth;
    const rows = [...document.querySelectorAll<HTMLElement>(".home-race-row")];
    return {
      overflow: document.documentElement.scrollWidth > viewportWidth,
      replacement: document.body.innerText.includes("\uFFFD"),
      invalidRows: rows.filter((row) => {
        const rowBox = row.getBoundingClientRect();
        const media = row.querySelector<HTMLElement>(".home-race-media")?.getBoundingClientRect();
        const favorite = row.querySelector<HTMLElement>(".home-favorite")?.getBoundingClientRect();
        return (
          rowBox.left < 0 ||
          rowBox.right > viewportWidth ||
          media === undefined ||
          favorite === undefined ||
          media.left < rowBox.left ||
          media.right > rowBox.right ||
          favorite.left < rowBox.left ||
          favorite.right > rowBox.right
        );
      }).length,
    };
  });
  expect(integrity).toEqual({ overflow: false, replacement: false, invalidRows: 0 });
}

test("production logo integration proves privacy, lazy loading, and fallback", async ({ page }) => {
  // Given every accepted, absent, rejected, failed, and far-lazy logo state,
  const signals = observeErrors(page);
  const control = await routeLogoIntegration(page, true);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("./");
  const successRow = rowFor(page, integrationNames.success);
  const missingRow = rowFor(page, integrationNames.missing);
  const rejectedRow = rowFor(page, integrationNames.rejected);
  const failureRow = rowFor(page, integrationNames.failure);
  const farRow = rowFor(page, integrationNames.far);
  const namedRows = [successRow, missingRow, rejectedRow, failureRow, farRow];
  for (const row of namedRows) await expect(row).toHaveCount(1);
  const absentLogoRaces = logoIntegrationCollection.races.filter(
    ({ name }) => name === integrationNames.missing || name === integrationNames.rejected,
  );
  expect(absentLogoRaces.every((race) => !("logoUrl" in race))).toBe(true);

  const successImage = successRow.locator("img");
  const missingImage = missingRow.locator("img");
  const rejectedImage = rejectedRow.locator("img");
  const failureImage = failureRow.locator("img");
  const farImage = farRow.locator("img");
  for (const image of [successImage, missingImage, rejectedImage, failureImage, farImage])
    await expectImageContract(image);
  const beforeFailure = await mediaBox(failureRow);
  const farOffset = await farRow.evaluate((node) => node.getBoundingClientRect().top + scrollY);

  // When the held 404 resolves and the far row is approached,
  expect(farOffset).toBeGreaterThan(4000);
  expect(control.evidence.remoteRequests.filter(({ url }) => url === integrationLogos.far)).toEqual(
    [],
  );
  control.releaseFailure();
  await expectDecoded(successImage, "/success.png");
  await expectDecoded(missingImage, "/marathon/logo1.png");
  await expectDecoded(rejectedImage, "/marathon/logo1.png");
  await expectDecoded(failureImage, "/marathon/logo1.png");
  await farRow.scrollIntoViewIfNeeded();
  await expectDecoded(farImage, "/far.png");

  // Then privacy, one-shot fallback, routed transfers, and geometry remain exact.
  expect(control.evidence.blockedRequests).toEqual([]);
  expect(control.evidence.remoteRequests).toHaveLength(3);
  for (const request of control.evidence.remoteRequests)
    expect(request.headers.referer).toBeUndefined();
  for (const url of Object.values(integrationLogos))
    expect(control.evidence.remoteRequests.filter((request) => request.url === url)).toHaveLength(
      1,
    );
  await expect(failureImage).toHaveAttribute("data-logo-fallback", "true");
  await expect(missingImage).not.toHaveAttribute("data-logo-fallback", "true");
  await expect(rejectedImage).not.toHaveAttribute("data-logo-fallback", "true");
  expect(await mediaBox(failureRow)).toEqual(beforeFailure);
  const logo1Consumers = await page.locator('img[src$="/marathon/logo1.png"]').count();
  expect(logo1Consumers).toBeGreaterThan(1);
  expect(control.evidence.logo1Requests).toHaveLength(3);
  await expectResponsiveIntegrity(page);
  expect(signals.consoleErrors.filter((message) => message !== expected404)).toEqual([]);
  expect(signals.consoleErrors.filter((message) => message === expected404)).toHaveLength(1);
  expect(signals.pageErrors).toEqual([]);
  await writeFile(
    ".omo/evidence/task-10-race-event-logos.json",
    `${JSON.stringify(
      {
        task: 10,
        basePath: new URL(page.url()).pathname,
        farOffset,
        remoteRequests: control.evidence.remoteRequests,
        routedFallback: {
          cacheEvaluation: "disabled-by-playwright-routing",
          consumers: logo1Consumers,
          transfers: control.evidence.logo1Requests.length,
        },
        blockedRequests: control.evidence.blockedRequests,
        expectedDiagnostics: [expected404],
        unexpectedConsoleErrors: [],
        pageErrors: signals.pageErrors,
      },
      null,
      2,
    )}\n`,
  );
});

test("deny router blocks HTTP, HTTPS, and unexpected non-image escapes", async ({ page }) => {
  // Given the deny-by-default integration router,
  const control = await routeLogoIntegration(page);
  const escapedUrls = [
    "http://mixed-content.example/logo.png",
    "http://unexpected.example/data.json",
    "https://unexpected.example/data.json",
  ] as const;

  // When mixed-content, HTTP, and HTTPS non-image requests attempt to escape,
  await page.goto("./");
  await page.evaluate(async (urls) => {
    const image = new Image();
    const imageSettled = new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    });
    image.src = urls[0];
    document.body.append(image);
    await Promise.allSettled([fetch(urls[1]), fetch(urls[2]), imageSettled]);
  }, escapedUrls);

  // Then every escape is recorded and aborted without a live response.
  expect(control.evidence.blockedRequests.map(({ url }) => url).sort()).toEqual(
    [...escapedUrls].sort(),
  );
  expect(new Set(control.evidence.blockedRequests.map(({ resourceType }) => resourceType))).toEqual(
    new Set(["image", "fetch"]),
  );
});

test("unrouted local logo coalesces six simultaneous decoded consumers", async ({ browser }) => {
  // Given a fresh context with no Playwright routing,
  const base = new URL("./", test.info().project.use.baseURL);
  const logoUrl = new URL("logo1.png", base).href;

  // When six images request the same absolute local asset simultaneously,
  const evidence = await observeLocalLogoCoalescing(browser, logoUrl);

  // Then one real transfer and response decode every consumer.
  expect(evidence.consumers).toBe(6);
  expect(evidence.decodedWidths).toEqual(Array.from({ length: 6 }, () => 256));
  expect(evidence.requests).toBe(1);
  expect(evidence.responses).toBe(1);
  expect(evidence.resources.filter(({ transferSize }) => transferSize > 0)).toHaveLength(1);
});

test("production assets and homepage-calendar navigation retain the subpath", async ({ page }) => {
  // Given the built application under its deployment prefix,
  const control = await routeLogoIntegration(page);
  const base = new URL("./", test.info().project.use.baseURL);
  const logo1 = await page.request.get(new URL("logo1.png", base).href);
  const logo2 = await page.request.get(new URL("logo2.png", base).href);

  // When both public routes are navigated through their real links,
  await page.goto("./");
  await page.locator(".home-calendar-cta").click();
  await expect(page.locator(".calendar-page")).toBeVisible();
  await page.getByRole("link", { name: "메인으로 돌아가기" }).click();

  // Then assets stay deployed and navigation returns to the production homepage.
  expect(logo1.status()).toBe(200);
  expect(logo2.status()).toBe(200);
  await expect(page.locator(".home-page")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/marathon/");
  expect(control.evidence.blockedRequests).toEqual([]);
});

for (const colorScheme of colorSchemes) {
  for (const width of widths) {
    test(`responsive logo integration at ${width}px in ${colorScheme}`, async ({ page }) => {
      // Given a fresh production capture with every remote image intercepted,
      const capturePath = `.omo/evidence/task-10-${colorScheme}-${width}.png`;
      await rm(capturePath, { force: true });
      const signals = observeErrors(page);
      const control = await routeLogoIntegration(page);
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 820 });
      await page.goto("./");
      const farRow = rowFor(page, integrationNames.far);

      // When the far row is approached and every image settles,
      expect(
        await farRow.evaluate((node) => node.getBoundingClientRect().top + scrollY),
      ).toBeGreaterThan(4000);
      expect(control.evidence.remoteRequests.some(({ url }) => url === integrationLogos.far)).toBe(
        false,
      );
      await farRow.scrollIntoViewIfNeeded();
      await expectDecoded(farRow.locator("img"), "/far.png");
      await page.evaluate(() => scrollTo(0, 0));

      // Then all hard responsive and error gates pass before evidence is captured.
      for (const [name, expectedPath] of [
        [integrationNames.success, "/success.png"],
        [integrationNames.missing, "/marathon/logo1.png"],
        [integrationNames.rejected, "/marathon/logo1.png"],
        [integrationNames.failure, "/marathon/logo1.png"],
        [integrationNames.far, "/far.png"],
      ] as const) {
        const image = rowFor(page, name).locator("img");
        await expectImageContract(image);
        await expectDecoded(image, expectedPath);
      }
      expect(control.evidence.blockedRequests).toEqual([]);
      for (const request of control.evidence.remoteRequests)
        expect(request.headers.referer).toBeUndefined();
      expect(control.evidence.remoteRequests).toHaveLength(3);
      await expectResponsiveIntegrity(page);
      expect(signals.consoleErrors.filter((message) => message !== expected404)).toEqual([]);
      expect(signals.consoleErrors.filter((message) => message === expected404)).toHaveLength(1);
      expect(signals.pageErrors).toEqual([]);
      await page.screenshot({ path: capturePath, fullPage: true });
    });
  }
}
