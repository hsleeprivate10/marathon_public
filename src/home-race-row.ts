import type { Race, RegistrationStatus } from "./contract.js";
import { icon } from "./home-art.js";
import { createRaceMedia } from "./home-race-media.js";
import { raceHref } from "./race-link.js";

const statusLabels: Readonly<Record<RegistrationStatus, string>> = {
  open: "접수 중",
  "closing-soon": "마감 임박",
  closed: "접수 마감",
  unknown: "정보 확인 필요",
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

export function createRaceRow(race: Race): HTMLLIElement {
  const item = element("li", "home-race-row");
  const href = raceHref(race);
  const courseLabel = race.courses.map((course) => course.name).join(" · ") || "코스 미정";
  let link: HTMLElement;
  if (href === null) {
    link = element("span", "home-race-link");
  } else {
    const anchor = element("a", "home-race-link");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.setAttribute(
      "aria-label",
      `${race.name}, ${race.eventDate}, ${race.venue}, ${courseLabel}, ${statusLabels[race.registrationStatus]}, 공식 홈페이지 열기`,
    );
    link = anchor;
  }

  const details = element("span", "home-race-details");
  details.append(element("strong", "home-race-name", race.name));
  const metadata = element("span", "home-race-metadata");
  metadata.append(
    element("span", undefined, race.venue),
    element("span", undefined, courseLabel),
    element(
      "span",
      `home-status home-status-${race.registrationStatus}`,
      statusLabels[race.registrationStatus],
    ),
  );
  details.append(metadata);
  const actionText = href === null ? "공식 홈페이지 확인 중" : "공식 홈페이지";
  const action = element("span", "home-race-action", actionText);
  link.append(createRaceMedia(race), details, action);

  const favorite = element("button", "home-favorite");
  favorite.type = "button";
  favorite.disabled = true;
  favorite.setAttribute("aria-label", `${race.name} 즐겨찾기 기능 준비 중`);
  favorite.title = "즐겨찾기는 아직 저장되지 않습니다.";
  favorite.append(icon("heart"));
  item.append(link, favorite);
  return item;
}
