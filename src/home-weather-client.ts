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

class WeatherLocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherLocationError";
  }
}

function locateBrowser(): Promise<WeatherCoordinates> {
  const geolocation = navigator.geolocation;
  if (geolocation === undefined)
    return Promise.reject(new WeatherLocationError("Browser geolocation is unavailable"));
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (error) => reject(new WeatherLocationError(error.message)),
      { enableHighAccuracy: false, timeout: 4_000, maximumAge: 600_000 },
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
      timeout: 8_000,
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
      timeout: 8_000,
    })
    .json<unknown>()
    .then(parseWeatherPlace);
  return request.then(
    (place) => place,
    (): null => null,
  );
}

async function requestCurrentWeather(): Promise<CurrentWeather> {
  const location = await chooseWeatherLocation(locateBrowser);
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
      timeout: 8_000,
    })
    .json<unknown>();
  const [raw, airQuality, place] = await Promise.all([
    forecastRequest,
    requestAirQuality(location),
    requestWeatherPlace(location),
  ]);
  return parseCurrentWeather(raw, location, { place, airQuality });
}

let currentWeatherRequest: Promise<CurrentWeather> | undefined;

export function loadCurrentWeather(): Promise<CurrentWeather> {
  currentWeatherRequest ??= requestCurrentWeather();
  return currentWeatherRequest;
}
