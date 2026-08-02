import {
  type TraversalSeed,
  applicationTraversalSeed,
  discoveredApplicationUrl,
  discoveredOfficialHomepageUrl,
  officialTraversalSeed,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../adapters/types.js";
import type { Race } from "../contract.js";
import { dedupKey } from "../normalize.js";
import { scanContextualFieldLinks, scanDetailAnchors } from "./contextual-field-links.js";
import {
  type RaceDetailContext,
  canonicalUrl,
  hasOwnedSourceDetailContext,
  isAllowedUrl,
} from "./discovery-url-policy.js";
import { isJsonLdEventType, parseJsonLdDocuments } from "./jsonld-events.js";

interface DiscoverRaceLinksInput {
  readonly race: Race;
  readonly sourceId: string;
  readonly sourcePageUrl: string;
  readonly sourceHosts: readonly string[];
  readonly aggregatorHosts: readonly string[];
  readonly html: string;
  readonly raceDetailContext: RaceDetailContext;
}

type Evidence = TraversalSeed["evidence"];
type LinkKind = TraversalSeed["kind"];

interface RawCandidate {
  readonly kind: LinkKind;
  readonly url: string;
  readonly evidence: Evidence;
}

export function discoverRaceLinks(input: DiscoverRaceLinksInput): readonly TraversalSeed[] {
  if (!hasOwnedSourceDetailContext(input)) return [];
  const raceKey = transientIdentityHint(dedupKey(input.race));
  const ownedDetailUrl = input.raceDetailContext.sourceDetailUrl;
  if (ownedDetailUrl === undefined) return [];
  const parsedSourceDetailUrl = sourceDetailUrl(ownedDetailUrl);
  const parsedSourceId = sourceId(input.sourceId);
  const identityEvidence = {
    titleHints: [transientIdentityHint(input.race.name)],
    dateHints: [transientIdentityHint(input.race.eventDate)],
    organizerHints: [],
  };
  const raw = [
    ...anchorCandidates(input.html),
    ...contextualFieldCandidates(input.html),
    ...structuredCandidates(input.html, input.race),
  ];
  const byUrl = new Map<string, TraversalSeed>();

  for (const candidate of raw) {
    const canonical = canonicalUrl(candidate.url, input.sourcePageUrl);
    if (canonical === undefined) continue;
    const kind = candidate.kind;
    if (!isAllowedUrl(canonical, kind, input)) continue;
    const seedBase = {
      dedupKey: raceKey,
      sourceId: parsedSourceId,
      sourceDetailUrl: parsedSourceDetailUrl,
      identityEvidence,
      evidence: candidate.evidence,
    };
    const parsedUrl = discoveredUrl(canonical, kind);
    if (parsedUrl === null) continue;
    const link =
      parsedUrl.kind === "application"
        ? applicationTraversalSeed({ ...seedBase, url: parsedUrl.url })
        : officialTraversalSeed({ ...seedBase, url: parsedUrl.url });
    const previous = byUrl.get(canonical);
    if (previous === undefined || candidatePriority(link) > candidatePriority(previous)) {
      byUrl.set(canonical, link);
    }
  }
  return [...byUrl.values()];
}

function discoveredUrl(
  canonical: string,
  kind: LinkKind,
):
  | {
      readonly kind: "application";
      readonly url: NonNullable<ReturnType<typeof discoveredApplicationUrl>>;
    }
  | {
      readonly kind: "official";
      readonly url: NonNullable<ReturnType<typeof discoveredOfficialHomepageUrl>>;
    }
  | null {
  if (kind === "application") {
    const url = discoveredApplicationUrl(canonical);
    return url === null ? null : { kind, url };
  }
  const url = discoveredOfficialHomepageUrl(canonical);
  return url === null ? null : { kind, url };
}

function candidatePriority(link: TraversalSeed): number {
  if (link.kind === "application") return 4;
  if (link.evidence === "explicit-label") return 3;
  if (link.evidence === "structured-event") return 2;
  return 1;
}

function anchorCandidates(html: string): readonly RawCandidate[] {
  const candidates: RawCandidate[] = [];
  for (const anchor of scanDetailAnchors(html)) {
    const kind = kindFromLabel(textFromHtml(anchor.text));
    if (kind === undefined) continue;
    candidates.push({ kind, url: decodeHtml(anchor.href), evidence: "explicit-label" });
  }
  return candidates;
}

function contextualFieldCandidates(html: string): readonly RawCandidate[] {
  return scanContextualFieldLinks(html).map((link) => ({
    kind: "official",
    url: decodeHtml(link.href),
    evidence: "explicit-label",
  }));
}

function textFromHtml(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function kindFromLabel(label: string): LinkKind | undefined {
  const compact = label.replace(/\s+/g, "");
  const hasApplicationLabel = /참가신청|접수|신청하기|신청/.test(compact);
  const hasOfficialLabel = isOfficialHomepageLabel(label);
  if (hasApplicationLabel && !hasOfficialLabel) return "application";
  if (hasOfficialLabel && !hasApplicationLabel) return "official";
  return undefined;
}

function isOfficialHomepageLabel(label: string): boolean {
  const compact = label.replace(/[\s\p{P}\p{S}]+/gu, "");
  if (/^비공식(?:대회)?홈페이지/u.test(compact)) return false;
  if (isHomepageDenialLabel(compact)) return false;
  return /공식홈페이지|대회홈페이지|^홈페이지(?:$|안내|바로가기)/u.test(compact);
}

function isHomepageDenialLabel(compact: string): boolean {
  const subject = "(?:공식|대회공식|대회)?홈페이지";
  const particle = "(?:가|는|를)?";
  const denial =
    "(?:아님|아니다|아닙니다|없음|없습니다|없어요|존재하지않습니다|존재하지않아요|운영하지않습니다|운영하지않아요|현재운영하지않습니다|현재운영하지않아요|운영안함|미운영)";
  return new RegExp(`^${subject}${particle}${denial}$`, "u").test(compact);
}

function structuredCandidates(html: string, race: Race): readonly RawCandidate[] {
  const candidates: RawCandidate[] = [];
  for (const document of parseJsonLdDocuments(html)) collectStructured(document, candidates, race);
  return candidates;
}

function collectStructured(value: unknown, candidates: RawCandidate[], race: Race): void {
  if (Array.isArray(value)) {
    for (const item of value) collectStructured(item, candidates, race);
    return;
  }
  if (!isObject(value)) return;
  const entries = Object.entries(value);
  const graph = entries.find(([key]) => key === "@graph")?.[1];
  if (graph !== undefined) collectStructured(graph, candidates, race);
  const typeValue = entries.find(([key]) => key === "@type")?.[1];
  if (!isJsonLdEventType(typeValue)) return;
  if (!isCurrentRaceEvent(entries, race)) return;
  const eventUrl = stringProperty(entries, "url");
  if (eventUrl !== undefined)
    candidates.push({ kind: "official", url: eventUrl, evidence: "structured-event" });
  const organizer = entries.find(([key]) => key === "organizer")?.[1];
  for (const url of organizerUrls(organizer)) {
    candidates.push({ kind: "official", url, evidence: "structured-organizer" });
  }
}

function isCurrentRaceEvent(entries: readonly (readonly [string, unknown])[], race: Race): boolean {
  const name = stringProperty(entries, "name");
  const startDate = stringProperty(entries, "startDate");
  if (name === undefined || startDate === undefined) return false;
  return (
    normalizedText(name) === normalizedText(race.name) && startDate.slice(0, 10) === race.eventDate
  );
}

function normalizedText(value: string): string {
  return value.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function stringProperty(
  entries: readonly (readonly [string, unknown])[],
  keyName: string,
): string | undefined {
  const value = entries.find(([key]) => key === keyName)?.[1];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function organizerUrls(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap((item) => organizerUrls(item));
  if (typeof value === "string") return [value];
  if (!isObject(value)) return [];
  const url = stringProperty(Object.entries(value), "url");
  return url === undefined ? [] : [url];
}
