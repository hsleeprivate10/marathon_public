import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parseFragment } from "parse5";
import { type Race, isValidIsoDate } from "./contract.js";
import { normalizeRaceName } from "./normalize.js";
import { isKnownAggregatorUrl } from "./official-sites/application-url-policy.js";
import { parseJsonLdDocuments } from "./official-sites/jsonld-events.js";
import { safeRaceLogoUrl } from "./race-logo-url.js";

const LOGO_EVENT_TYPES = new Set<string>(
  "Event SportsEvent http://schema.org/Event https://schema.org/Event http://schema.org/SportsEvent https://schema.org/SportsEvent".split(
    " ",
  ),
);
const STRUCTURAL_OWNERS = new Set<string>(["article", "li", "tr", "section", "div", "main"]);
const CARD_OWNERS = new Set<string>(["article", "li", "tr"]);
const EXCLUDED_ANCESTORS = new Set<string>(["header", "nav", "footer"]);
const INERT_TEXT = new Set<string>(["script", "style", "template", "noscript"]);
const LOGO_MARKER = /logo|로고|emblem|mark/iu;

export type RaceLogoCandidate = {
  readonly url: string;
  readonly kind: "logo" | "image" | "dom";
  readonly eventDate: string | null;
  readonly identity: string | null;
  readonly aggregatorEvidence: string | null;
};

type CandidateContext = {
  readonly pageUrl: string;
  readonly eventName: string | null;
  readonly eventDate: string | null;
  readonly kind: "logo" | "image";
};

type DomWalkContext = {
  readonly pageUrl: string;
  readonly excluded: boolean;
  readonly owners: readonly DefaultTreeAdapterTypes.Element[];
};

export function parseRaceLogoCandidates(
  html: string,
  pageUrl: string,
): readonly RaceLogoCandidate[] {
  try {
    const candidates: RaceLogoCandidate[] = [];
    for (const document of parseJsonLdDocuments(html)) {
      for (const record of flattenJsonLd(document)) {
        if (!isLogoEventType(record["@type"])) continue;
        const eventName = stringValue(record.name);
        const eventDate = eventDateValue(record.startDate ?? record.eventDate);
        candidates.push(
          ...imageCandidates(record.logo, { pageUrl, eventName, eventDate, kind: "logo" }),
          ...imageCandidates(record.image, { pageUrl, eventName, eventDate, kind: "image" }),
        );
      }
    }

    const fragment = parseFragment(html);
    for (const node of defaultTreeAdapter.getChildNodes(fragment)) {
      if (defaultTreeAdapter.isElementNode(node)) {
        collectDomCandidates(node, { pageUrl, excluded: false, owners: [] }, candidates);
      }
    }
    return candidates;
  } catch (error) {
    if (error instanceof RangeError) return [];
    throw error;
  }
}

export function selectRaceLogoCandidate(
  candidates: readonly RaceLogoCandidate[],
  race: Pick<Race, "name" | "eventDate">,
): string | undefined {
  const matching = candidates.filter((candidate) => matchesRace(candidate, race));
  for (const kind of ["logo", "image", "dom"] as const) {
    const urls = new Set(
      matching.filter((candidate) => candidate.kind === kind).map(({ url }) => url),
    );
    if (urls.size > 1) return undefined;
    const selected = urls.values().next().value;
    if (typeof selected === "string") return selected;
  }
  return undefined;
}

function imageCandidates(value: unknown, context: CandidateContext): readonly RaceLogoCandidate[] {
  if (Array.isArray(value)) return value.flatMap((item) => imageCandidates(item, context));
  const object = isRecord(value) ? value : null;
  const rawUrl = typeof value === "string" ? value : imageObjectUrl(object);
  const safeUrl = safeRaceLogoUrl(rawUrl, context.pageUrl);
  if (safeUrl === null) return [];
  const metadata =
    object === null ? null : [object.name, object.caption].map(stringValue).join(" ").trim();
  if (context.kind === "image" && !LOGO_MARKER.test(`${metadata ?? ""} ${urlBasename(safeUrl)}`)) {
    return [];
  }
  return [
    {
      url: safeUrl,
      kind: context.kind,
      eventDate: context.eventDate,
      identity: context.eventName,
      aggregatorEvidence: isKnownAggregatorUrl(context.pageUrl)
        ? metadata === ""
          ? null
          : metadata
        : context.eventName,
    },
  ];
}

