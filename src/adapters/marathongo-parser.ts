import { safeApplicationUrl } from "../official-sites/application-url-policy.js";
import { canonicalUrl } from "../official-sites/discovery-url-policy.js";
export { safeMarathonGoDetailUrl } from "./detail-source-url.js";
import { safeMarathonGoDetailUrl } from "./detail-source-url.js";

export const MARATHONGO_BASE_URL = "https://marathongo.co.kr";
export const MARATHONGO_LIST_URL = `${MARATHONGO_BASE_URL}/raceSchedule/domestic`;

export type MarathonGoListItem = {
  readonly detailPath: string;
  readonly detailUrl: string;
  readonly name: string;
  readonly eventDate: string;
  readonly organizer: string | null;
};

export type MarathonGoDetailEvidence = {
  readonly nameHints: readonly string[];
  readonly dateHints: readonly string[];
  readonly venueHints: readonly string[];
  readonly organizerHints: readonly string[];
  readonly applicationHrefs: readonly string[];
};

type RaceCard = {
  readonly detailPath: string;
  readonly body: string;
};

const DETAIL_PATH_PATTERN = /^\/raceDetail\/domestic\/[a-z0-9][a-z0-9-]*$/u;
const DATE_PATTERN = /(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})(?:일)?/u;

export function parseMarathonGoList(html: string): readonly MarathonGoListItem[] {
  const items: MarathonGoListItem[] = [];
  const seen = new Set<string>();
  const listHtml = scheduleListHtml(html);
  if (listHtml === null) return items;

  for (const card of raceCards(listHtml)) {
    if (seen.has(card.detailPath)) continue;
    const detailUrl = safeMarathonGoDetailUrl(card.detailPath);
    if (detailUrl === null) continue;
    const eventDate = firstDate(card.body);
    const name =
      firstText(card.body, ["race-title", "event-name", "title"]) ?? nameFromText(card.body);
    if (name === null || eventDate === null) continue;
    seen.add(card.detailPath);
    items.push({
      detailPath: card.detailPath,
      detailUrl,
      name,
      eventDate,
      organizer: firstText(card.body, ["organizer", "host"]),
    });
  }

  return items;
}

function scheduleListHtml(html: string): string | null {
  const cleanHtml = stripInertHtml(html);
  const mainStart = cleanHtml.search(/<main\b[^>]*>/iu);
  if (mainStart < 0) return null;
  const end = closeElementIndex(cleanHtml, "main", mainStart);
  return end === undefined ? null : cleanHtml.slice(mainStart, end);
}

export function parseMarathonGoDetail(html: string, detailUrl: string): MarathonGoDetailEvidence {
  const scopedHtml = ownedRaceDetailHtml(html, detailUrl);
  if (scopedHtml === null) {
    return {
      nameHints: [],
      dateHints: [],
      venueHints: [],
      organizerHints: [],
      applicationHrefs: [],
    };
  }
  const documentHtml = safeMarathonGoDetailUrl(detailUrl) === null ? "" : stripInertHtml(html);
  return {
    nameHints: unique([firstDetailName(scopedHtml, documentHtml)].flatMap(present)),
    dateHints: unique([firstDate(scopedHtml)].flatMap(present)),
    venueHints: unique([firstVenue(scopedHtml, documentHtml)].flatMap(present)),
    organizerHints: unique([firstText(scopedHtml, ["organizer", "host"])].flatMap(present)),
    applicationHrefs: applicationHrefs(scopedHtml, detailUrl),
  };
}

function firstVenue(html: string, documentHtml: string): string | null {
  const classValue = firstText(html, ["venue", "place", "location"]);
  if (classValue !== null) return classValue.replace(/^장소\s*[:：]\s*/u, "").trim();
  const value = /장소\s*[:：]\s*([^<]+)/u.exec(html)?.[1];
  if (value === undefined) return summaryVenue(documentHtml);
  const normalized = text(value);
  if (normalized !== "") return normalized;
  return summaryVenue(html);
}

function summaryVenue(html: string): string | null {
  for (const match of html.matchAll(/<meta\b([^>]*)>/giu)) {
    const attrs = match[1] ?? "";
    if (!/\b(?:name|property)="(?:description|og:description)"/iu.test(attrs)) continue;
    const content = /\bcontent="([^"]*)"/iu.exec(attrs)?.[1];
    if (content === undefined) continue;
    const parts = text(content)
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    const region = parts[2];
    const venue = parts[3];
    if (firstDate(content) === null || region === undefined || venue === undefined) continue;
    return `${region} ${venue}`.trim();
  }
  return null;
}

