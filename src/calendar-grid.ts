import type { Race } from "./contract.js";
import { raceHref } from "./race-link.js";

const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"] as const;

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

export function localDate(value: string): Date {
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

function renderRace(race: Race): HTMLAnchorElement {
  const link = element("a", `race status-${escapeCss(race.registrationStatus)}`);
  link.href = raceHref(race);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute(
    "aria-label",
    `${race.name}, ${race.eventDate}, ${race.venue}, ${formatStatus(race.registrationStatus)}`,
  );
  link.append(
    element("strong", undefined, race.name),
    element("span", undefined, `${race.venue} · ${formatStatus(race.registrationStatus)}`),
  );
  return link;
}

export function renderGrid(year: number, month: number, monthRaces: readonly Race[]): HTMLElement {
  const grid = element("div", "calendar-grid");
  for (const weekday of weekdayNames) grid.append(element("div", "weekday", weekday));
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  for (let index = 0; index < first.getDay(); index += 1) grid.append(element("div"));
  for (let day = 1; day <= days; day += 1) {
    const cell = element("section", "day-cell");
    cell.setAttribute("aria-label", `${month + 1}월 ${day}일`);
    cell.append(element("span", "day-number", String(day)));
    const dayRaces = monthRaces.filter((race) => localDate(race.eventDate).getDate() === day);
    if (dayRaces.length === 0) cell.classList.add("is-empty");
    for (const race of dayRaces) cell.append(renderRace(race));
    grid.append(cell);
  }
  return grid;
}
