import { type Page, expect, test } from "@playwright/test";
import { routeCollection } from "./fixtures/collection.js";
import { weatherResponse } from "./fixtures/weather.js";
import { observeErrors } from "./helpers/browser.js";

async function denyGeolocation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback | null | undefined,
          options?: PositionOptions,
        ) => {
          const requestCount = Number(document.documentElement.dataset.weatherLocationCount ?? "0");
          document.documentElement.dataset.weatherLocationCount = String(requestCount + 1);
          document.documentElement.dataset.weatherLocationOptions = JSON.stringify(options);
          const disclosure = document.querySelector<HTMLElement>(".home-weather-message");
          const disclosureStyle = disclosure === null ? null : getComputedStyle(disclosure);
          const disclosureBox = disclosure?.getBoundingClientRect();
          document.documentElement.dataset.weatherDisclosureVisible = String(
            disclosureStyle !== null &&
              disclosureStyle.visibility === "visible" &&
              disclosureStyle.display !== "none" &&
              disclosureBox !== undefined &&
              disclosureBox.width > 0 &&
              disclosureBox.height > 0,
          );
          error?.({
            code: 1,
            message: "permission denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        },
      },
    });
  });
}

test("hero shows current weather for an allowed browser location", async ({ context, page }) => {
  // Given deterministic weather and an allowed current position in Busan,
  const signals = observeErrors(page);
  await context.setGeolocation({ latitude: 35.1796, longitude: 129.0756 });
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4177" });
  await routeCollection(page);

  // When the homepage loads,
  const weatherRequest = page.waitForRequest("https://api.open-meteo.com/v1/forecast?**");
  const airQualityRequest = page.waitForRequest(
    "https://air-quality-api.open-meteo.com/v1/air-quality?**",
  );
  const locationRequest = page.waitForRequest("https://nominatim.openstreetmap.org/reverse?**");
  await page.goto("./");

  // Then the hero reports the current-position weather with visible measurements and source.
  const weather = page.getByRole("region", { name: "현재 날씨" });
  await expect(weather).toBeVisible();
  await expect(
    page.locator(".home-hero-copy").getByRole("region", { name: "현재 날씨" }),
  ).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "오늘의 달리기 날씨" })).toBeVisible();
  await expect(page.getByText("달릴 날을 정하는", { exact: true })).toHaveCount(0);
  await expect(page.getByText("전국 대회를 월별로 보고,", { exact: true })).toHaveCount(0);
  await expect(page.getByText("공식 신청 페이지를 확인하세요.", { exact: true })).toHaveCount(0);
  await expect(weather).toContainText("부산광역시 연제구");
  await expect(weather).toContainText("현재 위치");
  await expect(weather.getByText("24°C", { exact: true })).toBeVisible();
  await expect(weather.getByText("체감 25°C", { exact: true })).toBeVisible();
  await expect(weather).toContainText("습도68%");
  await expect(weather).toContainText("구름42%");
  await expect(weather.getByText("강수", { exact: true })).toBeVisible();
  await expect(weather.getByText("0.2mm", { exact: true })).toBeVisible();
  await expect(weather.getByText("바람", { exact: true })).toBeVisible();
  await expect(weather.getByText("서 7.8km/h", { exact: true })).toBeVisible();
  await expect(weather).toContainText("대기질좋음 · US AQI 42");
  await expect(weather).toContainText("PM2.5 8.4μg/m³ · PM10 14.2μg/m³");
  await expect(weather.getByRole("link", { name: "Open-Meteo" })).toBeVisible();
  await expect(weather.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
  const requestUrl = new URL((await weatherRequest).url());
  expect(requestUrl.searchParams.get("latitude")).toBe("35.18");
  expect(requestUrl.searchParams.get("longitude")).toBe("129.08");
  expect(requestUrl.searchParams.get("temperature_unit")).toBe("celsius");
  expect(requestUrl.searchParams.get("wind_speed_unit")).toBe("kmh");
  expect(requestUrl.searchParams.get("precipitation_unit")).toBe("mm");
  const airQualityUrl = new URL((await airQualityRequest).url());
  expect(airQualityUrl.searchParams.get("latitude")).toBe("35.18");
  expect(airQualityUrl.searchParams.get("longitude")).toBe("129.08");
  expect(airQualityUrl.searchParams.get("current")).toBe("us_aqi,pm2_5,pm10");
  const locationUrl = new URL((await locationRequest).url());
  expect(locationUrl.searchParams.get("lat")).toBe("35.18");
  expect(locationUrl.searchParams.get("lon")).toBe("129.08");
  expect(locationUrl.searchParams.get("accept-language")).toBe("ko");
  expect(locationUrl.searchParams.get("zoom")).toBe("12");
  expect(signals.consoleErrors).toEqual([]);
  expect(signals.pageErrors).toEqual([]);
});