function firstDetailName(scopedHtml: string, documentHtml: string): string | null {
  for (const value of [
    firstText(scopedHtml, ["race-title", "event-name", "title"]),
    firstHeading(scopedHtml),
    documentTitle(documentHtml),
  ]) {
    const normalized = normalizeMarathonGoDetailName(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function normalizeMarathonGoDetailName(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s*(?:[|｜-]\s*)?마라톤\s*GO\s*$/iu, "").trim();
  return normalized === "" ? null : normalized;
}

function ownedRaceDetailHtml(html: string, detailUrl: string): string | null {
  const cleanHtml = stripInertHtml(html);
  const openPattern = /<(article|main|section|div)\b([^>]*)>/giu;
  let match = openPattern.exec(cleanHtml);
  while (match !== null) {
    const tag = match[1] ?? "";
    const attrs = match[2] ?? "";
    const end = hasRaceDetailClass(attrs)
      ? closeElementIndex(cleanHtml, tag, match.index)
      : undefined;
    if (end !== undefined) return cleanHtml.slice(match.index, end);
    match = openPattern.exec(cleanHtml);
  }
  return safeMarathonGoDetailUrl(detailUrl) === null ? null : mainHtml(cleanHtml);
}

function mainHtml(html: string): string | null {
  const mainStart = html.search(/<main\b[^>]*>/iu);
  if (mainStart < 0) return null;
  const end = closeElementIndex(html, "main", mainStart);
  return end === undefined ? null : html.slice(mainStart, end);
}

function hasRaceDetailClass(attrs: string): boolean {
  const classValue = attrs.match(/class="([^"]*)"/iu)?.[1] ?? "";
  return /\b(?:race|event)-(?:detail|info|content)\b/iu.test(classValue);
}

function closeElementIndex(html: string, tag: string, openIndex: number): number | undefined {
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "giu");
  tagPattern.lastIndex = openIndex;
  let depth = 0;
  let match = tagPattern.exec(html);
  while (match !== null) {
    if ((match[0] ?? "").startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return tagPattern.lastIndex;
    match = tagPattern.exec(html);
  }
  return undefined;
}

function stripInertHtml(html: string): string {
  return html
    .replace(/<(script|style|template|nav|footer)\b[\s\S]*?<\/\1>/giu, " ")
    .replace(
      /<(aside|section|div)\b[^>]*class="[^"]*\b(?:related|recommend)[^"]*"[^>]*>[\s\S]*?<\/\1>/giu,
      " ",
    );
}

function raceCards(html: string): readonly RaceCard[] {
  const cards: RaceCard[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const detailPath = detailPathFromHref(match[2]);
    const body = match[4] ?? "";
    if (detailPath === null) continue;
    cards.push({ detailPath, body });
  }
  return cards;
}

function detailPathFromHref(rawHref: string | undefined): string | null {
  if (rawHref === undefined) return null;
  const detailUrl = safeMarathonGoDetailUrl(rawHref);
  if (detailUrl === null) return null;
  const pathname = new URL(detailUrl).pathname;
  return DETAIL_PATH_PATTERN.test(pathname) ? pathname : null;
}

function applicationHrefs(html: string, detailUrl: string): readonly string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)) {
    const rawHref = match[1];
    if (rawHref === undefined || text(match[2] ?? "") !== "신청하기") continue;
    const canonical = canonicalUrl(rawHref, detailUrl);
    const safeUrl = canonical === undefined ? null : safeApplicationUrl(canonical);
    if (safeUrl === null || seen.has(safeUrl)) continue;
    seen.add(safeUrl);
    urls.push(safeUrl);
  }
  return urls;
}

function firstHeading(html: string): string | null {
  const value = /<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]>/iu.exec(html)?.[1];
  if (value === undefined) return null;
  const normalized = text(value);
  return normalized === "" ? null : normalized;
}

function documentTitle(html: string): string | null {
  const value = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1];
  if (value === undefined) return null;
  const normalized = text(value);
  return normalized === "" ? null : normalized;
}

function firstText(html: string, classNames: readonly string[]): string | null {
  for (const className of classNames) {
    const pattern = new RegExp(
      `<[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      "iu",
    );
    const value = pattern.exec(html)?.[1];
    if (value === undefined) continue;
    const normalized = text(value);
    if (normalized !== "") return normalized;
  }
  return null;
}

function firstDate(html: string): string | null {
  const match = DATE_PATTERN.exec(text(html));
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function nameFromText(html: string): string | null {
  const normalized = text(html).replace(DATE_PATTERN, " ").replaceAll(/\s+/gu, " ").trim();
  return normalized === "" ? null : normalized;
}

function text(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function present(value: string | null): readonly string[] {
  return value === null ? [] : [value];
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
