import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { routeCollection } from "./fixtures/collection.js";
import { observeErrors } from "./helpers/browser.js";

async function promptGeolocationSucceeds(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: () => Promise.resolve({ state: "prompt" }),
      },
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback, _error?: PositionErrorCallback | null) => {
          const requestCount = Number(document.documentElement.dataset.weatherLocationCount ?? "0");
          document.documentElement.dataset.weatherLocationCount = String(requestCount + 1);
          success({
            coords: {
              accuracy: 1,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              latitude: 35.1796,
              longitude: 129.0756,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          });
        },
      },
    });
  });
}

test("hero requests current position only after a prompt-permission user action", async ({
  page,
}) => {
  // Given a first-visit browser that has not decided geolocation permission yet,
  const signals = observeErrors(page);
  await promptGeolocationSucceeds(page);
  await routeCollection(page);

  // When the homepage loads,
  await page.goto("./");

  // Then it renders the current-location disclosure without triggering a permission prompt.
  const weather = page.getByRole("region", { name: "현재 날씨" });
  await expect(weather).toContainText("현재 위치 또는 서울 기준");
  await expect(weather).toContainText("거부하거나 사용할 수 없으면 서울 기준");
  await expect(page.locator("html")).not.toHaveAttribute("data-weather-location-count", "1");

  // When the visible current-location action is used,
  const weatherRequest = page.waitForRequest("https://api.open-meteo.com/v1/forecast?**");
  await weather.getByRole("button", { name: "현재 위치 날씨 보기" }).click();

  // Then it asks for the browser position once instead of silently staying on Seoul.
  await expect(weather).toContainText("부산광역시 연제구");
  await expect(weather).toContainText("현재 위치");
  const requestUrl = new URL((await weatherRequest).url());
  expect(requestUrl.searchParams.get("latitude")).toBe("35.18");
  expect(requestUrl.searchParams.get("longitude")).toBe("129.08");
  await expect(page.locator("html")).toHaveAttribute("data-weather-location-count", "1");
  expect(signals.consoleErrors).toEqual([]);
  expect(signals.pageErrors).toEqual([]);
});
