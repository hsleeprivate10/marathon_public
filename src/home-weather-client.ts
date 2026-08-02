import ky from "ky";
import {
  type AirQuality,
  type CurrentWeather,
  type WeatherCoordinates,
  type WeatherLocation,
  type WeatherPlace,
  chooseWeatherLocation,
  parseAirQuality,
  parseCurrentWeather,
  parseWeatherPlace,
} from "./home-weather-model.js";

const seoulWeatherPlace: WeatherPlace = { city: "서울특별시", district: "중구" };
const seoulWeatherLocation: WeatherLocation = {
  latitude: 37.57,
  longitude: 126.98,
  label: "서울 기준",
};
const geolocationTimeoutMs = 1_500;
const weatherRequestTimeoutMs = 1_500;

class WeatherLocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherLocationError";
  }
}

function mayUseBrowserLocation(): Promise<boolean> {
  const permissions = navigator.permissions;
  if (permissions === undefined) return Promise.resolve(true);
  return permissions.query({ name: "geolocation" }).then(
    (permission) => permission.state !== "denied",
    () => true,
  );
}

async function locateBrowser(): Promise<WeatherCoordinates> {
  if (!(await mayUseBrowserLocation()))
    throw new WeatherLocationError("Browser geolocation permission is denied");
  const geolocation = navigator.geolocation;
  if (geolocation === undefined)
    throw new WeatherLocationError("Browser geolocation is unavailable");
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => reject(new WeatherLocationError(error.message)),
      { enableHighAccuracy: false, timeout: geolocationTimeoutMs, maximumAge: 600_000 },
    );
  });
}

function requestAirQuality(location: WeatherLocation): Promise<AirQuality | null> {
  const request = ky
    .get("https://air-quality-api.open-meteo.com/v1/air-quality", {
      searchParams: {
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        current: "us_aqi,pm2_5,pm10",
        timezone: "auto",
      },
      retry: { limit: 0 },
      timeout: weatherRequestTimeoutMs,
    })
    .json<unknown>()
    .then(parseAirQuality);
  return request.then(
    (airQuality) => airQuality,
    (): null => null,
  );
}

function requestWeatherPlace(location: WeatherLocation): Promise<WeatherPlace | null> {
  if (location.label === "서울 기준") return Promise.resolve(seoulWeatherPlace);
  const request = ky
    .get("https://nominatim.openstreetmap.org/reverse", {
      searchParams: {
        lat: String(location.latitude),
        lon: String(location.longitude),
        format: "jsonv2",
        "accept-language": "ko",
        zoom: "12",
        addressdetails: "1",
        layer: "address",
      },
      retry: { limit: 0 },
      timeout: weatherRequestTimeoutMs,
    })
    .json<unknown>()
    .then(parseWeatherPlace);
  return request.then(
    (place) => place,
    (): null => null,
  );
}

async function requestWeather(location: WeatherLocation): Promise<CurrentWeather> {
  const forecastRequest = ky
    .get("https://api.open-meteo.com/v1/forecast", {
      searchParams: {
        latitude: String(location.latitude),
        longitude: String(location.longitude),
        current:
          "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m",
        timezone: "auto",
        forecast_days: "1",
        temperature_unit: "celsius",
        wind_speed_unit: "kmh",
        precipitation_unit: "mm",
      },
      retry: { limit: 0 },
      timeout: weatherRequestTimeoutMs,
    })
    .json<unknown>();
  const [raw, airQuality, place] = await Promise.all([
    forecastRequest,
    requestAirQuality(location),
    requestWeatherPlace(location),
  ]);
  return parseCurrentWeather(raw, location, { place, airQuality });
}

async function requestCurrentWeather(): Promise<CurrentWeather> {
  return requestWeather(await chooseWeatherLocation(locateBrowser));
}

let currentWeatherRequest: Promise<CurrentWeather> | undefined;
let defaultWeatherRequest: Promise<CurrentWeather> | undefined;

export function loadDefaultWeather(): Promise<CurrentWeather> {
  defaultWeatherRequest ??= requestWeather(seoulWeatherLocation);
  return defaultWeatherRequest;
}

export function loadCurrentWeather(): Promise<CurrentWeather> {
  currentWeatherRequest ??= requestCurrentWeather();
  return currentWeatherRequest;
}
