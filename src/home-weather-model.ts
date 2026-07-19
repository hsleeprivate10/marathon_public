import { z } from "zod";

export type WeatherCondition = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm" | "unknown";
export type AirQualityLevel =
  | "good"
  | "moderate"
  | "unhealthy-sensitive"
  | "unhealthy"
  | "very-unhealthy"
  | "hazardous";

export type WeatherCoordinates = {
  readonly latitude: number;
  readonly longitude: number;
};

export type WeatherLocation = WeatherCoordinates & {
  readonly label: "현재 위치" | "서울 기준";
};

export type WeatherPlace = {
  readonly city: string;
  readonly district: string | null;
};

export type AirQuality = {
  readonly usAqi: number;
  readonly level: AirQualityLevel;
  readonly pm25: number;
  readonly pm10: number;
};

export type CurrentWeather = {
  readonly condition: WeatherCondition;
  readonly temperature: number;
  readonly apparentTemperature: number;
  readonly relativeHumidity: number;
  readonly precipitation: number;
  readonly cloudCover: number;
  readonly windSpeed: number;
  readonly windDirection: number;
  readonly observedAt: string;
  readonly location: WeatherLocation;
  readonly place: WeatherPlace | null;
  readonly airQuality: AirQuality | null;
};

export type WeatherSupplement = {
  readonly place: WeatherPlace | null;
  readonly airQuality: AirQuality | null;
};

export type WeatherLocator = () => Promise<WeatherCoordinates>;

const seoulWeatherLocation: WeatherLocation = {
  latitude: 37.57,
  longitude: 126.98,
  label: "서울 기준",
};

const emptySupplement: WeatherSupplement = { place: null, airQuality: null };
const cloudyCodes = new Set([1, 2, 3]);
const fogCodes = new Set([45, 48]);
const rainCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const snowCodes = new Set([71, 73, 75, 77, 85, 86]);
const stormCodes = new Set([95, 96, 99]);

const OpenMeteoCurrentSchema = z.object({
  current: z.object({
    time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u),
    temperature_2m: z.number().min(-100).max(70),
    apparent_temperature: z.number().min(-120).max(80),
    relative_humidity_2m: z.number().min(0).max(100),
    precipitation: z.number().nonnegative(),
    cloud_cover: z.number().min(0).max(100),
    weather_code: z.number().int().min(0).max(99),
    wind_speed_10m: z.number().nonnegative(),
    wind_direction_10m: z.number().min(0).max(360),
  }),
});

const OpenMeteoAirQualitySchema = z.object({
  current: z.object({
    us_aqi: z.number().int().min(0).max(500),
    pm2_5: z.number().nonnegative(),
    pm10: z.number().nonnegative(),
  }),
});

const OpenStreetMapPlaceSchema = z.object({
  address: z.object({
    city: z.string().min(1).optional(),
    town: z.string().min(1).optional(),
    municipality: z.string().min(1).optional(),
    county: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    borough: z.string().min(1).optional(),
    city_district: z.string().min(1).optional(),
  }),
});

export function weatherConditionForCode(code: number): WeatherCondition {
  if (code === 0) return "clear";
  if (cloudyCodes.has(code)) return "cloudy";
  if (fogCodes.has(code)) return "fog";
  if (rainCodes.has(code)) return "rain";
  if (snowCodes.has(code)) return "snow";
  if (stormCodes.has(code)) return "storm";
  return "unknown";
}

export function airQualityLevelForIndex(index: number): AirQualityLevel {
  if (index <= 50) return "good";
  if (index <= 100) return "moderate";
  if (index <= 150) return "unhealthy-sensitive";
  if (index <= 200) return "unhealthy";
  if (index <= 300) return "very-unhealthy";
  return "hazardous";
}

export async function chooseWeatherLocation(locate: WeatherLocator): Promise<WeatherLocation> {
  return locate().then(
    (coordinates): WeatherLocation => ({
      latitude: Math.round(coordinates.latitude * 100) / 100,
      longitude: Math.round(coordinates.longitude * 100) / 100,
      label: "현재 위치",
    }),
    (): WeatherLocation => seoulWeatherLocation,
  );
}

export function parseAirQuality(raw: unknown): AirQuality {
  const { current } = OpenMeteoAirQualitySchema.parse(raw);
  return {
    usAqi: current.us_aqi,
    level: airQualityLevelForIndex(current.us_aqi),
    pm25: current.pm2_5,
    pm10: current.pm10,
  };
}

export function parseWeatherPlace(raw: unknown): WeatherPlace | null {
  const { address } = OpenStreetMapPlaceSchema.parse(raw);
  const city =
    address.city ?? address.town ?? address.municipality ?? address.county ?? address.state;
  if (city === undefined) return null;
  const district = address.borough ?? address.city_district ?? null;
  return { city, district: district === city ? null : district };
}

export function parseCurrentWeather(
  raw: unknown,
  location: WeatherLocation,
  supplement: WeatherSupplement = emptySupplement,
): CurrentWeather {
  const { current } = OpenMeteoCurrentSchema.parse(raw);
  return {
    condition: weatherConditionForCode(current.weather_code),
    temperature: current.temperature_2m,
    apparentTemperature: current.apparent_temperature,
    relativeHumidity: current.relative_humidity_2m,
    precipitation: current.precipitation,
    cloudCover: current.cloud_cover,
    windSpeed: current.wind_speed_10m,
    windDirection: current.wind_direction_10m,
    observedAt: current.time,
    location,
    place: supplement.place,
    airQuality: supplement.airQuality,
  };
}
