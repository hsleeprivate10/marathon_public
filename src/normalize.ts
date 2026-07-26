/**
 * Korean name normalization and conservative deduplication.
 *
 * Normalization: whitespace collapse, bracket removal, suffix normalization.
 * Deduplication: matches on normalized name + event date; preserves all sources.
 * Never manufactures missing dates or prices.
 */
import type { Race } from "./contract.js";
import { compactRaceName, isAggregatorUrl, representsSameEvent } from "./race-identity.js";

export { normalizeRaceName } from "./race-identity.js";

const regionPatterns = [
  ["서울", /서울/],
  ["부산", /부산/],
  ["대구", /대구/],
  ["인천", /인천/],
  ["광주", /광주/],
  ["대전", /대전/],
  ["울산", /울산/],
  ["세종", /세종/],
  ["경기", /경기(?:도)?/],
  ["강원", /강원(?:특별자치도|도)?/],
  ["충북", /충청북도|충북/],
  ["충남", /충청남도|충남/],
  ["전북", /전북(?:특별자치도)?/],
  ["전남", /전라남도|전남/],
  ["경북", /경상북도|경북/],
  ["경남", /경상남도|경남/],
  ["제주", /제주(?:특별자치도)?/],
] as const;

// ---------------------------------------------------------------------------
// Dedup key generation
// ---------------------------------------------------------------------------

/**
 * Generate a dedup key from a race record.
 * Uses normalized name + event date for high-confidence matching.
 */
export function dedupKey(race: Race): string {
  const compact = compactRaceName(race.name);
  const normalized =
    compact.length >= 2
      ? compact
      : `raw:${encodeURIComponent(race.name.normalize("NFKC").toLowerCase().replace(/\s+/g, ""))}`;
  const venue =
    race.venue
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]/g, "") || "미상";
  return `${normalized}|${race.eventDate}|${venue}`;
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

/**
 * Merge two Race records that represent the same event.
 *
 * Rules:
 * - Keep the name from the earlier source (primary source wins).
 * - Never manufacture a date: if the existing record has a known date, keep it.
 * - Never manufacture a price: only update if the new source provides a non-null price.
 * - Accumulate all source IDs.
 * - Keep the most recent lastVerified and updatedAt.
 * - Prefer non-null registrationDeadline (first non-null wins).
 */
export function mergeRaces(existing: Race, incoming: Race): Race {
  const now = new Date().toISOString();

  // Merge courses: existing courses keep priority, add new ones not already present
  const existingCourses = [...existing.courses];
  for (const ic of incoming.courses) {
    const hasMatch = existingCourses.some(
      (ec) => normalizeCourseName(ec.name) === normalizeCourseName(ic.name),
    );
    if (!hasMatch) {
      existingCourses.push(ic);
    } else {
      // Only update price if existing is null and incoming is not
      const idx = existingCourses.findIndex(
        (ec) => normalizeCourseName(ec.name) === normalizeCourseName(ic.name),
      );
      if (idx >= 0 && existingCourses[idx]?.price === null && ic.price !== null) {
        existingCourses[idx] = { ...existingCourses[idx], price: ic.price };
      }
    }
  }

  // Merge sources
  const mergedSources = [...new Set([...existing.sources, ...incoming.sources])];

  // Keep the best lastVerified
  const lastVerified = pickLatest(existing.lastVerified, incoming.lastVerified);

  // Keep the earliest non-null deadline (first source wins)
  const registrationDeadline = existing.registrationDeadline ?? incoming.registrationDeadline;

  return {
    name: existing.name,
    eventDate: existing.eventDate,
    registrationDeadline,
    venue: existing.venue !== "미상" ? existing.venue : incoming.venue,
    region: existing.region ?? incoming.region,
    courses: existingCourses,
    applicationUrl: preferredApplicationUrl(existing.applicationUrl, incoming.applicationUrl),
    officialSiteUrl: existing.officialSiteUrl ?? incoming.officialSiteUrl,
    logoUrl: existing.logoUrl ?? incoming.logoUrl,
    notes: mergeNotes(existing.notes, incoming.notes),
    urlScheme: existing.urlScheme ?? incoming.urlScheme,
    sources: mergedSources,
    verified: existing.verified || incoming.verified,
    lastVerified,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: existing.registrationStatus,
  };
}

function preferredApplicationUrl(existing: string, incoming: string): string {
  const existingIsAggregator = isAggregatorUrl(existing);
  const incomingIsAggregator = isAggregatorUrl(incoming);
  return existingIsAggregator && !incomingIsAggregator ? incoming : existing;
}

function normalizeCourseName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

function pickLatest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function mergeNotes(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  return `${a}; ${b}`;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate an array of races by normalized name + event date.
 * Preserves source attribution; earlier entries (primary sources) keep priority.
 */
export function deduplicateRaces(races: ReadonlyArray<Race>): Race[] {
  return deduplicateRaceCollection(races).races;
}

export type DeduplicatedRaceCollection = {
  readonly races: Race[];
  readonly aliases: ReadonlyMap<string, string>;
};

export function deduplicateRaceCollection(races: ReadonlyArray<Race>): DeduplicatedRaceCollection {
  const normalized: Race[] = [];

  for (const race of races) {
    // Reject page headings and leaked markup before they reach public data.
    if (
      /\bclass=|마라톤\s*대회\s*일정|후기|결과|링크\s*모음/.test(race.name) ||
      /^(?:마라톤 대회|KorMarathon|대회 등록 안내)$/i.test(race.name.trim())
    )
      continue;
    const name = race.name.replaceAll("&amp;", "&");
    const venue = /\bclass=|">|<[^>]+>/.test(race.venue)
      ? "미상"
      : race.venue.replaceAll("&amp;", "&");
    const region = race.region ?? inferRegion(venue);
    const normalizedRace =
      region === undefined && name === race.name && venue === race.venue
        ? race
        : { ...race, name, venue, ...(region && { region }) };
    normalized.push({ ...normalizedRace });
  }

  const groups: Race[][] = [];
  for (const race of normalized) {
    const group = groups.find((candidate) => {
      const anchor = candidate[0];
      return anchor !== undefined && representsSameEvent(anchor, race);
    });
    if (group === undefined) groups.push([race]);
    else group.push(race);
  }

  const aliases = new Map<string, string>();
  const deduplicated = groups.flatMap((group) => {
    const first = group[0];
    if (first === undefined) return [];
    const merged = group.slice(1).reduce((current, race) => mergeRaces(current, race), first);
    const canonicalKey = dedupKey(merged);
    for (const race of group) aliases.set(dedupKey(race), canonicalKey);
    return [merged];
  });
  return { races: deduplicated, aliases };
}

function inferRegion(venue: string): string | undefined {
  return regionPatterns.find(([, pattern]) => pattern.test(venue))?.[0];
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sort races deterministically: by eventDate ASC, then by name ASC (locale-aware).
 */
export function sortRaces(races: Race[]): Race[] {
  return [...races].sort((a, b) => {
    const dateCmp = a.eventDate.localeCompare(b.eventDate);
    if (dateCmp !== 0) return dateCmp;
    return a.name.localeCompare(b.name, "ko-KR");
  });
}
