import { expect, test } from "@playwright/test";
import { fixFixtureClock, routeCollection } from "./fixtures/collection.js";
import { observeErrors } from "./helpers/browser.js";
import { computedContrast } from "./helpers/contrast.js";

const widths = [375, 768, 1280] as const;

for (const width of widths) {
  for (const route of ["", "#/calendar"] as const) {
    test(`shared dark surfaces remain readable on ${route || "home"} at ${width}px`, async ({
      page,
    }) => {
      // Given deterministic data and the production page in dark mode,
      const signals = observeErrors(page);
      await routeCollection(page);
      await fixFixtureClock(page);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width, height: 820 });
      await page.goto(`./${route}`);
      const pageSelector = route === "" ? ".home-page" : ".calendar-page";
      await expect(page.locator(pageSelector)).toBeVisible();

      // When shared dark tokens and representative surfaces are inspected,
      const tokens = await page.locator(pageSelector).evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          canvas: style.getPropertyValue("--homepage-canvas").trim(),
          surface: style.getPropertyValue("--filter-surface").trim(),
          elevated: style.getPropertyValue("--surface-elevated").trim(),
          text: style.getPropertyValue("--filter-text").trim(),
          border: style.getPropertyValue("--row-border").trim(),
          thumbnail: style.getPropertyValue("--thumbnail-sky").trim(),
          shadow: style.getPropertyValue("--row-shadow").trim(),
          heroAccent: style.getPropertyValue("--hero-accent").trim(),
        };
      });

      // Then exact documented dark tokens render with WCAG AA contrast and stable layout.
      expect({
        canvas: tokens.canvas,
        surface: tokens.surface,
        elevated: tokens.elevated,
        text: tokens.text,
        border: tokens.border,
        thumbnail: tokens.thumbnail,
        heroAccent: tokens.heroAccent,
      }).toEqual({
        canvas: "#101b27",
        surface: "#182838",
        elevated: "#182838",
        text: "#e6edf3",
        border: "#38506a",
        thumbnail: "#29485f",
        heroAccent: "#ffb08a",
      });
      expect(tokens.shadow).toMatch(/^0 12px 28px rgba\(0, 0, 0, (?:0)?\.32\)$/u);
      if (route === "") {
        expect(
          await computedContrast(page, ".home-race-link", ".home-race-row"),
        ).toBeGreaterThanOrEqual(4.5);
      } else {
        expect(
          await computedContrast(page, ".calendar-page", ".calendar-page"),
        ).toBeGreaterThanOrEqual(4.5);
        expect(await computedContrast(page, ".race", ".race")).toBeGreaterThanOrEqual(4.5);
        expect(
          await computedContrast(page, "#region-filter", "#region-filter"),
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      ).toBe(false);
      expect(signals.consoleErrors).toEqual([]);
      expect(signals.pageErrors).toEqual([]);
      await page.screenshot({
        path: `.omo/evidence/dark-${route === "" ? "home" : "calendar"}-${width}.png`,
        fullPage: true,
      });
    });
  }
}
