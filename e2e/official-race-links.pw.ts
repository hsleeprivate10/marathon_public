import { type Page, expect, test } from "@playwright/test";
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

async function assertOfficialAnchor(
  page: Page,
  route: (typeof raceLinkRoutes)[number],
  name: string,
  officialSiteUrl: string,
  applicationUrl?: string,
): Promise<void> {
  const race = page.getByRole("link", { name: new RegExp(name, "u") });
  await expect(race).toBeVisible();
  await expect(race).toHaveClass(new RegExp(`\\b${route.className}\\b`, "u"));
  await expect(race).toHaveAttribute("href", officialSiteUrl);
  await expect(race).toHaveAttribute("target", "_blank");
  await expect(race).toHaveAttribute("rel", "noopener noreferrer");
  if (applicationUrl !== undefined) await expect(race).not.toHaveAttribute("href", applicationUrl);
}

async function assertStaticRaceText(
  page: Page,
  route: (typeof raceLinkRoutes)[number],
  name: string,
): Promise<void> {
  await expect(page.locator(route.anchorSelector, { hasText: name })).toHaveCount(0);
  const race = page.locator(route.textSelector, { hasText: name });
  await expect(race).toBeVisible();
  await expect(race).toHaveJSProperty("tabIndex", -1);
  await expect(race).not.toHaveAttribute("role", "link");
  const before = await race.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      cursor: style.cursor,
      textDecorationLine: style.textDecorationLine,
      transform: style.transform,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
    };
  });
  await race.hover();
  const after = await race.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      cursor: style.cursor,
      textDecorationLine: style.textDecorationLine,
      transform: style.transform,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
    };
  });
  expect(before.cursor).not.toBe("pointer");
  expect(after).toEqual(before);
}

async function assertExactOfficialState(
  page: Page,
  route: (typeof raceLinkRoutes)[number],
  name: string,
  officialSiteUrl: string,
): Promise<void> {
  const race = page.locator(route.anchorSelector, { hasText: name });
  await expect(race).toHaveCount(1);
  await expect(race).toHaveAttribute("href", officialSiteUrl);
  const before = await race.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      text: node.textContent,
      href: node instanceof HTMLAnchorElement ? node.href : null,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      style: { backgroundColor: style.backgroundColor, transform: style.transform },
    };
  });
  await race.hover();
  const hover = await race.evaluate((node) => {
    const style = getComputedStyle(node);
    return { backgroundColor: style.backgroundColor, transform: style.transform };
  });
  await race.focus();
  const focus = await race.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineStyle: style.outlineStyle, outlineColor: style.outlineColor };
  });
  expect(before.text).toContain(name);
  expect(before.href).toBe(officialSiteUrl);
  expect(hover).not.toEqual(before.style);
  expect(focus.outlineStyle).not.toBe("none");
}

async function assertVisiblePendingAction(page: Page, name: string): Promise<void> {
  const action = page
    .locator("span.home-race-link", { hasText: name })
    .locator(".home-race-action");
  await expect(action).toHaveText("공식 홈페이지 확인 중");
  const visibility = await action.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    text: node.textContent,
  }));
  expect(visibility.text).toBe("공식 홈페이지 확인 중");
  expect(visibility.clientWidth).toBeGreaterThanOrEqual(visibility.scrollWidth);
}

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
    if (route.name === "home") await expect(race).toHaveAccessibleName(/공식 홈페이지/u);
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

  test(`${route.name} multi-hop races link only to verified final official pages`, async ({
    page,
  }) => {
    // Given fixture races with application/source evidence and verified final official pages.
    const signals = observeErrors(page);
    await routeCollection(page);
    await fixFixtureClock(page);

    // When the route renders official-page-first rows.
    await page.goto(route.path);

    // Then only the final official pages are public anchors.
    await assertOfficialAnchor(
      page,
      route,
      officialRaceLinkFixture.marathonGoName,
      officialRaceLinkFixture.marathonGoOfficialSiteUrl,
      officialRaceLinkFixture.marathonGoApplicationUrl,
    );
    await assertOfficialAnchor(
      page,
      route,
      officialRaceLinkFixture.httpOfficialName,
      officialRaceLinkFixture.httpOfficialSiteUrl,
    );
    await assertExactOfficialState(
      page,
      route,
      officialRaceLinkFixture.marathonGoName,
      officialRaceLinkFixture.marathonGoOfficialSiteUrl,
    );
    await assertExactOfficialState(
      page,
      route,
      officialRaceLinkFixture.httpOfficialName,
      officialRaceLinkFixture.httpOfficialSiteUrl,
    );
    expect(signals.consoleErrors).toEqual([]);
    expect(signals.pageErrors).toEqual([]);
  });

  test(`${route.name} source and application-only pending rows remain static`, async ({ page }) => {
    // Given pending fixture rows with no verified official site URL.
    const signals = observeErrors(page);
    await routeCollection(page);
    await fixFixtureClock(page);

    // When the route renders pending rows.
    await page.goto(route.path);

    // Then they expose readable text without link, tab, pointer, or hover affordances.
    await assertStaticRaceText(page, route, officialRaceLinkFixture.sourceOnlyName);
    await assertStaticRaceText(page, route, officialRaceLinkFixture.applicationOnlyName);
    expect(signals.consoleErrors).toEqual([]);
    expect(signals.pageErrors).toEqual([]);
  });
}

test("home pending rows show the full non-clickable action label at 375px", async ({ page }) => {
  // Given pending rows rendered at the narrow supported homepage viewport.
  await page.setViewportSize({ width: 375, height: 812 });
  await routeCollection(page);
  await fixFixtureClock(page);

  // When the homepage renders source/application-only races.
  await page.goto("./");

  // Then the action label is visibly the full pending label, not a clipped official-link label.
  await assertVisiblePendingAction(page, officialRaceLinkFixture.sourceOnlyName);
  await assertVisiblePendingAction(page, officialRaceLinkFixture.applicationOnlyName);
});
