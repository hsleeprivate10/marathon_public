import { expect, test } from "@playwright/test";
import {
  aggregatorOnlyCollection,
  fixFixtureClock,
  officialRaceLinkFixture,
  routeCollection,
} from "./fixtures/collection.js";
import { observeErrors } from "./helpers/browser.js";

const raceLinkRoutes = [
  {
    name: "home",
    path: "./",
    className: "home-race-link",
    anchorSelector: "a.home-race-link",
    textSelector: "span.home-race-link",
  },
  {
    name: "calendar",
    path: "./#/calendar",
    className: "race",
    anchorSelector: "a.race",
    textSelector: "span.race",
  },
] as const;

for (const route of raceLinkRoutes) {
  test(`${route.name} race anchors prefer official sites over application pages`, async ({
    page,
  }) => {
    // Given normal fixture races with distinct official and application URLs,
    const signals = observeErrors(page);
    await routeCollection(page);
    await fixFixtureClock(page);

    // When the route renders the current-month race,
    await page.goto(route.path);

    // Then its visible race link crosses only the official-site href boundary.
    const race = page.getByRole("link", { name: /현재 달 서울 마라톤/u });
    await expect(race).toBeVisible();
    await expect(race).toHaveClass(new RegExp(`\\b${route.className}\\b`, "u"));
    await expect(race).toHaveAttribute("href", officialRaceLinkFixture.normalOfficialSiteUrl);
    await expect(race).not.toHaveAttribute("href", officialRaceLinkFixture.normalApplicationUrl);
    expect(signals.consoleErrors).toEqual([]);
    expect(signals.pageErrors).toEqual([]);
  });

  test(`${route.name} aggregator-only races stay visible without anchors`, async ({ page }) => {
    // Given a valid GoRunning race record that has an application URL but no official site URL,
    const signals = observeErrors(page);
    await routeCollection(page, aggregatorOnlyCollection);
    await fixFixtureClock(page);

    // When the route renders that race,
    await page.goto(route.path);

    // Then no application URL anchor is exposed and the race stays visible as text.
    await expect(
      page.locator(route.anchorSelector, { hasText: officialRaceLinkFixture.aggregatorName }),
    ).toHaveCount(0);
    const race = page.locator(route.textSelector, {
      hasText: officialRaceLinkFixture.aggregatorName,
    });
    await expect(race).toBeVisible();
    await expect(race).toContainText(officialRaceLinkFixture.aggregatorName);
    expect(signals.consoleErrors).toEqual([]);
    expect(signals.pageErrors).toEqual([]);
  });
}
