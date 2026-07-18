import { expect, test } from "@playwright/test";
import { fixFixtureClock, fixtureShape, routeCollection } from "./fixtures/collection.js";
import { observeErrors } from "./helpers/browser.js";

const viewports = [375, 768, 1280] as const;

for (const width of viewports) {
  test(`calendar shares the homepage design and keeps behavior at ${width}px`, async ({ page }) => {
    // Given the production calendar at a supported viewport,
    const signals = observeErrors(page);
    await routeCollection(page);
    await fixFixtureClock(page);
    await page.setViewportSize({ width, height: 820 });
    await page.goto("./#/calendar");
    await page.evaluate(() => document.fonts.ready);

    const home = page.getByRole("link", { name: "메인으로 돌아가기" });
    const heading = page.locator("#month-heading");
    const previous = page.locator("#previous-month");
    const next = page.locator("#next-month");
    const region = page.locator("#region-filter");
    const distance = page.locator("#distance-filter");
    const status = page.locator("#status-filter");
    const reset = page.locator("#reset-filters");
    await expect(home).toBeVisible();
    await expect(heading).toHaveText(fixtureShape.initialCalendarHeading);

    // When the calendar composition and shared design tokens are inspected,
    // Then it visibly uses the homepage navy, orange, canvas, elevation, and pill controls.
    await expect(home).toHaveAttribute("href", "#");
    const design = await page.locator(".calendar-page").evaluate((calendarPage) => {
      const style = getComputedStyle(calendarPage);
      const computed = (selector: string): CSSStyleDeclaration => {
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
        return getComputedStyle(node);
      };
      const header = computed(".calendar-header");
      const hero = computed(".calendar-hero");
      const card = computed(".calendar-panel");
      const control = computed("#region-filter");
      return {
        tokens: {
          navy: style.getPropertyValue("--hero-navy").trim(),
          deepNavy: style.getPropertyValue("--hero-navy-deep").trim(),
          orange: style.getPropertyValue("--cta-orange").trim(),
          canvas: style.getPropertyValue("--homepage-canvas").trim(),
          elevation: style.getPropertyValue("--row-shadow").trim(),
        },
        headerBackground: header.backgroundColor,
        heroBackground: hero.backgroundColor,
        pageBackground: style.backgroundColor,
        cardBackground: card.backgroundColor,
        cardRadius: card.borderRadius,
        cardShadow: card.boxShadow,
        controlRadius: control.borderRadius,
        fontFamily: style.fontFamily,
      };
    });
    expect({
      navy: design.tokens.navy,
      deepNavy: design.tokens.deepNavy,
      orange: design.tokens.orange,
      canvas: design.tokens.canvas,
    }).toEqual({
      navy: "#0b3a67",
      deepNavy: "#072b50",
      orange: "#c2410c",
      canvas: "#f2f5f7",
    });
    expect(design.tokens.elevation).toMatch(/^0 8px 22px rgba\(17, 43, 67, (?:0)?\.08\)$/);
    expect(design.headerBackground).toBe("rgb(7, 43, 80)");
    expect(design.heroBackground).toBe("rgb(11, 58, 103)");
    expect(design.pageBackground).toBe("rgb(242, 245, 247)");
    expect(design.cardBackground).toBe("rgb(255, 255, 255)");
    expect(design.cardRadius).toBe("12px");
    expect(design.cardShadow).not.toBe("none");
    expect(design.controlRadius).toBe("999px");
    expect(design.fontFamily.startsWith('"Noto Sans KR"')).toBe(true);
    await page.screenshot({
      path: `.omo/evidence/calendar-redesign-${width}.png`,
      fullPage: true,
    });

    if (width === 1280) {
      const header = page.locator(".calendar-header");
      await header.screenshot({ path: ".omo/evidence/calendar-home-button-rest.png" });
      await home.hover();
      await expect
        .poll(() => home.evaluate((node) => getComputedStyle(node).backgroundColor))
        .toBe("rgb(143, 39, 8)");
      await header.screenshot({ path: ".omo/evidence/calendar-home-button-hover.png" });
      await page.mouse.move(0, 800);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(home).toBeFocused();
      await expect(home).toHaveCSS("outline-color", "rgb(11, 122, 83)");
      await header.screenshot({ path: ".omo/evidence/calendar-home-button-focus.png" });
    }

    // When month navigation is used in both directions,
    const initialHeading = await heading.textContent();
    await previous.click();
    await expect(heading).not.toHaveText(initialHeading ?? "");
    await next.click();

    // Then the original month is restored and both controls expose visible hover/focus treatment.
    await expect(heading).toHaveText(initialHeading ?? "");
    await previous.hover();
    await expect
      .poll(() => previous.evaluate((node) => getComputedStyle(node).backgroundColor))
      .toBe("rgb(18, 63, 112)");
    await previous.focus();
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
    expect(await next.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
    await expect(next).toHaveCSS("outline-color", "rgb(11, 122, 83)");

    // When active filters are changed and reset,
    await status.selectOption("open");
    const regionOption = await region.locator("option").nth(1).getAttribute("value");
    const distanceOption = await distance.locator("option").nth(1).getAttribute("value");
    if (regionOption !== null) await region.selectOption(regionOption);
    if (distanceOption !== null) await distance.selectOption(distanceOption);
    await reset.click();

    // Then all calendar filters return to their wildcard state without changing the month.
    await expect(region).toHaveValue("");
    await expect(distance).toHaveValue("");
    await expect(status).toHaveValue("");
    await expect(heading).toHaveText(initialHeading ?? "");

    // When the home action is clicked and browser history is traversed,
    await home.click();
    await expect(page.locator(".home-page")).toBeVisible();
    await page.screenshot({
      path: `.omo/evidence/calendar-homepage-reference-${width}.png`,
      fullPage: true,
    });
    await page.goBack();

    // Then the calendar returns with its responsive structure and stable Korean rendering.
    await expect(page.locator(".calendar-page")).toBeVisible();
    const structure = await page.locator("#calendar").evaluate((calendar) => ({
      display: getComputedStyle(calendar.firstElementChild ?? calendar).display,
      visibleWeekdays: [...calendar.querySelectorAll<HTMLElement>(".weekday")].filter(
        (node) => getComputedStyle(node).display !== "none",
      ).length,
      visibleEmptyDays: [...calendar.querySelectorAll<HTMLElement>(".day-cell.is-empty")].filter(
        (node) => getComputedStyle(node).display !== "none",
      ).length,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      replacementCharacters: document.body.textContent?.includes("\uFFFD") ?? false,
      koreanFontLoaded: document.fonts.check('400 16px "Noto Sans KR"', "메인으로 돌아가기"),
      applicationLinks: [...calendar.querySelectorAll<HTMLAnchorElement>(".race")].map(
        (link) => link.href,
      ),
    }));
    const orphanedKoreanText = await page
      .locator(".calendar-home-link, .calendar-lede span, .filter-panel label span, .month-nav h2")
      .evaluateAll((elements) => {
        const orphans: string[] = [];
        for (const element of elements) {
          const text = element.textContent ?? "";
          const lines = new Map<number, string[]>();
          for (let index = 0; index < text.length; index += 1) {
            if (/^\s$/u.test(text[index] ?? "")) continue;
            const range = document.createRange();
            range.setStart(element.firstChild ?? element, index);
            range.setEnd(element.firstChild ?? element, index + 1);
            const rect = range.getClientRects().item(0);
            if (rect === null) continue;
            const line = lines.get(Math.round(rect.top)) ?? [];
            line.push(text[index] ?? "");
            lines.set(Math.round(rect.top), line);
          }
          const lastLine = [...lines.entries()].sort(([a], [b]) => a - b).at(-1)?.[1] ?? [];
          if (lastLine.length === 1 && /[\p{Script=Hangul}\p{Script=Han}]/u.test(lastLine[0] ?? ""))
            orphans.push(text);
        }
        return orphans;
      });
    if (width === 375) {
      expect(structure.display).toBe("block");
      expect(structure.visibleWeekdays).toBe(0);
      expect(structure.visibleEmptyDays).toBe(0);
    } else {
      expect(structure.display).toBe("grid");
      expect(structure.visibleWeekdays).toBe(7);
    }
    expect(structure.overflow).toBe(false);
    expect(structure.replacementCharacters).toBe(false);
    expect(structure.koreanFontLoaded).toBe(true);
    expect(structure.applicationLinks.length).toBeGreaterThan(0);
    expect(structure.applicationLinks.every((href) => href.startsWith("http"))).toBe(true);
    expect(orphanedKoreanText).toEqual([]);
    expect(signals.consoleErrors).toEqual([]);
    expect(signals.pageErrors).toEqual([]);
  });
}
