import type { Race } from "../contract.js";
import { normalizeRaceName } from "../normalize.js";
import type { OfficialJsonLdEvent } from "./jsonld-events.js";
import type { OfficialPageData } from "./parser.js";

export type IdentityRejectReason =
  | "no-name"
  | "name-too-short"
  | "name-mismatch"
  | "date-mismatch"
  | "invalid-date";
export type IdentitySelection =
  | {
      readonly kind: "event";
      readonly event: OfficialJsonLdEvent;
      readonly bodyAssociated: boolean;
    }
  | { readonly kind: "body" };
export type IdentityOutcome =
  | { readonly accepted: true; readonly selection: IdentitySelection }
  | { readonly accepted: false; readonly reason: IdentityRejectReason };

export function checkOfficialPageIdentity(race: Race, page: OfficialPageData): IdentityOutcome {
  const raceProfile = nameProfile(race.name);
  const events = page.events ?? [];
  const bodyNames = page.bodyNames ?? page.names;
  const bodyEventDates = page.bodyEventDates ?? page.eventDates;
  const eventMatches = events.filter((event) => isNameMatch(raceProfile, event.name));
  if (eventMatches.length > 0) {
    if (hasInvalidEventDate(eventMatches)) return { accepted: false, reason: "invalid-date" };
    if (hasConflictingEventDate(eventMatches, race.eventDate)) {
      return { accepted: false, reason: "date-mismatch" };
    }
    if (hasConflictingDate(page.bodyEventDates ?? [], race.eventDate)) {
      return { accepted: false, reason: "date-mismatch" };
    }
    const bodyAssociated = bodyMatches(raceProfile, page);
    const exact = eventMatches.find((event) => event.eventDate === race.eventDate);
    const selected = exact ?? eventMatches[0];
    if (selected === undefined) return { accepted: false, reason: "no-name" };
    return {
      accepted: true,
      selection: {
        kind: "event",
        event: selected,
        bodyAssociated,
      },
    };
  }

  const pageNames = bodyNames.map((name) => compact(normalizeRaceName(name))).filter(Boolean);
  if (pageNames.length === 0) return { accepted: false, reason: "no-name" };
  const eligible = pageNames.filter((name) => name.length >= 4);
  if (eligible.length === 0) return { accepted: false, reason: "name-too-short" };
  if (!bodyNames.some((name) => isNameMatch(raceProfile, name))) {
    return { accepted: false, reason: "name-mismatch" };
  }
  const dates = bodyEventDates.length > 0 ? bodyEventDates : [page.eventDate].filter(isDate);
  if (dates.some((date) => date !== race.eventDate)) {
    return { accepted: false, reason: "date-mismatch" };
  }
  return { accepted: true, selection: { kind: "body" } };
}

function bodyMatches(raceProfile: NameProfile, page: OfficialPageData): boolean {
  return (page.bodyNames ?? page.names).some((name) => isNameMatch(raceProfile, name));
}

function hasInvalidEventDate(events: readonly OfficialJsonLdEvent[]): boolean {
  return events.some((event) => event.eventDateStatus.kind === "invalid");
}

function hasConflictingEventDate(
  events: readonly OfficialJsonLdEvent[],
  raceDate: string,
): boolean {
  return events.some((event) => event.eventDate !== null && event.eventDate !== raceDate);
}

function hasConflictingDate(dates: readonly string[], raceDate: string): boolean {
  return dates.some((date) => date !== raceDate);
}

interface NameProfile {
  readonly base: string;
  readonly year: string | null;
  readonly ordinal: string | null;
}

function isNameMatch(raceProfile: NameProfile, name: string | null): boolean {
  if (name === null) return false;
  const candidate = nameProfile(name);
  if (candidate.base.length < 4) return false;
  if (conflicts(raceProfile.year, candidate.year)) return false;
  if (conflicts(raceProfile.ordinal, candidate.ordinal)) return false;
  return raceProfile.base.includes(candidate.base) || candidate.base.includes(raceProfile.base);
}

function conflicts(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && left !== right;
}

function nameProfile(name: string): NameProfile {
  return {
    base: compact(normalizeRaceName(name)),
    year: /(20\d{2})/.exec(name)?.[1] ?? null,
    ordinal: /제\s*(\d+)\s*회/.exec(name)?.[1] ?? null,
  };
}

function compact(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/20\d{2}/g, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
}

function isDate(value: string | null): value is string {
  return value !== null;
}
