import ky from "ky";
import { CollectionOutputSchema, type Race } from "./contract.js";
import "./style.css";

type Filters = {
  readonly region: string;
  readonly distance: string;
  readonly status: string;
};

const monthNames = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
] as const;
const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"] as const;
const courseNames = ["풀", "하프", "10K", "5K"] as const;

const calendar = requireElement("calendar");
const heading = requireElement("month-heading");
const count = requireElement("result-count");
const freshness = requireElement("freshness");
const regionSelect = requireSelect("region-filter");
const distanceSelect = requireSelect("distance-filter");
const statusSelect = requireSelect("status-filter");
let shownMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let races: readonly Race[] = [];

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id}`);
  return element;
}

function requireSelect(id: string): HTMLSelectElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`#${id} must be a select`);
  return element;
}

function text(value: string): Text {
  return document.createTextNode(value);
}

function localDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function escapeCss(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function formatStatus(status: Race["registrationStatus"]): string {
  const labels = {
    open: "접수 중",
    "closing-soon": "마감 임박",
    closed: "접수 마감",
    unknown: "정보 확인 필요",
  } as const;
  return labels[status];
}

function activeFilters(): Filters {
  return { region: regionSelect.value, distance: distanceSelect.value, status: statusSelect.value };
}

function filteredRaces(): readonly Race[] {
  const filters = activeFilters();
  return races.filter((race) => {
    const hasDistance =
      filters.distance === "" || race.courses.some((course) => course.name === filters.distance);
    return (
      (filters.region === "" || race.region === filters.region) &&
      hasDistance &&
      (filters.status === "" || race.registrationStatus === filters.status)
    );
  });
}

function renderCalendar(): void {
  const year = shownMonth.getFullYear();
  const month = shownMonth.getMonth();
  heading.textContent = `${year}년 ${monthNames[month]}`;
  const selected = filteredRaces();
  const monthRaces = selected.filter((race) => {
    const date = localDate(race.eventDate);
    return date.getFullYear() === year && date.getMonth() === month;
  });
  count.textContent = `${monthRaces.length}개 대회`;
  calendar.replaceChildren(renderGrid(year, month, monthRaces));
}

function renderGrid(year: number, month: number, monthRaces: readonly Race[]): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  for (const weekday of weekdayNames) {
    const label = document.createElement("div");
    label.className = "weekday";
    label.textContent = weekday;
    grid.append(label);
  }
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  for (let index = 0; index < first.getDay(); index += 1)
    grid.append(document.createElement("div"));
  for (let day = 1; day <= days; day += 1) {
    const cell = document.createElement("section");
    cell.className = "day-cell";
    cell.setAttribute("aria-label", `${month + 1}월 ${day}일`);
    const dayLabel = document.createElement("span");
    dayLabel.className = "day-number";
    dayLabel.textContent = String(day);
    cell.append(dayLabel);
    const dayRaces = monthRaces.filter((race) => localDate(race.eventDate).getDate() === day);
    for (const race of dayRaces) cell.append(renderRace(race));
    grid.append(cell);
  }
  return grid;
}

function renderRace(race: Race): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = `race status-${escapeCss(race.registrationStatus)}`;
  link.href = race.applicationUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.setAttribute(
    "aria-label",
    `${race.name}, ${race.venue}, ${formatStatus(race.registrationStatus)}`,
  );
  const name = document.createElement("strong");
  name.textContent = race.name;
  const meta = document.createElement("span");
  meta.textContent = `${race.venue} · ${formatStatus(race.registrationStatus)}`;
  link.append(name, meta);
  return link;
}

function populateFilters(): void {
  const regions = [
    ...new Set(races.flatMap((race) => (race.region === undefined ? [] : [race.region]))),
  ].sort();
  const availableCourses = new Set(
    races.flatMap((race) => race.courses.map((course) => course.name)),
  );
  for (const region of regions) regionSelect.append(new Option(region, region));
  for (const course of courseNames)
    if (availableCourses.has(course)) distanceSelect.append(new Option(course, course));
}

function renderFreshness(generatedAt: string, failures: readonly string[]): void {
  const date = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(generatedAt),
  );
  freshness.replaceChildren(text(`마지막 수집: ${date}`));
  if (failures.length > 0) {
    freshness.classList.add("is-partial");
    freshness.setAttribute("role", "status");
    freshness.append(text(` · 일부 출처 확인 실패: ${failures.join(", ")}`));
  }
}

async function load(): Promise<void> {
  const raw = await ky
    .get(`${import.meta.env.BASE_URL}races.json`, { retry: { limit: 1 }, timeout: 10_000 })
    .json();
  const output = CollectionOutputSchema.parse(raw);
  races = output.races;
  populateFilters();
  renderFreshness(
    output.generatedAt,
    output.collectionMetadata.filter((source) => !source.succeeded).map((source) => source.id),
  );
  renderCalendar();
}

function bindControls(): void {
  document.getElementById("previous-month")?.addEventListener("click", () => {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("next-month")?.addEventListener("click", () => {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById("reset-filters")?.addEventListener("click", () => {
    regionSelect.value = "";
    distanceSelect.value = "";
    statusSelect.value = "";
    renderCalendar();
  });
  for (const select of [regionSelect, distanceSelect, statusSelect])
    select.addEventListener("change", renderCalendar);
}

bindControls();
void load().catch((error: unknown) => {
  calendar.textContent =
    error instanceof Error ? error.message : "일정 데이터를 불러오지 못했습니다.";
});
