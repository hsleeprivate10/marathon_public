import { raceSelectionOptions, visibleRaceMonths } from "./home-race-selection.js";
import type { RaceMonthGroup } from "./page-model.js";

const monthFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
});

const monthOnlyFormatter = new Intl.DateTimeFormat("ko-KR", { month: "long" });

export function formatRaceMonth(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00`));
}

function labelledSelect(labelText: string): {
  readonly label: HTMLLabelElement;
  readonly select: HTMLSelectElement;
} {
  const label = document.createElement("label");
  label.className = "home-race-selector";
  const text = document.createElement("span");
  text.textContent = labelText;
  const select = document.createElement("select");
  label.append(text, select);
  return { label, select };
}

function monthLabel(month: string): string {
  return monthOnlyFormatter.format(new Date(`2000-${month}-01T00:00:00`));
}

export function createRaceSelectors(groups: readonly RaceMonthGroup[]): HTMLDivElement {
  const controls = document.createElement("div");
  controls.className = "home-race-selector-controls";
  const yearField = labelledSelect("대회 연도 선택");
  const monthField = labelledSelect("대회 월 선택");
  const raceMonths = groups.map((group) => group.month);
  const options = raceSelectionOptions(raceMonths, "");

  if (groups.length === 0) {
    yearField.select.disabled = true;
    yearField.select.append(new Option("선택할 대회 연도가 없습니다", ""));
    monthField.select.disabled = true;
    monthField.select.append(new Option("선택할 대회 월이 없습니다", ""));
  } else {
    yearField.select.append(new Option("전체 연도", ""));
    for (const year of options.years) yearField.select.append(new Option(`${year}년`, year));
    monthField.select.append(new Option("전체 월", ""));
    for (const month of options.months)
      monthField.select.append(new Option(monthLabel(month), month));
  }

  const applySelection = (focusHeading: boolean): void => {
    const visibleMonths = visibleRaceMonths(raceMonths, {
      year: yearField.select.value,
      month: monthField.select.value,
    });
    const visibleMonthSet = new Set(visibleMonths);
    for (const section of document.querySelectorAll<HTMLElement>("section.home-month")) {
      const raceMonth = section.dataset.month;
      section.hidden = raceMonth === undefined || !visibleMonthSet.has(raceMonth);
    }
    if (!focusHeading) return;
    const firstVisibleMonth = visibleMonths[0];
    if (firstVisibleMonth === undefined) return;
    document.getElementById(`home-month-${firstVisibleMonth}`)?.focus();
  };

  yearField.select.addEventListener("change", () => {
    monthField.select.replaceChildren(new Option("전체 월", ""));
    const yearOptions = raceSelectionOptions(raceMonths, yearField.select.value);
    for (const month of yearOptions.months)
      monthField.select.append(new Option(monthLabel(month), month));
    applySelection(yearField.select.value !== "");
  });
  monthField.select.addEventListener("change", () => {
    applySelection(monthField.select.value !== "");
  });

  controls.append(yearField.label, monthField.label);
  return controls;
}
