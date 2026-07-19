import { describe, expect, it } from "vitest";
import {
  type WeatherLocation,
  airQualityLevelForIndex,
  chooseWeatherLocation,
  parseAirQuality,
  parseCurrentWeather,
  parseWeatherPlace,
  weatherConditionForCode,
} from "../src/home-weather-model.js";

const seoul: WeatherLocation = {
  latitude: 37.57,
  longitude: 126.98,
  label: "서울 기준",
};

const validResponse = {
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
};

describe("home weather model", () => {
  it("maps WMO codes to the visible weather condition groups", () => {
    // Given every documented Open-Meteo WMO code plus reserved values,
    const cases = [
      [0, "clear"],
      [1, "cloudy"],
      [2, "cloudy"],
      [3, "cloudy"],
      [45, "fog"],
      [48, "fog"],
      ...[51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].map(
        (code) => [code, "rain"] as const,
      ),
      ...[71, 73, 75, 77, 85, 86].map((code) => [code, "snow"] as const),
      ...[95, 96, 99].map((code) => [code, "storm"] as const),
      [52, "unknown"],
      [120, "unknown"],
    ] as const;

    // When the codes are interpreted,
    const conditions = cases.map(([code]) => weatherConditionForCode(code));

    // Then only documented codes enter a weather group and reserved values remain unknown.
    expect(conditions).toEqual(cases.map(([, condition]) => condition));
  });

  it("uses current coordinates when browser location succeeds", async () => {
    // Given a successful low-accuracy browser location,
    const locate = () => Promise.resolve({ latitude: 35.1796, longitude: 129.0756 });

    // When the weather location is selected,
    const location = await chooseWeatherLocation(locate);

    // Then it is labelled as the current position.
    expect(location).toEqual({ latitude: 35.18, longitude: 129.08, label: "현재 위치" });
  });

  it("uses Seoul when browser location is unavailable", async () => {
    // Given a rejected browser location request,
    const locate = () => Promise.reject(new Error("permission denied"));

    // When the weather location is selected,
    const location = await chooseWeatherLocation(locate);

    // Then the documented Seoul fallback is returned.
    expect(location).toEqual(seoul);
  });

  it("parses current Open-Meteo measurements at the network boundary", () => {
    // Given a valid current conditions response,
    // When the response crosses the weather boundary,
    const weather = parseCurrentWeather(validResponse, seoul);

    // Then typed measurements and the interpreted condition are returned.
    expect(weather).toEqual({
      condition: "clear",
      temperature: 24.4,
      apparentTemperature: 25.1,
      relativeHumidity: 68,
      precipitation: 0.2,
      cloudCover: 42,
      windSpeed: 7.8,
      windDirection: 270,
      observedAt: "2026-07-19T09:15",
      location: seoul,
      place: null,
      airQuality: null,
    });
  });

  it("rejects incomplete Open-Meteo responses", () => {
    // Given a response without current measurements,
    // When it crosses the weather boundary,
    const parse = () => parseCurrentWeather({}, seoul);

    // Then malformed external data is rejected instead of leaking into the UI.
    expect(parse).toThrow();
  });

  it("classifies current US AQI and particulate measurements", () => {
    // Given a valid Open-Meteo air-quality response,
    const response = { current: { us_aqi: 42, pm2_5: 8.4, pm10: 14.2 } };

    // When it crosses the air-quality boundary,
    const airQuality = parseAirQuality(response);

    // Then the AQI category and particulate values remain typed together.
    expect(airQuality).toEqual({ usAqi: 42, level: "good", pm25: 8.4, pm10: 14.2 });
  });

  it("classifies every US AQI category at its lower boundary", () => {
    // Given each category's first AQI value,
    const indexes = [0, 51, 101, 151, 201, 301] as const;

    // When the indexes are classified,
    const levels = indexes.map(airQualityLevelForIndex);

    // Then every documented category remains reachable at the exact boundary.
    expect(levels).toEqual([
      "good",
      "moderate",
      "unhealthy-sensitive",
      "unhealthy",
      "very-unhealthy",
      "hazardous",
    ]);
  });

  it("extracts a Korean city and district from OpenStreetMap", () => {
    // Given a Korean reverse-geocode address,
    const response = { address: { city: "부산광역시", borough: "연제구" } };

    // When it crosses the place boundary,
    const place = parseWeatherPlace(response);

    // Then the city and district are retained without street-level detail.
    expect(place).toEqual({ city: "부산광역시", district: "연제구" });
  });

  it("returns no place when reverse geocoding has no city-level name", () => {
    // Given a valid address object without city-level fields,
    const response = { address: {} };

    // When it crosses the place boundary,
    const place = parseWeatherPlace(response);

    // Then the UI can fall back without inventing a city.
    expect(place).toBeNull();
  });
});
