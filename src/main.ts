import ky from "ky";
import type {
  CollectionOutput,
  Course,
  Race,
  RegistrationStatus,
  SourceRecord,
} from "./contract.js";
import { parsePageRoute } from "./page-model.js";
import { safeRaceLogoUrl } from "./race-logo-url.js";

const appElement = document.getElementById("app");
if (appElement === null) throw new Error("Missing #app");
const app = appElement;

type AppState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly output: CollectionOutput }
  | { readonly kind: "error" };

let state: AppState = { kind: "loading" };
let routeRenderId = 0;

type PriceSource = "structured" | "body-text";

function readObject(value: unknown): object {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  throw new Error("Invalid collection object");
}

function readField(source: object, key: string): unknown {
  return Reflect.get(source, key);
}

function readStringValue(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error("Invalid collection string");
}

function readString(source: object, key: string): string {
  return readStringValue(readField(source, key));
}

function readOptionalString(source: object, key: string): string | undefined {
  const value = readField(source, key);
  if (value === undefined) return undefined;
  return readStringValue(value);
}

function readNullableString(source: object, key: string): string | null {
  const value = readField(source, key);
  if (value === null) return null;
  return readStringValue(value);
}

function readBoolean(source: object, key: string): boolean {
  const value = readField(source, key);
  if (typeof value === "boolean") return value;
  throw new Error("Invalid collection boolean");
}

function readNumber(source: object, key: string): number {
  const value = readField(source, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Invalid collection number");
}

function readStringArray(source: object, key: string): string[] {
  const value = readField(source, key);
  if (!Array.isArray(value)) throw new Error("Invalid collection array");
  return value.map(readStringValue);
}

function parseCourseName(value: unknown): Course["name"] {
  switch (value) {
    case "풀":
    case "하프":
    case "10K":
    case "5K":
      return value;
    default:
      throw new Error("Invalid course name");
  }
}

function parsePriceSource(value: unknown): PriceSource | undefined {
  switch (value) {
    case undefined:
      return undefined;
    case "structured":
    case "body-text":
      return value;
    default:
      throw new Error("Invalid course price source");
  }
}

function parseRegistrationStatus(value: unknown): RegistrationStatus {
  switch (value) {
    case "open":
    case "closing-soon":
    case "closed":
    case "unknown":
      return value;
    default:
      throw new Error("Invalid registration status");
  }
}

function parseCourse(value: unknown): Course {
  const course = readObject(value);
  const price = readField(course, "price");
  if (price !== null && (typeof price !== "number" || !Number.isFinite(price)))
    throw new Error("Invalid course price");
  const priceSource = parsePriceSource(readField(course, "priceSource"));
  return {
    name: parseCourseName(readField(course, "name")),
    price,
    ...(priceSource === undefined ? {} : { priceSource }),
  };
}

function parseCourses(source: object): Course[] {
  const value = readField(source, "courses");
  if (!Array.isArray(value)) throw new Error("Invalid courses array");
  return value.map(parseCourse);
}

function parseRace(value: unknown): Race {
  const race = readObject(value);
  const region = readOptionalString(race, "region");
  const officialSiteUrl = readOptionalString(race, "officialSiteUrl");
  const rawLogoUrl = readOptionalString(race, "logoUrl");
  const notes = readOptionalString(race, "notes");
  const logoUrl = rawLogoUrl === undefined ? undefined : safeRaceLogoUrl(rawLogoUrl);
  if (logoUrl === null) throw new Error("Invalid race logo URL");
  return {
    name: readString(race, "name"),
    eventDate: readString(race, "eventDate"),
    registrationDeadline: readNullableString(race, "registrationDeadline"),
    venue: readString(race, "venue"),
    ...(region === undefined ? {} : { region }),
    courses: parseCourses(race),
    applicationUrl: readString(race, "applicationUrl"),
    ...(officialSiteUrl === undefined ? {} : { officialSiteUrl }),
    ...(logoUrl === undefined ? {} : { logoUrl }),
    ...(notes === undefined ? {} : { notes }),
    sources: readStringArray(race, "sources"),
    verified: readBoolean(race, "verified"),
    lastVerified: readNullableString(race, "lastVerified"),
    updatedAt: readString(race, "updatedAt"),
    generatedAt: readString(race, "generatedAt"),
    registrationStatus: parseRegistrationStatus(readField(race, "registrationStatus")),
  };
}

function parseSourceRecord(value: unknown): SourceRecord {
  const source = readObject(value);
  return {
    id: readString(source, "id"),
    attempted: readBoolean(source, "attempted"),
    succeeded: readBoolean(source, "succeeded"),
    recordCount: readNumber(source, "recordCount"),
    message: readString(source, "message"),
  };
}

function parseClientCollectionOutput(raw: unknown): CollectionOutput {
  const output = readObject(raw);
  const races = readField(output, "races");
  const collectionMetadata = readField(output, "collectionMetadata");
  if (!Array.isArray(races) || !Array.isArray(collectionMetadata))
    throw new Error("Invalid collection arrays");
  return {
    generatedAt: readString(output, "generatedAt"),
    races: races.map(parseRace),
    collectionMetadata: collectionMetadata.map(parseSourceRecord),
  };
}

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

async function renderRoute(): Promise<void> {
  const renderId = ++routeRenderId;
  const route = parsePageRoute(window.location.hash);
  if (state.kind === "loading") return;
  if (route === "calendar") {
    const { createCalendarPage } = await import("./calendar-page.js");
    if (renderId !== routeRenderId) return;
    if (state.kind === "error") {
      app.replaceChildren(createCalendarPage([], null, ["일정 데이터"]));
      return;
    }
    const data = state.output;
    app.replaceChildren(createCalendarPage(data.races, data.generatedAt, failedSources(data)));
    return;
  }
  if (state.kind === "error") {
    app.replaceChildren(createErrorPage());
    return;
  }
  const { createHomepage } = await import("./home-page.js");
  if (renderId !== routeRenderId) return;
  const data = state.output;
  app.replaceChildren(createHomepage(data.races, data.generatedAt, failedSources(data)));
}

async function loadData(): Promise<CollectionOutput> {
  const raw = await ky
    .get(`${import.meta.env.BASE_URL}races.json`, { retry: { limit: 1 }, timeout: 10_000 })
    .json<unknown>();
  return parseClientCollectionOutput(raw);
}

window.addEventListener("hashchange", () => {
  void renderRoute();
});
void renderRoute();
void loadData()
  .then((output) => {
    state = { kind: "ready", output };
    void renderRoute();
  })
  .catch(() => {
    state = { kind: "error" };
    void renderRoute();
  });
