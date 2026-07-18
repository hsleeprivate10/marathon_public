import ky from "ky";
import { createCalendarPage } from "./calendar-page.js";
import { type CollectionOutput, CollectionOutputSchema } from "./contract.js";
import { createHomepage } from "./home-page.js";
import { parsePageRoute } from "./page-model.js";
import "./style.css";

const appElement = document.getElementById("app");
if (appElement === null) throw new Error("Missing #app");
const app = appElement;

type AppState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly output: CollectionOutput }
  | { readonly kind: "error" };

let state: AppState = { kind: "loading" };

function failedSources(output: CollectionOutput): readonly string[] {
  return output.collectionMetadata.filter((source) => !source.succeeded).map((source) => source.id);
}

function createErrorPage(): HTMLElement {
  const main = document.createElement("main");
  main.className = "data-error-page";
  const heading = document.createElement("h1");
  heading.append(
    Object.assign(document.createElement("span"), { textContent: "일정 데이터를" }),
    document.createTextNode(" "),
    Object.assign(document.createElement("span"), { textContent: "확인할 수 없습니다" }),
  );
  const message = document.createElement("p");
  message.className = "freshness is-partial";
  message.setAttribute("role", "status");
  message.textContent = "잠시 후 페이지를 새로고침해 주세요.";
  const calendarLink = document.createElement("a");
  calendarLink.className = "data-error-calendar-link";
  calendarLink.href = "#/calendar";
  calendarLink.textContent = "월간 캘린더 보기";
  main.append(heading, message, calendarLink);
  return main;
}

function renderRoute(): void {
  const route = parsePageRoute(window.location.hash);
  if (state.kind === "loading") return;
  if (state.kind === "error") {
    const page =
      route === "calendar" ? createCalendarPage([], null, ["일정 데이터"]) : createErrorPage();
    app.replaceChildren(page);
    return;
  }
  const data = state.output;
  const page =
    route === "calendar"
      ? createCalendarPage(data.races, data.generatedAt, failedSources(data))
      : createHomepage(data.races, data.generatedAt, failedSources(data));
  app.replaceChildren(page);
}

async function loadData(): Promise<CollectionOutput> {
  const raw = await ky
    .get(`${import.meta.env.BASE_URL}races.json`, { retry: { limit: 1 }, timeout: 10_000 })
    .json();
  return CollectionOutputSchema.parse(raw);
}

window.addEventListener("hashchange", renderRoute);
void loadData()
  .then((output) => {
    state = { kind: "ready", output };
    renderRoute();
  })
  .catch(() => {
    state = { kind: "error" };
    renderRoute();
  });
