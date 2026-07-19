import type { Page } from "@playwright/test";

export const weatherResponse = {
  current: {
    time: "2026-07-19T09:15",
    interval: 900,
    temperature_2m: 24.4,
    apparent_temperature: 25.1,
    relative_humidity_2m: 68,
    precipitation: 0.2,
    cloud_cover: 42,
    weather_code: 0,
    wind_speed_10m: 7.8,
    wind_direction_10m: 270,
  },
} as const;

export const airQualityResponse = {
  current: {
    time: "2026-07-19T09:00",
    interval: 3_600,
    us_aqi: 42,
    pm2_5: 8.4,
    pm10: 14.2,
  },
} as const;

export const reverseLocationResponse = {
  licence: "Data © OpenStreetMap contributors, ODbL 1.0",
  address: {
    borough: "연제구",
    city: "부산광역시",
    country: "대한민국",
    country_code: "kr",
  },
} as const;

export async function routeWeather(page: Page): Promise<void> {
  await Promise.all([
    page.route("https://api.open-meteo.com/v1/forecast?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(weatherResponse),
      });
    }),
    page.route("https://air-quality-api.open-meteo.com/v1/air-quality?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(airQualityResponse),
      });
    }),
    page.route("https://nominatim.openstreetmap.org/reverse?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(reverseLocationResponse),
      });
    }),
  ]);
}