test("hero uses Seoul weather when location permission is unavailable", async ({ page }) => {
  // Given deterministic weather and a browser position request that is denied,
  await denyGeolocation(page);
  await routeCollection(page);
  let locationRequests = 0;
  page.on("request", (request) => {
    if (request.url().startsWith("https://nominatim.openstreetmap.org/reverse?"))
      locationRequests += 1;
  });

  // When the homepage loads,
  const weatherRequest = page.waitForRequest("https://api.open-meteo.com/v1/forecast?**");
  await page.goto("./");

  // Then the ready panel clearly identifies the Seoul fallback.
  const weather = page.getByRole("region", { name: "현재 날씨" });
  await expect(weather).toContainText("서울특별시 중구");
  await expect(weather).toContainText("서울 기준");
  await expect(weather).toContainText("맑음");
  const requestUrl = new URL((await weatherRequest).url());
  expect(requestUrl.searchParams.get("latitude")).toBe("37.57");
  expect(requestUrl.searchParams.get("longitude")).toBe("126.98");
  expect(locationRequests).toBe(0);
  await expect(page.locator("html")).toHaveAttribute("data-weather-disclosure-visible", "true");
  await expect(page.locator("html")).toHaveAttribute(
    "data-weather-location-options",
    JSON.stringify({ enableHighAccuracy: false, timeout: 4_000, maximumAge: 600_000 }),
  );
});

test("hero keeps weather when the current city lookup is unavailable", async ({
  context,
  page,
}) => {
  // Given an allowed current position and a malformed reverse-geocode response,
  await context.setGeolocation({ latitude: 35.1796, longitude: 129.0756 });
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4177" });
  await routeCollection(page);
  await page.route("https://nominatim.openstreetmap.org/reverse?**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });

  // When the homepage loads,
  await page.goto("./");

  // Then forecast data remains ready with an honest current-position fallback.
  const weather = page.getByRole("region", { name: "현재 날씨" });
  await expect(weather).toContainText("현재 위치");
  await expect(weather).toContainText("24°C");
  await expect(weather).not.toContainText("부산광역시 연제구");
  await expect(weather).not.toContainText("날씨 정보를 잠시 확인할 수 없습니다");
});

test("hero keeps weather when air quality is unavailable", async ({ page }) => {
  // Given valid forecast data and a malformed air-quality response,
  await denyGeolocation(page);
  await routeCollection(page);
  await page.route("https://air-quality-api.open-meteo.com/v1/air-quality?**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });

  // When the homepage loads,
  await page.goto("./");

  // Then only air quality degrades while the forecast remains ready.
  const weather = page.getByRole("region", { name: "현재 날씨" });
  await expect(weather).toContainText("서울특별시 중구");
  await expect(weather).toContainText("대기질정보 없음");
  await expect(weather).toContainText("24°C");
});

test("hero reserves the weather panel while current conditions load", async ({ page }) => {
  // Given a weather response held at the network boundary,
  await denyGeolocation(page);
  await routeCollection(page);
  let releaseWeather: () => void = () => undefined;
  const weatherReady = new Promise<void>((resolve) => {
    releaseWeather = resolve;
  });
  await page.route("https://api.open-meteo.com/v1/forecast?**", async (route) => {
    await weatherReady;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(weatherResponse) });
  });

  // When the homepage renders before weather completes,
  await page.goto("./");
  const weather = page.getByRole("region", { name: "현재 날씨" });

  // Then its reserved loading state transitions in place to ready data.
  await expect(weather).toHaveAttribute("aria-busy", "true");
  await expect(weather).toContainText("Open-Meteo");
  await expect(weather).toContainText("서울 기준");
  const loadingBox = await weather.boundingBox();
  releaseWeather();
  await expect(weather).toContainText("서울 기준");
  const readyBox = await weather.boundingBox();
  if (loadingBox === null || readyBox === null) throw new Error("Weather panel must render");
  expect(readyBox.width).toBe(loadingBox.width);
  expect(readyBox.height).toBe(loadingBox.height);
});

