import { expect, test } from "@playwright/test";
import {
  emptyCollection,
  fixFixtureClock,
  fixtureShape,
  routeCollection,
} from "./fixtures/collection.js";
import { routeWeather } from "./fixtures/weather.js";
import { observeErrors, optionValues, sectionMonths } from "./helpers/browser.js";

const viewports = [375, 768, 1280] as const;

for (const width of viewports) {
  test(`year and month selectors filter the complete list at ${width}px`, async ({ page }) => {
    // Given the production homepage at a supported viewport,
    const signals = observeErrors(page);
    await routeCollection(page);
    await fixFixtureClock(page);
    await page.setViewportSize({ width, height: 720 });
    await page.goto("./");
    const sections = page.locator("section.home-month");
    await expect(sections.first()).toBeVisible();
    const { allMonths, allYears, allMonthNumbers } = fixtureShape;
    const yearSelect = page.getByLabel("대회 연도 선택");
    const monthSelect = page.getByLabel("대회 월 선택");

    // When the initial selector state is inspected,
    // Then both labelled selects truthfully expose all available years and months.
    await expect.soft(yearSelect).toBeVisible();
    await expect.soft(monthSelect).toBeVisible();
    await expect.poll(() => optionValues(yearSelect)).toEqual(["", ...allYears]);
    await expect(yearSelect.locator("option").first()).toHaveText("전체 연도");
    await expect.poll(() => optionValues(monthSelect)).toEqual(["", ...allMonthNumbers]);
    await expect(monthSelect.locator("option").first()).toHaveText("전체 월");
    await expect(sections.filter({ visible: true })).toHaveCount(allMonths.length);

    const { secondYear, secondYearMonths } = fixtureShape;
    const secondYearMonthNumbers = secondYearMonths.map((month) => month.slice(5, 7));

    // When a specific year is selected,
    await yearSelect.selectOption(secondYear);

    // Then only that year's sections show, its month options replace the global options,
    // all sections remain in the DOM, and focus moves to the first result heading.
    await expect(monthSelect).toHaveValue("");
    await expect.poll(() => optionValues(monthSelect)).toEqual(["", ...secondYearMonthNumbers]);
    await expect
      .poll(() => sectionMonths(sections.filter({ visible: true })))
      .toEqual(secondYearMonths);
    await expect(page.locator(`#home-month-${secondYearMonths[0]}`)).toBeFocused();
    await expect(sections).toHaveCount(allMonths.length);

    const selectedMonth = fixtureShape.sharedMonth;
    const selectedYearMonth = `${secondYear}-${selectedMonth}`;

    // When a month is selected within that year,
    await monthSelect.selectOption(selectedMonth);

    // Then exactly that year-month remains visible and receives heading focus.
    await expect
      .poll(() => sectionMonths(sections.filter({ visible: true })))
      .toEqual([selectedYearMonth]);
    await expect(page.locator(`#home-month-${selectedYearMonth}`)).toBeFocused();

    const { firstYear, firstYearMonths } = fixtureShape;

    // When the year changes while a month is selected,
    await yearSelect.selectOption(firstYear);

    // Then month resets to all and the complete selected year is restored.
    await expect(monthSelect).toHaveValue("");
    await expect
      .poll(() => sectionMonths(sections.filter({ visible: true })))
      .toEqual(firstYearMonths);
    await expect(page.locator(`#home-month-${firstYearMonths[0]}`)).toBeFocused();

    const { sharedMonth } = fixtureShape;
    const sharedMonthSections = allMonths.filter((month) => month.endsWith(`-${sharedMonth}`));

    // When year returns to all and a shared month is selected,
    await yearSelect.selectOption("");
    await monthSelect.selectOption(sharedMonth);

    // Then matching months across years are visible and the first result receives focus.
    await expect(yearSelect).toHaveValue("");
    await expect.poll(() => optionValues(monthSelect)).toEqual(["", ...allMonthNumbers]);
    await expect
      .poll(() => sectionMonths(sections.filter({ visible: true })))
      .toEqual(sharedMonthSections);
    await expect(page.locator(`#home-month-${sharedMonthSections[0]}`)).toBeFocused();
    await expect(sections.filter({ visible: true }).nth(1)).toHaveCSS("margin-top", "40px");

    // When the month returns to all,
    await monthSelect.selectOption("");

    // Then every retained section is visible and the page remains stable.
    await expect.poll(() => sectionMonths(sections.filter({ visible: true }))).toEqual(allMonths);
    await expect(sections).toHaveCount(allMonths.length);
    const freshness = page.getByText(/^데이터 갱신 /);
    const controls = page.locator(".home-race-selector-controls");
    await expect(freshness).toBeVisible();
    const freshnessBox = await freshness.boundingBox();
    const controlsBox = await controls.boundingBox();
    if (freshnessBox === null || controlsBox === null)
      throw new Error("Selector tools must render");
    expect(freshnessBox.y).toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    expect(signals.consoleErrors).toEqual([]);
    expect(signals.pageErrors).toEqual([]);
    await controls.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.omo/evidence/year-month-filter-${width}.png`,
      fullPage: false,
    });
  });
}

test("empty race data exposes honest disabled year and month selectors", async ({ page }) => {
  // Given a valid collection response containing no races,
  await routeCollection(page, emptyCollection);
  await fixFixtureClock(page);

  // When the production homepage loads,
  await page.goto("./");

  // Then both selectors truthfully report that no choices are available.
  const yearSelect = page.getByLabel("대회 연도 선택");
  const monthSelect = page.getByLabel("대회 월 선택");
  await expect(yearSelect).toBeDisabled();
  await expect(yearSelect.locator("option")).toHaveText("선택할 대회 연도가 없습니다");
  await expect(monthSelect).toBeDisabled();
  await expect(monthSelect.locator("option")).toHaveText("선택할 대회 월이 없습니다");
  await expect(page.locator("section.home-month")).toHaveCount(0);
});

test("mobile race text has no single-character CJK final lines", async ({ page }) => {
  // Given every homepage race row rendered at the narrow supported viewport,
  await page.setViewportSize({ width: 375, height: 720 });
  await routeCollection(page);
  await fixFixtureClock(page);
  await page.goto("./");
  const fields = page.locator(".home-race-name, .home-race-metadata > span");
  await expect(fields.first()).toBeVisible();

  // When each field's characters are grouped by their rendered client-rect line,
  const orphanedFields = await fields.evaluateAll((elements) => {
    const cjkCharacter = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const orphans: string[] = [];
    for (const element of elements) {
      const textNode = element.firstChild;
      if (!(textNode instanceof Text)) throw new Error("Race text field must contain direct text");
      const lines = new Map<number, string[]>();
      for (let index = 0; index < textNode.data.length; index += 1) {
        const character = textNode.data[index];
        if (character === undefined || /^\s$/u.test(character)) continue;
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const rect = range.getClientRects().item(0);
        if (rect === null) continue;
        const lineTop = Math.round(rect.top * 2) / 2;
        const line = lines.get(lineTop) ?? [];
        line.push(character);
        lines.set(lineTop, line);
      }
      const lastLine = [...lines.entries()].sort(([a], [b]) => a - b).at(-1);
      if (lastLine === undefined) continue;
      const lastLineText = lastLine[1].join("");
      if (lastLineText.length === 1 && cjkCharacter.test(lastLineText))
        orphans.push(element.textContent ?? "");
    }
    return orphans;
  });

  // Then no race name or metadata field ends with one orphaned CJK character.
  expect(orphanedFields).toEqual([]);
});

test("project-scoped deployment loads local Korean fonts and favicon", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await routeWeather(page);
  await page.goto("./", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const deployment = await page.evaluate(async () => {
    const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
    const icon = document.querySelector("link[rel='icon']");
    return {
      family: getComputedStyle(document.body).fontFamily,
      loaded400: document.fonts.check('400 16px "Noto Sans KR"', "마라톤 일정"),
      loaded700: document.fonts.check('700 16px "Noto Sans KR"', "마라톤 일정"),
      fontResources: resources.filter((url) => url.includes("/marathon/fonts/noto-sans-kr")),
      stylesheet: resources.find((url) => url.endsWith("/marathon/fonts/fonts.css")),
      faviconStatus: icon instanceof HTMLLinkElement ? (await fetch(icon.href)).status : null,
    };
  });

  expect(deployment.family.startsWith('"Noto Sans KR"')).toBe(true);
  expect(deployment.loaded400).toBe(true);
  expect(deployment.loaded700).toBe(true);
  expect(deployment.fontResources).toHaveLength(2);
  expect(deployment.stylesheet).toBe("http://127.0.0.1:4177/marathon/fonts/fonts.css");
  expect(deployment.faviconStatus).toBe(200);
  expect(pageErrors).toEqual([]);
});

test("public races data loads without assuming calendar shape", async ({ page }) => {
  // Given the unmodified deployed races artifact,
  const signals = observeErrors(page);
  await routeWeather(page);

  // When the production homepage loads without an E2E data route,
  await page.goto("./");

  // Then the public-data boundary renders without requiring any particular year or month.
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.getByLabel("대회 연도 선택")).toBeVisible();
  await expect(page.getByLabel("대회 월 선택")).toBeVisible();
  await expect(page.getByText(/^데이터 갱신 /)).toBeVisible();
  expect(signals.consoleErrors).toEqual([]);
  expect(signals.pageErrors).toEqual([]);
});
