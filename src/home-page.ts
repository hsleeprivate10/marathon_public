import type { Race } from "./contract.js";
import { icon } from "./home-art.js";
import "./home.css";
import { bindHomepageMenu } from "./home-menu.js";
import { createRaceSelectors, formatRaceMonth } from "./home-month-selector.js";
import { createRaceRow } from "./home-race-row.js";
import { createHomeWeather } from "./home-weather.js";
import { groupRacesByMonth } from "./page-model.js";
import { failedSourceNames } from "./source-labels.js";

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

function createVisualFilters(): HTMLElement {
  const panel = element("section", "home-filter-panel");
  panel.setAttribute("aria-labelledby", "home-filter-heading");
  const heading = element("div", "home-filter-heading");
  const title = element("h2", undefined, "대회 빠른 찾기");
  title.id = "home-filter-heading";
  heading.append(title, element("p", undefined, "화면 검토용이며 아직 동작하지 않습니다."));
  panel.append(heading);

  const controls = element("div", "home-filter-controls");
  const filterOptions = [
    ["지역", "전체 지역"],
    ["코스", "전체 코스"],
    ["접수 상태", "전체 상태"],
  ] as const;
  for (const [labelText, optionText] of filterOptions) {
    const label = element("label", "home-filter-field");
    label.append(element("span", undefined, labelText));
    const select = element("select");
    select.disabled = true;
    select.setAttribute("aria-description", "미리보기 전용 필터");
    select.append(new Option(optionText, ""));
    label.append(select);
    controls.append(label);
  }
  const reset = element("button", "home-filter-reset", "초기화");
  reset.type = "button";
  reset.disabled = true;
  controls.append(reset);
  panel.append(controls);
  return panel;
}

export function createHomepage(
  races: readonly Race[],
  generatedAt: string,
  failedSourceIds: readonly string[],
): HTMLElement {
  const page = element("div", "home-page");
  const skipLink = element("a", "home-skip-link", "대회 목록으로 건너뛰기");
  skipLink.href = "#home-races";

  const header = element("header", "home-header");
  const headerInner = element("div", "home-header-inner");
  const brand = element("a", "home-brand");
  brand.href = "#";
  brand.setAttribute("aria-label", "마라톤 캘린더 홈");
  const brandImage = element("img", "home-brand-image");
  brandImage.alt = "";
  brandImage.setAttribute("aria-hidden", "true");
  brandImage.width = 237;
  brandImage.height = 256;
  brandImage.src = new URL(
    "logo2.png",
    new URL(import.meta.env.BASE_URL ?? "./", window.location.href),
  ).href;
  brand.append(brandImage);
  const menuToggle = element("button", "home-menu-toggle", "메뉴");
  menuToggle.type = "button";
  menuToggle.setAttribute("aria-controls", "home-header-menu");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "주요 메뉴 열기");
  const menuPanel = element("div", "home-header-menu");
  menuPanel.id = "home-header-menu";
  const navigation = element("nav", "home-nav");
  navigation.setAttribute("aria-label", "주요 메뉴");
  const homeLink = element("a", undefined, "대회 찾기");
  homeLink.href = "#home-races";
  homeLink.setAttribute("aria-current", "page");
  const calendarLink = element("a", undefined, "월간 캘린더");
  calendarLink.href = "#/calendar";
  navigation.append(homeLink, calendarLink);
  const searchLabel = element("label", "home-header-search");
  const searchText = element("span", "home-header-search-label", "대회 검색");
  const searchInput = element("input", "home-header-search-input");
  searchInput.type = "search";
  searchInput.placeholder = "검색 기능 준비 중";
  searchInput.value = "검색 기능 준비 중";
  searchInput.readOnly = true;
  searchInput.setAttribute("aria-readonly", "true");
  searchInput.setAttribute("aria-describedby", "home-header-search-note");
  const searchNote = element("span", "home-header-search-note", "검색 기능 준비 중");
  searchNote.id = "home-header-search-note";
  searchLabel.append(searchText, searchInput, searchNote);
  menuPanel.append(navigation, searchLabel);
  headerInner.append(brand, menuToggle, menuPanel);
  header.append(headerInner);
  bindHomepageMenu(page, menuToggle, menuPanel);

  const main = element("main", "home-main");
  const hero = element("section", "home-hero");
  const heroInner = element("div", "home-hero-inner");
  const copy = element("div", "home-hero-copy");
  copy.append(element("p", "home-eyebrow", "2026 KOREA RACE GUIDE"), createHomeWeather());
  const cta = element("a", "home-calendar-cta");
  cta.href = "#/calendar";
  cta.append(icon("calendar"), document.createTextNode("캘린더로 보기"));
  copy.append(cta);
  const heroVisual = element("div", "home-hero-visual");
  const heroImage = element("img", "home-hero-art");
  heroImage.alt = "";
  heroImage.setAttribute("aria-hidden", "true");
  heroImage.width = 237;
  heroImage.height = 256;
  heroImage.decoding = "async";
  heroImage.fetchPriority = "high";
  heroImage.src = new URL(
    "logo2.png",
    new URL(import.meta.env.BASE_URL ?? "./", window.location.href),
  ).href;
  heroVisual.append(heroImage);
  heroInner.append(copy, heroVisual);
  hero.append(heroInner);
  main.append(hero);

  const content = element("div", "home-content");
  content.append(createVisualFilters());
  const raceContainer = element("div", "home-races");
  raceContainer.id = "home-races";
  raceContainer.tabIndex = -1;
  const groups = groupRacesByMonth(races);
  const intro = element("div", "home-races-intro");
  intro.append(
    element("p", "home-eyebrow", "RACE CALENDAR"),
    element("h2", undefined, "월별 전체 대회"),
  );
  const freshness = element("p", "home-freshness");
  const updated = element("time");
  updated.dateTime = generatedAt;
  updated.textContent = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(generatedAt));
  freshness.append("데이터 갱신 ", updated);
  const failureNames = failedSourceNames(failedSourceIds);
  if (failureNames.length > 0) {
    freshness.classList.add("is-partial");
    freshness.setAttribute("role", "status");
    freshness.append(` · 일부 출처 확인 지연: ${failureNames.join(", ")}`);
  }
  const tools = element("div", "home-races-tools");
  tools.append(createRaceSelectors(groups), freshness);
  intro.append(tools);
  raceContainer.append(intro);

  if (groups.length === 0)
    raceContainer.append(element("p", "home-empty", "표시할 대회가 없습니다."));
  for (const group of groups) {
    const section = element("section", "home-month");
    section.dataset.month = group.month;
    const headingId = `home-month-${group.month}`;
    section.setAttribute("aria-labelledby", headingId);
    const headingRow = element("div", "home-month-heading");
    const monthHeading = element("h3", undefined, formatRaceMonth(group.month));
    monthHeading.id = headingId;
    monthHeading.tabIndex = -1;
    const monthCount = element("p", "home-month-count", `${group.races.length}개 대회`);
    monthCount.setAttribute("aria-live", "polite");
    headingRow.append(monthHeading, monthCount);
    const list = element("ul", "home-race-list");
    for (const race of group.races) list.append(createRaceRow(race));
    section.append(headingRow, list);
    raceContainer.append(section);
  }
  content.append(raceContainer);
  main.append(content);

  const skipToRaces = (event: MouseEvent): void => {
    event.preventDefault();
    raceContainer.focus();
    raceContainer.scrollIntoView({ block: "start" });
  };
  skipLink.addEventListener("click", skipToRaces);
  homeLink.addEventListener("click", skipToRaces);

  page.append(skipLink, header, main);
  return page;
}
