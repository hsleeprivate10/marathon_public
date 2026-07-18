import type { Course, Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { canonicalCourses } from "../courses.js";
import { safeApplicationUrl, safeOfficialPageUrl } from "./application-url-policy.js";
import { type IdentityRejectReason, checkOfficialPageIdentity } from "./identity.js";
import type { OfficialPageData } from "./parser.js";

export type OfficialMergeRejectReason = IdentityRejectReason | "unsafe-official-url";
export type OfficialMergeOutcome =
  | { readonly accepted: true; readonly race: Race }
  | { readonly accepted: false; readonly reason: OfficialMergeRejectReason; readonly race: Race };

export function mergeOfficialPage(
  race: Race,
  page: OfficialPageData,
  finalOfficialSiteUrl: string,
  verifiedAt = new Date().toISOString(),
): OfficialMergeOutcome {
  const officialSiteUrl = safeOfficialPageUrl(finalOfficialSiteUrl);
  if (officialSiteUrl === null) return { accepted: false, reason: "unsafe-official-url", race };
  const identity = checkOfficialPageIdentity(race, page);
  if (!identity.accepted) return { accepted: false, reason: identity.reason, race };
  const selected = selectedFields(page, identity.selection);
  const registrationDeadline = selected.registrationDeadline ?? race.registrationDeadline;
  return {
    accepted: true,
    race: {
      ...race,
      registrationDeadline,
      venue: selected.venue ?? race.venue,
      courses: mergeCourses(race.courses, selected.courses),
      applicationUrl: safeApplicationUrl(selected.registrationUrl) ?? race.applicationUrl,
      officialSiteUrl,
      verified: true,
      lastVerified: verifiedAt,
      updatedAt: verifiedAt,
      registrationStatus: computeRegistrationStatus(registrationDeadline, race.eventDate),
    },
  };
}

function selectedFields(
  page: OfficialPageData,
  selection: import("./identity.js").IdentitySelection,
) {
  if (selection.kind === "event") {
    const useBody = selection.bodyAssociated;
    return {
      venue: selection.event.venue ?? (useBody ? page.bodyVenue : null),
      registrationDeadline:
        selection.event.registrationDeadline ?? (useBody ? page.bodyRegistrationDeadline : null),
      courses: useBody
        ? supplementCourses(selection.event.courses, page.bodyCourses ?? [])
        : selection.event.courses,
      registrationUrl:
        selection.event.registrationUrl ?? (useBody ? (page.bodyRegistrationUrl ?? null) : null),
    };
  }
  return {
    venue: page.bodyVenue ?? page.venue ?? null,
    registrationDeadline: page.bodyRegistrationDeadline ?? page.registrationDeadline ?? null,
    courses: page.bodyCourses ?? page.courses ?? [],
    registrationUrl: page.bodyRegistrationUrl ?? page.registrationUrl ?? null,
  };
}

function supplementCourses(
  official: readonly Course[],
  body: readonly Course[],
): readonly Course[] {
  const names = new Set(official.map((course) => course.name));
  return [...official, ...body.filter((course) => !names.has(course.name))];
}

function mergeCourses(existing: readonly Course[], official: readonly Course[]): Course[] {
  const merged = new Map<Course["name"], Course>();
  for (const course of canonicalCourses(existing)) merged.set(course.name, course);
  for (const course of canonicalCourses(official)) {
    const current = merged.get(course.name);
    if (current === undefined) {
      merged.set(course.name, course);
    } else if (course.price !== null) {
      merged.set(course.name, course);
    }
  }
  return [...merged.values()];
}
