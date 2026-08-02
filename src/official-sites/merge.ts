import type { MarathonGoTrustedDetail } from "../adapters/types.js";
import type { Course, Race } from "../contract.js";
import { computeRegistrationStatus, isValidIsoDate } from "../contract.js";
import { canonicalCourses } from "../courses.js";
import { selectRaceLogoCandidate } from "../race-logo-candidates.js";
import { safeOfficialPageUrl, safeRaceApplicationUrl } from "./application-url-policy.js";
import {
  type IdentityRejectReason,
  type IdentitySelection,
  checkOfficialPageIdentity,
} from "./identity.js";
import type { OfficialPageData } from "./parser.js";

export type OfficialMergeRejectReason =
  | IdentityRejectReason
  | "unsafe-official-url"
  | "missing-event-date"
  | "missing-venue"
  | "trusted-event-date-conflict"
  | "trusted-venue-conflict";
export type OfficialMergeOutcome =
  | { readonly accepted: true; readonly race: Race }
  | { readonly accepted: false; readonly reason: OfficialMergeRejectReason };

type SelectedOfficialFields = {
  readonly name: string | null;
  readonly eventDate: string | null;
  readonly venue: string | null;
  readonly registrationDeadline: string | null;
  readonly courses: readonly Course[];
  readonly registrationUrl: string | null;
};

export function mergeOfficialPage(
  race: Race,
  page: OfficialPageData,
  finalOfficialSiteUrl: string,
  verifiedAt = new Date().toISOString(),
  trustedDetail?: MarathonGoTrustedDetail,
): OfficialMergeOutcome {
  const officialSiteUrl = safeOfficialPageUrl(finalOfficialSiteUrl);
  if (officialSiteUrl === null) return { accepted: false, reason: "unsafe-official-url" };
  const identity = checkOfficialPageIdentity(race, page);
  if (!identity.accepted) return { accepted: false, reason: identity.reason };
  const selected = selectedFields(page, identity.selection);
  const completed = completeFromTrustedDetail(selected, trustedDetail);
  if (completed.kind === "conflict") return { accepted: false, reason: completed.reason };
  const fields = completed.fields;
  if (fields.eventDate === null) return { accepted: false, reason: "missing-event-date" };
  const eventDate = fields.eventDate;
  if (!isValidIsoDate(eventDate)) return { accepted: false, reason: "invalid-date" };
  if (fields.venue === null) return { accepted: false, reason: "missing-venue" };
  const selectedLogoUrl = selectRaceLogoCandidate(page.logoCandidates ?? [], {
    name: fields.name ?? race.name,
    eventDate,
  });
  const logoUrl = selectedLogoUrl ?? race.logoUrl;
  const registrationDeadline = fields.registrationDeadline;
  const applicationUrl = safeRaceApplicationUrl(fields.registrationUrl) ?? officialSiteUrl;
  return {
    accepted: true,
    race: {
      name: fields.name ?? race.name,
      eventDate,
      registrationDeadline,
      venue: fields.venue,
      courses: canonicalCourses(fields.courses),
      applicationUrl,
      ...(logoUrl === undefined ? {} : { logoUrl }),
      officialSiteUrl,
      sources: completed.usedTrustedDetail ? ["official-sites", "marathongo"] : ["official-sites"],
      verified: true,
      lastVerified: verifiedAt,
      updatedAt: verifiedAt,
      generatedAt: race.generatedAt,
      registrationStatus: computeRegistrationStatus(registrationDeadline, eventDate),
    },
  };
}

type TrustedCompletionOutcome =
  | {
      readonly kind: "completed";
      readonly fields: SelectedOfficialFields;
      readonly usedTrustedDetail: boolean;
    }
  | {
      readonly kind: "conflict";
      readonly reason: "trusted-event-date-conflict" | "trusted-venue-conflict";
    };

function completeFromTrustedDetail(
  selected: SelectedOfficialFields,
  trustedDetail: MarathonGoTrustedDetail | undefined,
): TrustedCompletionOutcome {
  if (trustedDetail === undefined) {
    return { kind: "completed", fields: selected, usedTrustedDetail: false };
  }
  if (
    selected.eventDate !== null &&
    trustedDetail.eventDate !== undefined &&
    selected.eventDate !== trustedDetail.eventDate
  ) {
    return { kind: "conflict", reason: "trusted-event-date-conflict" };
  }
  if (
    selected.venue !== null &&
    trustedDetail.venue !== undefined &&
    normalizeVenue(selected.venue) !== normalizeVenue(trustedDetail.venue)
  ) {
    return { kind: "conflict", reason: "trusted-venue-conflict" };
  }
  const eventDate = selected.eventDate ?? trustedDetail.eventDate ?? null;
  const venue = selected.venue ?? trustedDetail.venue ?? null;
  return {
    kind: "completed",
    fields: { ...selected, eventDate, venue },
    usedTrustedDetail: selected.eventDate === null || selected.venue === null,
  };
}

function normalizeVenue(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function selectedFields(
  page: OfficialPageData,
  selection: IdentitySelection,
): SelectedOfficialFields {
  switch (selection.kind) {
    case "event": {
      const useBody = selection.bodyAssociated;
      return {
        name: selection.event.name,
        eventDate: selection.event.eventDate ?? (useBody ? first(page.bodyEventDates ?? []) : null),
        venue: selection.event.venue ?? (useBody ? (page.bodyVenue ?? null) : null),
        registrationDeadline:
          selection.event.registrationDeadline ??
          (useBody ? (page.bodyRegistrationDeadline ?? null) : null),
        courses: useBody
          ? supplementCourses(selection.event.courses, page.bodyCourses ?? [])
          : selection.event.courses,
        registrationUrl:
          selection.event.registrationUrl ?? (useBody ? (page.bodyRegistrationUrl ?? null) : null),
      };
    }
    case "body":
      return {
        name: first(page.bodyNames ?? []) ?? first(page.names),
        eventDate: first(page.bodyEventDates ?? []) ?? page.eventDate,
        venue: page.bodyVenue ?? page.venue ?? null,
        registrationDeadline: page.bodyRegistrationDeadline ?? page.registrationDeadline ?? null,
        courses: page.bodyCourses ?? page.courses,
        registrationUrl: page.bodyRegistrationUrl ?? page.registrationUrl ?? null,
      };
  }
}

function supplementCourses(
  official: readonly Course[],
  body: readonly Course[],
): readonly Course[] {
  const names = new Set(official.map((course) => course.name));
  return [...official, ...body.filter((course) => !names.has(course.name))];
}

function first(values: readonly string[]): string | null {
  return values[0] ?? null;
}