function collectDomCandidates(
  element: DefaultTreeAdapterTypes.Element,
  context: DomWalkContext,
  candidates: RaceLogoCandidate[],
): void {
  const tagName = defaultTreeAdapter.getTagName(element).toLowerCase();
  const excluded = context.excluded || EXCLUDED_ANCESTORS.has(tagName);
  const owners = STRUCTURAL_OWNERS.has(tagName) ? [...context.owners, element] : context.owners;
  if (tagName === "img" && !excluded) {
    const association = [attribute(element, "alt"), attribute(element, "title")].join(" ").trim();
    const markerText = [
      association,
      attribute(element, "class"),
      attribute(element, "id"),
      attribute(element, "src"),
    ].join(" ");
    const reversedOwners = [...owners].reverse();
    const owner =
      reversedOwners.find((item) => CARD_OWNERS.has(defaultTreeAdapter.getTagName(item))) ??
      reversedOwners.find((item) => uniqueElementDate(item) !== null);
    const safeUrl = safeRaceLogoUrl(attribute(element, "src") ?? null, context.pageUrl);
    if (
      association !== "" &&
      LOGO_MARKER.test(markerText) &&
      owner !== undefined &&
      safeUrl !== null
    ) {
      const ownerText = elementText(owner);
      candidates.push({
        url: safeUrl,
        kind: "dom",
        eventDate: uniqueElementDate(owner),
        identity: association,
        aggregatorEvidence: ownerText,
      });
    }
  }
  for (const child of defaultTreeAdapter.getChildNodes(element)) {
    if (defaultTreeAdapter.isElementNode(child)) {
      collectDomCandidates(child, { pageUrl: context.pageUrl, excluded, owners }, candidates);
    }
  }
}

function matchesRace(
  candidate: RaceLogoCandidate,
  race: Pick<Race, "name" | "eventDate">,
): boolean {
  if (candidate.identity === null || !namesMatch(race.name, candidate.identity)) return false;
  if (candidate.eventDate === null || candidate.eventDate !== race.eventDate) return false;
  return (
    candidate.aggregatorEvidence !== null && namesMatch(race.name, candidate.aggregatorEvidence)
  );
}

function namesMatch(target: string, candidate: string): boolean {
  const targetProfile = nameProfile(target);
  const candidateProfile = nameProfile(candidate);
  if (candidateProfile.base.length < 4) return false;
  if (conflicts(targetProfile.year, candidateProfile.year)) return false;
  if (conflicts(targetProfile.ordinal, candidateProfile.ordinal)) return false;
  return (
    targetProfile.base.includes(candidateProfile.base) ||
    candidateProfile.base.includes(targetProfile.base)
  );
}

function nameProfile(name: string): {
  readonly base: string;
  readonly year: string | null;
  readonly ordinal: string | null;
} {
  return {
    base: normalizeRaceName(name).replace(/\s+|20\d{2}|[^0-9a-z가-힣]/giu, ""),
    year: /(20\d{2})/u.exec(name)?.[1] ?? null,
    ordinal: /제\s*(\d+)\s*회/u.exec(name)?.[1] ?? null,
  };
}

function flattenJsonLd(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!isRecord(value)) return [];
  return [value, ...flattenJsonLd(value["@graph"])];
}

function isLogoEventType(value: unknown): boolean {
  if (typeof value === "string") return LOGO_EVENT_TYPES.has(value);
  return (
    Array.isArray(value) &&
    value.some((item) => typeof item === "string" && LOGO_EVENT_TYPES.has(item))
  );
}

function imageObjectUrl(value: Record<string, unknown> | null): string | null {
  if (value === null) return null;
  return stringValue(value.url) ?? stringValue(value.contentUrl);
}

function eventDateValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/u.exec(value);
  const date = match?.[1];
  return date !== undefined && isValidIsoDate(date) ? date : null;
}

function uniqueElementDate(element: DefaultTreeAdapterTypes.Element): string | null {
  const dates = new Set<string>();
  for (const match of elementText(element).matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu)) {
    const date = match[0];
    if (isValidIsoDate(date)) dates.add(date);
  }
  return dates.size === 1 ? (dates.values().next().value ?? null) : null;
}

function elementText(element: DefaultTreeAdapterTypes.Element): string {
  return defaultTreeAdapter
    .getChildNodes(element)
    .map((node) => {
      if (defaultTreeAdapter.isTextNode(node)) return defaultTreeAdapter.getTextNodeContent(node);
      if (!defaultTreeAdapter.isElementNode(node)) return "";
      const tagName = defaultTreeAdapter.getTagName(node).toLowerCase();
      if (INERT_TEXT.has(tagName)) return "";
      const datetime = tagName === "time" ? (attribute(node, "datetime") ?? "") : "";
      return `${datetime} ${elementText(node)}`;
    })
    .join(" ");
}

function attribute(element: DefaultTreeAdapterTypes.Element, name: string): string | undefined {
  return defaultTreeAdapter.getAttrList(element).find((item) => item.name === name)?.value;
}

function urlBasename(raw: string): string {
  const segment = new URL(raw).pathname.split("/").at(-1) ?? "";
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) return segment;
    throw error;
  }
}

function conflicts(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && left !== right;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
