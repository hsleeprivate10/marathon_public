import { loadCurrentWeather } from "./home-weather-client.js";
import { weatherIcon } from "./home-weather-icon.js";
import type { AirQualityLevel, CurrentWeather, WeatherCondition } from "./home-weather-model.js";

type WeatherPanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly weather: CurrentWeather }
  | { readonly kind: "unavailable" };

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function conditionLabel(condition: WeatherCondition): string {
  switch (condition) {
    case "clear":
      return "맑음";
    case "cloudy":
      return "구름 많음";
    case "fog":
      return "안개";
    case "rain":
      return "비";
    case "snow":
      return "눈";
    case "storm":
      return "뇌우";
    case "unknown":
      return "날씨 변화";
  }
}

function airQualityLabel(level: AirQualityLevel): string {
  switch (level) {
    case "good":
      return "좋음";
    case "moderate":
      return "보통";
    case "unhealthy-sensitive":
      return "민감군 주의";
    case "unhealthy":
      return "나쁨";
    case "very-unhealthy":
      return "매우 나쁨";
    case "hazardous":
      return "위험";
  }
}

function windDirectionLabel(direction: number): string {
  switch (Math.round(direction / 45) % 8) {
    case 0:
      return "북";
    case 1:
      return "북동";
    case 2:
      return "동";
    case 3:
      return "남동";
    case 4:
      return "남";
    case 5:
      return "남서";
    case 6:
      return "서";
    case 7:
      return "북서";
    default:
      return "북";
  }
}

function sourceLink(label: string, href: string): HTMLAnchorElement {
  const source = element("a", "home-weather-source", label);
  source.href = href;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  return source;
}

function sourceLinks(): HTMLSpanElement {
  const sources = element("span", "home-weather-sources");
  sources.append(
    sourceLink("Open-Meteo", "https://open-meteo.com/"),
    element("span", undefined, "·"),
    sourceLink("OpenStreetMap", "https://www.openstreetmap.org/copyright"),
  );
  return sources;
}

function metric(label: string, value: string): HTMLDivElement {
  const item = element("div", "home-weather-metric");
  item.append(element("dt", undefined, label), element("dd", undefined, value));
  return item;
}

function weatherHeading(location: string, context?: string): HTMLDivElement {
  const heading = element("div", "home-weather-heading");
  const titleGroup = element("div", "home-weather-title-group");
  const locationGroup = element("span", "home-weather-location");
  titleGroup.append(
    element("span", "home-weather-kicker", "RUNNING WEATHER"),
    element("h1", "home-weather-title", "오늘의 달리기 날씨"),
  );
  locationGroup.append(element("span", "home-weather-place", location));
  if (context !== undefined)
    locationGroup.append(element("span", "home-weather-location-context", context));
  heading.append(titleGroup, locationGroup);
  return heading;
}

function renderReady(panel: HTMLElement, weather: CurrentWeather): void {
  const place = weather.place;
  const heading = weatherHeading(
    place === null
      ? weather.location.label
      : place.district === null
        ? place.city
        : `${place.city} ${place.district}`,
    place === null ? undefined : weather.location.label,
  );
  const summary = element("div", "home-weather-summary");
  const temperature = element(
    "strong",
    "home-weather-temperature",
    `${Math.round(weather.temperature)}°C`,
  );
  const description = element("div", "home-weather-description");
  description.append(
    element("span", "home-weather-condition", conditionLabel(weather.condition)),
    element("span", "home-weather-apparent", `체감 ${Math.round(weather.apparentTemperature)}°C`),
  );
  summary.append(weatherIcon(weather.condition), temperature, description);
  const measurements = element("dl", "home-weather-measurements");
  measurements.append(
    metric("습도", `${weather.relativeHumidity}%`),
    metric("구름", `${weather.cloudCover}%`),
    metric(
      "바람",
      `${windDirectionLabel(weather.windDirection)} ${weather.windSpeed.toFixed(1)}km/h`,
    ),
    metric("강수", `${weather.precipitation.toFixed(1)}mm`),
  );
  const airQuality = weather.airQuality;
  const airQualityMetric = metric(
    "대기질",
    airQuality === null
      ? "정보 없음"
      : `${airQualityLabel(airQuality.level)} · US AQI ${airQuality.usAqi}`,
  );
  airQualityMetric.classList.add("home-weather-metric-wide");
  measurements.append(airQualityMetric);
  if (airQuality !== null) {
    const particles = metric(
      "미세먼지",
      `PM2.5 ${airQuality.pm25.toFixed(1)}μg/m³ · PM10 ${airQuality.pm10.toFixed(1)}μg/m³`,
    );
    particles.classList.add("home-weather-metric-wide");
    measurements.append(particles);
  }
  const footer = element("div", "home-weather-footer");
  const observed = element("time", undefined, `${weather.observedAt.slice(11)} 기준`);
  observed.dateTime = weather.observedAt;
  footer.append(observed, sourceLinks());
  panel.replaceChildren(heading, summary, measurements, footer);
}

function renderPanel(panel: HTMLElement, state: WeatherPanelState): void {
  switch (state.kind) {
    case "loading":
      panel.setAttribute("aria-busy", "true");
      panel.replaceChildren(
        weatherHeading("위치 확인 중"),
        element(
          "p",
          "home-weather-message",
          "현재 위치는 Open-Meteo 날씨·대기질과 OpenStreetMap 도시 조회에만 사용하며, 거부하면 서울 기준(중구)입니다.",
        ),
      );
      return;
    case "ready":
      panel.removeAttribute("aria-busy");
      renderReady(panel, state.weather);
      return;
    case "unavailable":
      panel.removeAttribute("aria-busy");
      panel.replaceChildren(
        weatherHeading("정보 없음"),
        element("p", "home-weather-message", "날씨 정보를 잠시 확인할 수 없습니다."),
        sourceLinks(),
      );
      return;
  }
}

export function createHomeWeather(): HTMLElement {
  const panel = element("section", "home-weather");
  panel.setAttribute("aria-label", "현재 날씨");
  panel.setAttribute("aria-live", "polite");
  renderPanel(panel, { kind: "loading" });
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      if (!panel.isConnected) return;
      void loadCurrentWeather().then(
        (weather) => {
          if (panel.isConnected) renderPanel(panel, { kind: "ready", weather });
        },
        () => {
          if (panel.isConnected) renderPanel(panel, { kind: "unavailable" });
        },
      );
    }, 0);
  });
  return panel;
}
