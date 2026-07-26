import type { Course } from "../contract.js";
import { isValidIsoDate } from "../contract.js";
import { canonicalCourses } from "../courses.js";
import { type RaceLogoCandidate, parseRaceLogoCandidates } from "../race-logo-candidates.js";
import { safeApplicationUrl } from "./application-url-policy.js";
import { scanHtmlAnchors } from "./html-anchors.js";
import { type OfficialJsonLdEvent, parseJsonLdEvents } from "./jsonld-events.js";

export type OfficialPageData = {
  readonly names: readonly string[];
  readonly eventDate: string | null;
  readonly eventDates: readonly string[];
  readonly venue: string | null;
  readonly registrationDeadline: string | null;
  readonly courses: readonly Course[];
  readonly registrationUrl: string | null;
  readonly logoCandidates?: readonly RaceLogoCandidate[];
  readonly events?: readonly OfficialJsonLdEvent[];
  readonly bodyNames?: readonly string[];
  readonly bodyEventDates?: readonly string[];
  readonly bodyVenue?: string | null;
  readonly bodyRegistrationDeadline?: string | null;
  readonly bodyCourses?: readonly Course[];
  readonly bodyRegistrationUrl?: string | null;
};

type RawCourse = {
  readonly name: string;
  readonly price: number | null;
  readonly priceSource: Course["priceSource"];
};

const labelPatterns = {
  venue: /(?:장소|대회장소|집결지|행사장)\s*[:：]?\s*([^\n\r<]+)/,
  deadline: /(?:접수마감|신청마감|등록마감|접수기간|신청기간)\s*[:：]?\s*([^\n\r<]+)/,
  eventDate: /(?:대회일시|대회일|일시|행사일)\s*[:：]?\s*([^\n\r<]+)/,
  courses: /(?:참가종목 및 참가비|참가종목|참가비|종목|코스)\s*[:：]?\s*([^\n\r<]+)/,
} as const;

export function parseOfficialPage(html: string, pageUrl: string): OfficialPageData {
  const events = parseJsonLdEvents(html);
  const text = htmlToLabeledText(html);
  const bodyNames = unique([tagText(html, "h1"), tagText(html, "title")]);
  const names = unique([...events.map((event) => event.name), ...bodyNames]);
  const courseText = matchLabel(text, labelPatterns.courses);
  const bodyCourses = parseCourses(courseText, "body-text");
  const bodyEventDates = unique(matchLabels(text, labelPatterns.eventDate).map(parseDate));
  const firstEvent = events[0];
  const eventDate = firstEvent?.eventDate ?? bodyEventDates[0] ?? null;
  const eventDates = unique([...events.map((event) => event.eventDate), ...bodyEventDates]);
  const bodyVenue = cleanValue(matchLabel(text, labelPatterns.venue));
  const bodyDeadline = parseDate(matchLabel(text, labelPatterns.deadline));
  const bodyRegistrationUrl = findRegistrationUrl(html, pageUrl);
  return {
    names,
    eventDate,
    eventDates,
    venue: firstEvent?.venue ?? bodyVenue,
    registrationDeadline: firstEvent?.registrationDeadline ?? bodyDeadline,
    courses: mergeCourses(firstEvent?.courses ?? [], bodyCourses),
    registrationUrl: firstEvent?.registrationUrl ?? bodyRegistrationUrl,
    logoCandidates: parseRaceLogoCandidates(html, pageUrl),
    events,
    bodyNames,
    bodyEventDates,
    bodyVenue,
    bodyRegistrationDeadline: bodyDeadline,
    bodyCourses,
    bodyRegistrationUrl,
  };
}

function htmlToLabeledText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(?:tr|p|li|dt|dd|th|td|div|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " "),
  );
}

function tagText(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i").exec(html);
  return cleanValue(match?.[1]?.replace(/<[^>]+>/g, " ") ?? null);
}

function matchLabel(text: string, pattern: RegExp): string | null {
  return matchLabels(text, pattern)[0] ?? null;
}

function matchLabels(text: string, pattern: RegExp): string[] {
  const lines = text
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const label = labelSource(pattern);
  const exact = new RegExp(`^(?:${label})$`);
  const inline = new RegExp(`^(?:${label})(?:\\s*[:：]|\\s+)(.+)$`);
  return lines
    .flatMap((line, index) => {
      if (exact.test(line)) return [lines[index + 1]];
      const value = inline.exec(line)?.[1];
      return value === undefined ? [] : [value];
    })
    .map((value) => cleanValue(value))
    .filter(isString);
}

function labelSource(pattern: RegExp): string {
  const source = pattern.source;
  return source.slice(3, source.indexOf(")\\s*"));
}

function parseCourses(value: string | null, priceSource: Course["priceSource"]): Course[] {
  if (value === null) return [];
  const raw: RawCourse[] = [];
  const course = /(풀코스|풀|하프코스|하프|half|10\s*k(?:m)?|5\s*k(?:m)?)/gi;
  const matches = [...value.matchAll(course)];
  for (const [index, match] of matches.entries()) {
    const next = matches[index + 1]?.index ?? value.length;
    const tail = value.slice(match.index + match[0].length, next).split(/[\/]/)[0] ?? "";
    raw.push({ name: match[1] ?? "", price: parsePrice(tail, true), priceSource });
  }
  return canonicalCourses(raw);
}

function mergeCourses(primary: readonly Course[], secondary: readonly Course[]): Course[] {
  const merged = new Map<Course["name"], Course>();
  for (const course of [...primary, ...secondary]) {
    const existing = merged.get(course.name);
    if (existing === undefined || (existing.price === null && course.price !== null))
      merged.set(course.name, course);
  }
  return [...merged.values()];
}

function findRegistrationUrl(html: string, pageUrl: string): string | null {
  for (const anchor of scanHtmlAnchors(html)) {
    const label = decodeEntities(anchor.text.replace(/<[^>]+>/g, " ")).trim();
    if (!/(참가신청|접수|신청)/.test(label)) continue;
    const safe = safeApplicationUrl(anchor.href, pageUrl);
    if (safe !== null) return safe;
  }
  return null;
}

function parseDate(value: string | null): string | null {
  if (value === null) return null;
  const matches = [
    ...value.matchAll(/(20\d{2})\s*[년.\/-]\s*(\d{1,2})\s*(?:월|[.\/-])\s*(\d{1,2})/g),
  ];
  const last = matches.at(-1);
  if (last === undefined) return null;
  const iso = `${last[1]}-${pad(last[2])}-${pad(last[3])}`;
  return isValidIsoDate(iso) ? iso : null;
}

function parsePrice(value: unknown, requireCurrency: boolean): number | null {
  const text = stringValue(value);
  if (text === null) return null;
  const match = requireCurrency
    ? /([0-9][0-9,]*)\s*(?:원|KRW)/i.exec(text)
    : /([0-9][0-9,]*)\s*(?:원|KRW)?/i.exec(text);
  const freeIndex = text.search(/무료/);
  if (freeIndex >= 0 && (match?.index === undefined || freeIndex < match.index)) return 0;
  if (match?.[1] !== undefined) return Number(match[1].replaceAll(",", ""));
  return null;
}

function cleanValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length === 0 ? null : cleaned;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function unique(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter(isString))];
}

function isString(value: string | null | undefined): value is string {
  return value !== null && value !== undefined;
}

function pad(value: string | undefined): string {
  return (value ?? "").padStart(2, "0");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
