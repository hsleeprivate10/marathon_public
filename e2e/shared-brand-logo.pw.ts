import { rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { fixFixtureClock, routeCollection } from "./fixtures/collection.js";

const routes = [
  {
    name: "home",
    path: "./",
    brand: ".home-brand",
    header: ".home-header-inner",
    skipLink: ".home-skip-link",
    neighbors: [".home-menu-toggle", ".home-header-menu", ".home-weather", ".home-calendar-cta"],
  },
  {
    name: "calendar",
    path: "./#/calendar",
    brand: ".calendar-brand",
    header: ".calendar-header-inner",
    skipLink: ".skip-link",
    neighbors: [".calendar-home-link"],
  },
] as const;

const widths = [375, 768, 1280] as const;
const colorSchemes = ["light", "dark"] as const;
const logoPath = "/marathon/logo2.png";

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

async function requiredBox(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${label} has no rendered box`);
  return box;
}

function expectInsideViewport(
  box: Box,
  viewport: { readonly width: number; readonly height: number },
  label: string,
): void {
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height);
}

function expectSeparate(left: Box, right: Box, label: string): void {
  const overlaps =
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
  expect(overlaps, label).toBe(false);
}

async function visibleBoxes(locator: Locator): Promise<readonly Box[]> {
  return locator.evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display === "none" ||
        style.visibility === "hidden" ||
        box.width === 0 ||
        box.height === 0
        ? []
        : [{ x: box.x, y: box.y, width: box.width, height: box.height }];
    }),
  );
}

for (const route of routes) {
  for (const width of widths) {
    for (const colorScheme of colorSchemes) {
      test(`shared brand contract on ${route.name} at ${width}px in ${colorScheme}`, async ({
        page,
      }) => {
        // Given one fresh production presentation with stale evidence removed,
        const restPath = `.omo/evidence/task-9-brand-${route.name}-${width}-${colorScheme}.png`;
        const focusPath = `.omo/evidence/task-9-brand-${route.name}-focus-${colorScheme}.png`;
        const menuPath = `.omo/evidence/task-9-brand-home-menu-open-${colorScheme}.png`;
        await rm(restPath, { force: true });
        if (width === 1280) await rm(focusPath, { force: true });
        if (route.name === "home" && width === 375) await rm(menuPath, { force: true });
        await routeCollection(page);
        await fixFixtureClock(page);
        if (process.env.TASK9_BROKEN_LOGO === "1") {
          await page.route(`**${logoPath}`, async (request) => {
            await request.fulfill({ status: 404, contentType: "image/png", body: "missing" });
          });
        }
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width, height: 900 });
        const responsePromise = page.waitForResponse(
          (response) => new URL(response.url()).pathname === logoPath,
        );
        await page.goto(route.path);
        const response = await responsePromise;
        const brand = page.locator(route.brand);
        const image = brand.locator("img");
        const heroImage = page.locator(".home-hero-visual > img.home-hero-art");

        // When the complete shared-brand contract is inspected,
        // Then every DOM, asset, accessibility, focus, and geometry invariant holds.
        await expect(brand).toHaveCount(1);
        await expect(image).toHaveCount(1);
        if (route.name === "home") {
          await expect(heroImage).toHaveCount(1);
          await expect(heroImage).toHaveAttribute("src", /\/marathon\/logo2\.png$/u);
          await expect(heroImage).toHaveAttribute("alt", "");
          await expect(heroImage).toHaveAttribute("aria-hidden", "true");
        }
        await expect(brand).toHaveAttribute("href", "#");
        await expect(brand).toHaveAttribute("aria-label", "마라톤 캘린더 홈");
        const branding = await brand.evaluate((anchor) => {
          const logo = anchor.querySelector("img");
          if (!(logo instanceof HTMLImageElement)) throw new Error("Brand logo image is missing");
          return {
            anchorIsFirst: anchor.parentElement?.firstElementChild === anchor,
            imageIsFirst: anchor.firstElementChild === logo,
            text: anchor.textContent?.trim() ?? "",
            pseudoContent: getComputedStyle(anchor, "::before").content,
            srcPath: new URL(logo.currentSrc).pathname,
            alt: logo.alt,
            ariaHidden: logo.getAttribute("aria-hidden"),
            intrinsicWidth: logo.getAttribute("width"),
            intrinsicHeight: logo.getAttribute("height"),
            naturalWidth: logo.naturalWidth,
            naturalHeight: logo.naturalHeight,
            objectFit: getComputedStyle(logo).objectFit,
          };
        });
        expect({ ...branding, status: response.status() }).toEqual({
          anchorIsFirst: true,
          imageIsFirst: true,
          text: "",
          pseudoContent: "none",
          srcPath: logoPath,
          alt: "",
          ariaHidden: "true",
          intrinsicWidth: "237",
          intrinsicHeight: "256",
          naturalWidth: 237,
          naturalHeight: 256,
          objectFit: "contain",
          status: 200,
        });

        const viewport = page.viewportSize();
        if (viewport === null) throw new Error("Viewport size is unavailable");
        const brandBox = await requiredBox(brand, `${route.name} brand`);
        const imageBox = await requiredBox(image, `${route.name} logo`);
        const headerBox = await requiredBox(page.locator(route.header), `${route.name} header`);
        expect(brandBox.width).toBeGreaterThanOrEqual(44);
        expect(brandBox.height).toBeGreaterThanOrEqual(44);
        expect(imageBox.width / imageBox.height).toBeCloseTo(237 / 256, 4);
        expect(imageBox.x).toBeGreaterThanOrEqual(brandBox.x);
        expect(imageBox.y).toBeGreaterThanOrEqual(brandBox.y);
        expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(brandBox.x + brandBox.width);
        expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(brandBox.y + brandBox.height);
        expectInsideViewport(headerBox, viewport, `${route.name} header`);
        expectInsideViewport(brandBox, viewport, `${route.name} brand`);
        expectInsideViewport(imageBox, viewport, `${route.name} logo`);

        for (const selector of route.neighbors) {
          for (const box of await visibleBoxes(page.locator(selector))) {
            expectInsideViewport(box, viewport, `${route.name} ${selector}`);
            expectSeparate(brandBox, box, `${route.name} brand overlaps ${selector}`);
          }
        }

        if (route.name === "home" && width === 375) {
          const toggle = page.locator(".home-menu-toggle");
          await toggle.click();
          await expect(toggle).toHaveAttribute("aria-expanded", "true");
          await expect(page.locator(".home-header-menu")).toBeVisible();
          for (const selector of [
            ".home-menu-toggle",
            ".home-header-menu",
            ".home-nav",
            ".home-header-search",
            ".home-header-search-input",
          ]) {
            for (const box of await visibleBoxes(page.locator(selector))) {
              expectInsideViewport(box, viewport, `open menu ${selector}`);
              expectSeparate(brandBox, box, `home brand overlaps open menu ${selector}`);
            }
          }
          await page.keyboard.press("Escape");
          await expect(toggle).toBeFocused();
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
        }

        await page.locator(route.skipLink).focus();
        await page.keyboard.press("Tab");
        await expect(brand).toBeFocused();
        const focusBox = await requiredBox(brand, `${route.name} focused brand`);
        expect(focusBox.width).toBeGreaterThanOrEqual(44);
        expect(focusBox.height).toBeGreaterThanOrEqual(44);
        expectInsideViewport(focusBox, viewport, `${route.name} focused brand`);
        expect(await brand.evaluate((anchor) => getComputedStyle(anchor).outlineStyle)).not.toBe(
          "none",
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );

        if (route.name === "home" && width === 375) {
          await page.locator(".home-menu-toggle").click();
          await page.screenshot({ path: menuPath, fullPage: true });
          await page.keyboard.press("Escape");
        }
        if (width === 1280) {
          await brand.focus();
          await page.locator(route.header).screenshot({ path: focusPath });
        }
        await brand.evaluate((anchor) => anchor.blur());
        await page.screenshot({ path: restPath, fullPage: true });
      });
    }
  }
}

test("detects an intercepted broken logo2 response", async ({ page }) => {
  // Given the implemented logo is replaced by a deterministic 404,
  await routeCollection(page);
  await page.goto("./");
  const image = page.locator(".home-brand img");
  await expect(image).toHaveCount(1);
  await page.route(`**${logoPath}`, async (request) => {
    await request.fulfill({ status: 404, contentType: "image/png", body: "missing" });
  });
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === logoPath,
  );
  await page.reload();

  // When decoding completes, Then both the HTTP and natural-size failure remain observable.
  expect((await responsePromise).status()).toBe(404);
  await expect
    .poll(() =>
      image.evaluate((logo) =>
        logo instanceof HTMLImageElement
          ? { complete: logo.complete, width: logo.naturalWidth, height: logo.naturalHeight }
          : null,
      ),
    )
    .toEqual({ complete: true, width: 0, height: 0 });
});