test("hero reports when current weather is temporarily unavailable", async ({ page }) => {
  // Given a failed Open-Meteo response after the Seoul fallback is selected,
  const signals = observeErrors(page);
  await denyGeolocation(page);
  await routeCollection(page);
  await page.route("https://api.open-meteo.com/v1/forecast?**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });

  // When the homepage loads,
  await page.goto("./");

  // Then the panel presents an honest unavailable state without an uncaught browser error.
  const weather = page.getByRole("region", { name: "현재 날씨" });
  await expect(weather).toContainText("날씨 정보를 잠시 확인할 수 없습니다");
  await expect(weather).not.toHaveAttribute("aria-busy", "true");
  expect(signals.consoleErrors).toEqual([]);
  expect(signals.pageErrors).toEqual([]);
});

test("hash navigation reuses one location and weather request", async ({ page }) => {
  // Given deterministic weather on the homepage,
  await denyGeolocation(page);
  await routeCollection(page);
  let weatherRequests = 0;
  let airQualityRequests = 0;
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.open-meteo.com/v1/forecast?")) weatherRequests += 1;
    if (request.url().startsWith("https://air-quality-api.open-meteo.com/v1/air-quality?"))
      airQualityRequests += 1;
  });
  await page.goto("./");
  await expect(page.getByRole("region", { name: "현재 날씨" })).toContainText("서울 기준");

  // When the user visits the calendar and returns through hash navigation,
  await page.getByRole("link", { name: "월간 캘린더" }).click();
  await expect(page.getByRole("heading", { name: "Marathon Calendar" })).toBeVisible();
  await page.getByRole("link", { name: "메인으로 돌아가기" }).click();
  await expect(page.getByRole("region", { name: "현재 날씨" })).toContainText("서울 기준");

  // Then the application session reuses the original location and weather operation.
  expect(weatherRequests).toBe(1);
  expect(airQualityRequests).toBe(1);
  await expect(page.locator("html")).toHaveAttribute("data-weather-location-count", "1");
});

const visualViewports = [375, 768, 1280] as const;
const colorSchemes = ["light", "dark"] as const;

for (const width of visualViewports) {
  for (const colorScheme of colorSchemes) {
    test(`hero weather remains composed at ${width}px in ${colorScheme} mode`, async ({ page }) => {
      // Given deterministic Seoul weather at a supported viewport and color scheme,
      const signals = observeErrors(page);
      await denyGeolocation(page);
      await routeCollection(page);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });

      // When the production homepage settles,
      await page.goto("./");
      const weather = page.getByRole("region", { name: "현재 날씨" });
      await expect(weather).toContainText("서울 기준");

      // Then the panel follows its responsive position, fits its surface, and does not overflow.
      await expect(weather).toHaveCSS("position", "relative");
      const weatherBox = await weather.boundingBox();
      const runnerBox = await page.locator(".home-runner").boundingBox();
      const brandBox = await page.locator(".home-brand").boundingBox();
      if (weatherBox === null || runnerBox === null || brandBox === null)
        throw new Error("Hero elements must render");
      const overlapsRunner =
        weatherBox.x < runnerBox.x + runnerBox.width &&
        weatherBox.x + weatherBox.width > runnerBox.x &&
        weatherBox.y < runnerBox.y + runnerBox.height &&
        weatherBox.y + weatherBox.height > runnerBox.y;
      const overlapsBrand =
        weatherBox.x < brandBox.x + brandBox.width &&
        weatherBox.x + weatherBox.width > brandBox.x &&
        weatherBox.y < brandBox.y + brandBox.height &&
        weatherBox.y + weatherBox.height > brandBox.y;
      expect(overlapsRunner).toBe(false);
      expect(overlapsBrand).toBe(false);
      const layout = await weather.evaluate((panel) => ({
        panelFits:
          panel.scrollWidth <= panel.clientWidth && panel.scrollHeight <= panel.clientHeight,
        pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
      }));
      expect(layout.panelFits).toBe(true);
      expect(layout.pageOverflows).toBe(false);
      expect(signals.consoleErrors).toEqual([]);
      expect(signals.pageErrors).toEqual([]);
      await page.screenshot({
        path: `.omo/evidence/weather-hero-${width}-${colorScheme}.png`,
        fullPage: false,
      });
    });
  }
}
