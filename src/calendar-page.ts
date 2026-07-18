import { localDate, renderGrid } from "./calendar-grid.js";
import { createCalendarBranding } from "./calendar-header.js";
import type { Race } from "./contract.js";
import { type Filters, filterRaces } from "./filters.js";
import { failedSourceNames } from "./source-labels.js";
import "./calendar.css";
import "./calendar-responsive.css";

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
const courseNames = ["풀", "하프", "10K", "5K"] as const;

type FilterParts = {
  readonly panel: HTMLElement;
  readonly region: HTMLSelectElement;
  readonly distance: HTMLSelectElement;
  readonly status: HTMLSelectElement;
  readonly reset: HTMLButtonElement;
};

type SelectField = {
  readonly label: HTMLLabelElement;
  readonly select: HTMLSelectElement;
};

type CalendarParts = {
  readonly panel: HTMLElement;
  readonly previous: HTMLButtonElement;
  readonly next: HTMLButtonElement;
  readonly heading: HTMLElement;
  readonly count: HTMLElement;
  readonly calendar: HTMLElement;
};

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

function selectField(labelText: string, id: string, optionText: string): SelectField {
  const label = element("label");
  label.append(element("span", undefined, labelText));
  const select = element("select");
  select.id = id;
  select.append(new Option(optionText, ""));
  label.append(select);
  return { label, select };
}

function activeFilters(filters: FilterParts): Filters {
  return {
    region: filters.region.value,
    distance: filters.distance.value,
    status: filters.status.value,
  };
}

function populateFilters(races: readonly Race[], filters: FilterParts): void {
  const regions = [
    ...new Set(races.flatMap((race) => (race.region === undefined ? [] : [race.region]))),
  ].sort();
  const availableCourses = new Set(
    races.flatMap((race) => race.courses.map((course) => course.name)),
  );
  for (const region of regions) filters.region.append(new Option(region, region));
  for (const course of courseNames)
    if (availableCourses.has(course)) filters.distance.append(new Option(course, course));
}

function renderFreshness(
  freshness: HTMLElement,
  generatedAt: string | null,
  failures: readonly string[],
): void {
  if (generatedAt === null) {
    freshness.classList.add("is-partial");
    freshness.setAttribute("role", "status");
    freshness.replaceChildren(
      document.createTextNode(
        `일정 데이터를 불러오지 못했습니다 · 확인 실패: ${failures.join(", ")}`,
      ),
    );
    return;
  }
  const date = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(generatedAt),
  );
  freshness.replaceChildren(document.createTextNode(`마지막 수집: ${date}`));
  if (failures.length > 0) {
    freshness.classList.add("is-partial");
    freshness.setAttribute("role", "status");
    freshness.append(
      document.createTextNode(` · 일부 출처 확인 지연: ${failedSourceNames(failures).join(", ")}`),
    );
  }
}

function createFilterPanel(): FilterParts {
  const panel = element("aside", "filter-panel");
  panel.setAttribute("aria-label", "일정 필터");
  const regionField = selectField("지역", "region-filter", "전체 지역");
  const distanceField = selectField("코스", "distance-filter", "전체 코스");
  const statusField = selectField("접수 상태", "status-filter", "전체 상태");
  const { select: region } = regionField;
  const { select: distance } = distanceField;
  const { select: status } = statusField;
  for (const [value, label] of [
    ["open", "접수 중"],
    ["closing-soon", "마감 임박"],
    ["closed", "접수 마감"],
    ["unknown", "정보 확인 필요"],
  ] as const)
    status.append(new Option(label, value));
  const reset = element("button", "button-secondary", "필터 초기화");
  reset.id = "reset-filters";
  reset.type = "button";
  panel.append(
    element("h2", undefined, "필터"),
    regionField.label,
    distanceField.label,
    statusField.label,
    reset,
  );
  return { panel, region, distance, status, reset };
}

function createCalendarPanel(): CalendarParts {
  const panel = element("section", "calendar-panel");
  const nav = element("div", "month-nav");
  const previous = element("button", undefined, "이전");
  previous.id = "previous-month";
  previous.type = "button";
  previous.setAttribute("aria-label", "이전 달");
  const heading = element("h2");
  heading.id = "month-heading";
  heading.setAttribute("aria-live", "polite");
  const next = element("button", undefined, "다음");
  next.id = "next-month";
  next.type = "button";
  next.setAttribute("aria-label", "다음 달");
  nav.append(previous, heading, next);
  const count = element("p", "result-count");
  count.id = "result-count";
  const calendar = element("div");
  calendar.id = "calendar";
  calendar.tabIndex = -1;
  calendar.setAttribute("aria-live", "polite");
  panel.append(nav, count, calendar);
  return { panel, previous, next, heading, count, calendar };
}

export function createCalendarPage(
  races: readonly Race[],
  generatedAt: string | null,
  failures: readonly string[],
): HTMLElement {
  let shownMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const page = element("div", "calendar-page");
  const skipLink = element("a", "skip-link", "일정으로 건너뛰기");
  skipLink.href = "#calendar";
  const { header, hero } = createCalendarBranding();
  const main = element("main", "page-shell");
  const freshness = element("section", "freshness");
  freshness.id = "freshness";
  freshness.setAttribute("aria-live", "polite");
  const layout = element("section", "schedule-layout");
  layout.setAttribute("aria-label", "대회 일정");
  const filters = createFilterPanel();
  const calendarParts = createCalendarPanel();
  layout.append(filters.panel, calendarParts.panel);
  main.append(freshness, layout);
  page.append(skipLink, header, hero, main);

  const render = (): void => {
    const year = shownMonth.getFullYear();
    const month = shownMonth.getMonth();
    calendarParts.heading.textContent = `${year}년 ${monthNames[month]}`;
    const selected = filterRaces(races, activeFilters(filters));
    const monthRaces = selected.filter((race) => {
      const date = localDate(race.eventDate);
      return date.getFullYear() === year && date.getMonth() === month;
    });
    calendarParts.count.textContent = `${monthRaces.length}개 대회`;
    calendarParts.calendar.replaceChildren(renderGrid(year, month, monthRaces));
  };

  populateFilters(races, filters);
  renderFreshness(freshness, generatedAt, failures);
  calendarParts.previous.addEventListener("click", () => {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1);
    render();
  });
  calendarParts.next.addEventListener("click", () => {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1);
    render();
  });
  filters.reset.addEventListener("click", () => {
    filters.region.value = "";
    filters.distance.value = "";
    filters.status.value = "";
    render();
  });
  for (const select of [filters.region, filters.distance, filters.status])
    select.addEventListener("change", render);
  skipLink.addEventListener("click", (event) => {
    event.preventDefault();
    calendarParts.calendar.focus();
  });
  render();
  return page;
}
