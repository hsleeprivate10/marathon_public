import { parseFragment } from "parse5";
import type { Course } from "../contract.js";
import { isValidIsoDate } from "../contract.js";
import { canonicalCourses } from "../courses.js";

export type JsonLdDateStatus =
  | { readonly kind: "absent" }
  | { readonly kind: "valid"; readonly value: string }
  | { readonly kind: "invalid"; readonly raw: string };

export interface OfficialJsonLdEvent {
  readonly name: string | null;
  readonly eventDate: string | null;
  readonly eventDateStatus: JsonLdDateStatus;
  readonly venue: string | null;
  readonly registrationDeadline: string | null;
  readonly courses: readonly Course[];
  readonly registrationUrl: string | null;
}

type AstNode = {
  readonly nodeName?: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly attrs?: readonly Attribute[];
  readonly childNodes?: readonly AstNode[];
};

type Attribute = { readonly name: string; readonly value: string };
type RawCourse = {
  readonly name: string;
  readonly price: number | null;
  readonly priceSource: Course["priceSource"];
};

const EVENT_TYPES = new Set(["Event", "http://schema.org/Event", "https://schema.org/Event"]);

export function parseJsonLdEvents(html: string): readonly OfficialJsonLdEvent[] {
  return parseJsonLdDocuments(html).flatMap((value) =>
    flattenJson(value).filter(isEvent).map(eventFromRecord),
  );
}

export function parseJsonLdDocuments(html: string): readonly unknown[] {
  const fragment = parseFragment(html) as AstNode;
  return scriptTexts(fragment.childNodes ?? []).flatMap((text) => {
    const parsed = parseJson(decodeEntities(text));
    return parsed === undefined ? [] : [parsed];
  });
}

function scriptTexts(nodes: readonly AstNode[]): string[] {
  const texts: string[] = [];
  for (const node of nodes) {
    if (node.tagName === "script" && attr(node, "type") === "application/ld+json") {
      texts.push(textContent(node.childNodes ?? []));
      continue;
    }
    texts.push(...scriptTexts(node.childNodes ?? []));
  }
  return texts;
}

function eventFromRecord(record: Record<string, unknown>): OfficialJsonLdEvent {
  const eventDateStatus = parseEventDateStatus(record);
  const deadline = parseJsonLdDate(stringValue(record.registrationDeadline));
  return {
    name: stringValue(record.name),
    eventDate: eventDateStatus.kind === "valid" ? eventDateStatus.value : null,
    eventDateStatus,
    venue: parseLocation(record.location),
    registrationDeadline: deadline.kind === "valid" ? deadline.value : null,
    courses: parseOffers(record.offers),
    registrationUrl: stringValue(record.registrationUrl) ?? stringValue(record.applicationUrl),
  };
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function flattenJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJson);
  if (!isRecord(value)) return [];
  return [value, ...flattenJson(value["@graph"])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isJsonLdEventType(value: unknown): boolean {
  if (typeof value === "string") return EVENT_TYPES.has(value);
  return (
    Array.isArray(value) && value.some((item) => typeof item === "string" && EVENT_TYPES.has(item))
  );
}

function isEvent(value: Record<string, unknown>): boolean {
  return isJsonLdEventType(value["@type"]);
}

function parseOffers(offers: unknown): Course[] {
  const list = Array.isArray(offers) ? offers : offers === undefined ? [] : [offers];
  const raw: RawCourse[] = [];
  for (const offer of list) {
    if (!isRecord(offer)) continue;
    const name = stringValue(offer.name) ?? stringValue(offer.category) ?? "";
    raw.push({ name, price: parsePrice(offer.price), priceSource: "structured" });
  }
  return canonicalCourses(raw);
}

function parseLocation(location: unknown): string | null {
  if (typeof location === "string") return cleanValue(location);
  if (!isRecord(location)) return null;
  return cleanValue(stringValue(location.name) ?? stringValue(location.address));
}

function parsePrice(value: unknown): number | null {
  const text = stringValue(value);
  const match = text === null ? null : /([0-9][0-9,]*)\s*(?:원|KRW)?/i.exec(text);
  return match?.[1] === undefined ? null : Number(match[1].replaceAll(",", ""));
}

function parseEventDateStatus(record: Record<string, unknown>): JsonLdDateStatus {
  const startDate = stringValue(record.startDate);
  if (startDate !== null) return parseJsonLdDate(startDate);
  return parseJsonLdDate(stringValue(record.eventDate));
}

function parseJsonLdDate(value: string | null): JsonLdDateStatus {
  if (value === null) return { kind: "absent" };
  if (isPlaceholder(value)) return { kind: "absent" };
  const date = parseIsoDateOrDateTime(value);
  return date === null ? { kind: "invalid", raw: value } : { kind: "valid", value: date };
}

function isPlaceholder(value: string): boolean {
  const text = value.trim().replace(/\s+/gu, " ").toLowerCase();
  return text === "tbd" || text === "tba" || text === "추후 공지" || text === "추후공지";
}

function parseIsoDateOrDateTime(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return isValidIsoDate(value) ? value : null;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/u.exec(
      value,
    );
  if (match === null) return null;
  const [, date, hour, minute, second = "00"] = match;
  if (date === undefined || !isValidIsoDate(date)) return null;
  if (!validRange(hour, 0, 23) || !validRange(minute, 0, 59) || !validRange(second, 0, 59)) {
    return null;
  }
  const offset = /([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (offset !== null && !validOffset(offset[2], offset[3])) return null;
  return date;
}

function validOffset(hour: string | undefined, minute: string | undefined): boolean {
  if (!validRange(hour, 0, 14) || !validRange(minute, 0, 59)) return false;
  return hour !== "14" || minute === "00";
}

function validRange(value: string | undefined, min: number, max: number): boolean {
  if (value === undefined) return false;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= min && numeric <= max;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function textContent(nodes: readonly AstNode[]): string {
  return nodes.map((node) => node.value ?? textContent(node.childNodes ?? [])).join("");
}

function attr(node: AstNode, name: string): string | undefined {
  return node.attrs?.find((item) => item.name === name)?.value;
}

function cleanValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length === 0 ? null : cleaned;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
