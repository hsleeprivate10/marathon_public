import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { logoFixture, routeLogoFixture, routeMalformedLogoFixture } from "./fixtures/race-logos.js";
import { observeErrors } from "./helpers/browser.js";

const viewports = [375, 768, 1280] as const;
const colorSchemes = ["light", "dark"] as const;
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

for (const colorScheme of colorSchemes) {
  for (const width of viewports) {
    test(`monthly race logos preserve row behavior at ${width}px in ${colorScheme} mode`, async ({
      page,
    }) => {
      // Given remote-success, absent, and remote-404 races on the production homepage,
      const signals = observeErrors(page);
      const requests = await routeLogoFixture(page);
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 820 });
      await page.goto("./");
      const rows = page.locator(".home-race-row");
      await expect(rows).toHaveCount(3);
      await rows.first().scrollIntoViewIfNeeded();

      // When all three row media states settle,
      const images = rows.locator(".home-race-media > img");
      await expect(images).toHaveCount(3);
      await expect
        .poll(() =>
          images.evaluateAll((nodes) =>
            nodes.map((node) => node instanceof HTMLImageElement && node.complete),
          ),
        )
        .toEqual([true, true, true]);

      // Then each slot has one decorative, low-priority, intrinsic-size image with stable 4:3 geometry.
      for (const [name, officialSiteUrl] of [
        [logoFixture.successName, logoFixture.officialSiteUrls[0]],
        [logoFixture.missingName, logoFixture.officialSiteUrls[1]],
        [logoFixture.failureName, logoFixture.officialSiteUrls[2]],
      ] as const) {
        const row = rows.filter({ hasText: name });
        const image = row.locator(".home-race-media > img");
        await expect(image).toHaveCount(1);
        for (const [attribute, value] of Object.entries(imageAttributes))
          await expect(image).toHaveAttribute(attribute, value);
        await expect(row.locator("time.home-race-date")).toBeVisible();
        await expect(row.locator(".home-race-details")).toContainText(name);
        await expect(row.locator(":scope > .home-favorite")).toBeDisabled();
        await expect(row.locator(".home-race-link .home-favorite")).toHaveCount(0);
        await expect(row.locator(".home-race-link")).toHaveAttribute("href", officialSiteUrl);
      }

      const successImage = rows
        .filter({ hasText: logoFixture.successName })
        .locator(".home-race-media > img");
      const missingImage = rows
        .filter({ hasText: logoFixture.missingName })
        .locator(".home-race-media > img");
      const failureImage = rows
        .filter({ hasText: logoFixture.failureName })
        .locator(".home-race-media > img");
      await expect(successImage).toHaveAttribute("src", logoFixture.remoteLogoUrl);
      await expect(missingImage).toHaveAttribute("src", /\/marathon\/logo1\.png$/u);
      await expect(failureImage).toHaveAttribute("src", /\/marathon\/logo1\.png$/u);
      await expect(failureImage).toHaveAttribute("data-logo-fallback", "true");
      await expect(successImage).not.toHaveAttribute("data-logo-fallback", "true");
      await expect(missingImage).not.toHaveAttribute("data-logo-fallback", "true");
      expect(
        await failureImage.evaluate(
          (node) => node instanceof HTMLImageElement && node.onerror === null,
        ),
      ).toBe(true);
      expect(
        await missingImage.evaluate(
          (node) => node instanceof HTMLImageElement && node.onerror === null,
        ),
      ).toBe(true);

      const geometry = await rows.locator(".home-race-media").evaluateAll((media) =>
        media.map((node) => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const image = node.querySelector("img");
          if (!(image instanceof HTMLImageElement)) {
            return {
              imagePresent: false,
              mediaLeft: box.left,
              mediaTop: box.top,
              mediaWidth: box.width,
              mediaHeight: box.height,
              mediaRatio: box.width / box.height,
              mediaBackground: style.backgroundColor,
              imageLeft: 0,
              imageTop: 0,
              imageWidth: 0,
              imageHeight: 0,
              imageRatio: 0,
              imageBackground: "missing",
              imageFit: "missing",
              naturalRatio: 0,
            };
          }
          const imageBox = image.getBoundingClientRect();
          const imageStyle = getComputedStyle(image);
          return {
            imagePresent: true,
            mediaLeft: box.left,
            mediaTop: box.top,
            mediaWidth: box.width,
            mediaHeight: box.height,
            mediaRatio: box.width / box.height,
            mediaBackground: style.backgroundColor,
            imageLeft: imageBox.left,
            imageTop: imageBox.top,
            imageWidth: imageBox.width,
            imageHeight: imageBox.height,
            imageRatio: imageBox.width / imageBox.height,
            imageBackground: imageStyle.backgroundColor,
            imageFit: imageStyle.objectFit,
            naturalRatio: image.naturalWidth / image.naturalHeight,
          };
        }),
      );
      expect(geometry.every((box) => box.imagePresent)).toBe(true);
      expect(geometry.every((box) => Math.abs(box.mediaRatio - 4 / 3) < 0.01)).toBe(true);
      expect(new Set(geometry.map((box) => `${box.mediaWidth}:${box.mediaHeight}`)).size).toBe(1);
      expect(geometry.every((box) => box.mediaBackground === "rgba(0, 0, 0, 0)")).toBe(true);
      expect(geometry.every((box) => box.imageBackground === "rgb(255, 255, 255)")).toBe(true);
      expect(geometry.every((box) => box.imageFit === "contain")).toBe(true);
      expect(
        geometry.every(
          (box) =>
            box.imageLeft >= box.mediaLeft - 1 &&
            box.imageTop >= box.mediaTop - 1 &&
            box.imageLeft + box.imageWidth <= box.mediaLeft + box.mediaWidth + 1 &&
            box.imageTop + box.imageHeight <= box.mediaTop + box.mediaHeight + 1,
        ),
      ).toBe(true);
      expect(
        geometry.every(
          (box) =>
            Math.abs(box.imageLeft + box.imageWidth / 2 - (box.mediaLeft + box.mediaWidth / 2)) <
              1 &&
            Math.abs(box.imageTop + box.imageHeight / 2 - (box.mediaTop + box.mediaHeight / 2)) < 1,
        ),
      ).toBe(true);
      expect(geometry.every((box) => Math.abs(box.imageRatio - box.naturalRatio) < 0.01)).toBe(
        true,
      );
      expect(requests.successHeaders).toHaveLength(1);
      expect(requests.failureHeaders).toHaveLength(1);
      expect(requests.successHeaders[0]?.referer).toBeUndefined();
      expect(requests.failureHeaders[0]?.referer).toBeUndefined();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      const expectedNetworkError =
        "Failed to load resource: the server responded with a status of 404 (Not Found)";
      expect(signals.consoleErrors.filter((message) => message !== expectedNetworkError)).toEqual(
        [],
      );
      expect(
        signals.consoleErrors.filter((message) => message === expectedNetworkError),
      ).toHaveLength(1);
      expect(signals.pageErrors).toEqual([]);

      await page.screenshot({
        path: `.omo/evidence/task-8-home-race-logos-${colorScheme}-${width}.png`,
        fullPage: true,
      });
      if (width === 1280 && colorScheme === "light")
        writeFileSync(
          ".omo/evidence/task-8-logo-request-headers.json",
          `${JSON.stringify(requests, null, 2)}\n`,
        );
    });
  }
}

test("malformed logo data fails at the collection boundary", async ({ page }) => {
  // Given a production response containing a schema-invalid logo URL,
  const signals = observeErrors(page);
  await routeMalformedLogoFixture(page);

  // When the homepage loads that untrusted collection,
  await page.goto("./");

  // Then the existing data error surface renders without exposing unsafe row media.
  await expect(page.locator(".data-error-page")).toBeVisible();
  await expect(page.locator(".home-race-media")).toHaveCount(0);
  expect(signals.pageErrors).toEqual([]);
});
