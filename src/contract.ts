/**
 * Canonical race data contract — Zod schemas defining the races.json output.
 *
 * All untrusted source data is parsed through these schemas at the boundary.
 * Internal code works exclusively with the inferred types.
 */
import { z } from "zod";
import {
  safeApplicationUrl,
  safeOfficialPageUrl,
  safeRaceApplicationUrl,
} from "./official-sites/application-url-policy.js";
import { safeRaceLogoUrl } from "./race-logo-url.js";

// ---------------------------------------------------------------------------
// Course & pricing
// ---------------------------------------------------------------------------

/** Course-specific pricing where known. */
export const CourseNameSchema = z.enum(["풀", "하프", "10K", "5K"]);

export const CoursePriceSchema = z.object({
  course: CourseNameSchema,
  /** Entry fee in KRW. null = unknown, undefined = field absent from source. */
  price: z.number().int().nonnegative().nullable(),
  /** Whether the price was parsed from structured data vs body text */
  priceSource: z.enum(["structured", "body-text"]).optional(),
});

export type CoursePrice = z.infer<typeof CoursePriceSchema>;

export const CourseSchema = z.object({
  name: CourseNameSchema,
  price: CoursePriceSchema.shape.price,
  priceSource: CoursePriceSchema.shape.priceSource.optional(),
});

export type Course = z.infer<typeof CourseSchema>;

// ---------------------------------------------------------------------------
// Per-race record
// ---------------------------------------------------------------------------

export const RegistrationStatusSchema = z.enum(["open", "closing-soon", "closed", "unknown"]);

export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const IsoDateSchema = z
  .string()
  .refine(isValidIsoDate, "Expected a real ISO calendar date (YYYY-MM-DD)");

const PublicRaceUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => safeRaceApplicationUrl(value) !== null,
    "Race URL must identify a public race-specific non-payment HTTP(S) page",
  );

const OfficialRaceUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => safeOfficialPageUrl(value) !== null,
    "Official URL must be a public non-payment, non-registration HTTP(S) page",
  );

export const RaceSchema = z.object({
  /** Human-readable race name (Korean preferred) */
  name: z.string().min(1),
  /** ISO 8601 date string (YYYY-MM-DD) */
  eventDate: IsoDateSchema,
  /** ISO 8601 date or null if not available */
  registrationDeadline: IsoDateSchema.nullable(),
  /** City/venue text as published */
  venue: z.string().min(1),
  /** Broad region hint */
  region: z.string().optional(),
  /** Per-distance courses with nullable prices; empty when a source publishes no distances */
  courses: z.array(CourseSchema),
  /** Primary source URL for the race */
  applicationUrl: PublicRaceUrlSchema,
  officialSiteUrl: OfficialRaceUrlSchema.optional(),
  logoUrl: z
    .string()
    .url()
    .refine((value) => safeRaceLogoUrl(value) === value, "Logo URL must be canonical and safe")
    .optional(),
  /** Free-text notes (site-specific caveats) */
  notes: z.string().optional(),
  /** Collection-only identity URL used for dedup keys and removed before publication */
  urlScheme: z
    .string()
    .url()
    .refine((value) => safeApplicationUrl(value) !== null, "Identity URL must be public and safe")
    .optional(),
  /** Source adapter IDs that contributed data to this record */
  sources: z.array(z.string()).min(1),
  /** Whether at least one source was recently verified */
  verified: z.boolean(),
  /** ISO 8601 datetime of most recent successful source verification */
  lastVerified: z.string().datetime().nullable(),
  /** ISO 8601 datetime of when this record was last modified */
  updatedAt: z.string().datetime(),
  /** ISO 8601 datetime of when this collection run generated the file */
  generatedAt: z.string().datetime(),
  /** Derived registration status */
  registrationStatus: RegistrationStatusSchema,
});

export type Race = z.infer<typeof RaceSchema>;
const PublishedRaceSchema = RaceSchema.omit({ urlScheme: true });

// ---------------------------------------------------------------------------
// Collection metadata (per-source)
// ---------------------------------------------------------------------------

export const SourceRecordSchema = z.object({
  /** Adapter ID, e.g. "gorunning" */
  id: z.string().min(1),
  /** Whether collection was attempted */
  attempted: z.boolean(),
  /** Whether collection succeeded without error */
  succeeded: z.boolean(),
  /** Number of records extracted (0 if failed or attempted=false) */
  recordCount: z.number().int().nonnegative(),
  /** Human-readable status/error message */
  message: z.string(),
});

export type SourceRecord = z.infer<typeof SourceRecordSchema>;

// ---------------------------------------------------------------------------
// Top-level output
// ---------------------------------------------------------------------------

export const CollectionOutputSchema = z.object({
  /** ISO 8601 datetime of generation */
  generatedAt: z.string().datetime(),
  /** Deduplicated, sorted race records */
  races: z.array(PublishedRaceSchema),
  /** Per-source collection metadata */
  collectionMetadata: z.array(SourceRecordSchema),
});

export type CollectionOutput = z.infer<typeof CollectionOutputSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse and validate unknown JSON as CollectionOutput, throwing on failure. */
export function parseCollectionOutput(raw: unknown): CollectionOutput {
  return CollectionOutputSchema.parse(raw);
}

/** Compute registration status from event date + deadline. */
export function computeRegistrationStatus(
  deadline: string | null,
  eventDate: string,
): RegistrationStatus {
  if (deadline === null) return "unknown";
  const now = new Date();
  const dl = new Date(deadline);
  const ev = new Date(eventDate);
  if (now > ev) return "closed";
  if (now > dl) return "closed";
  const daysLeft = (dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 0) return "closed";
  if (daysLeft <= 14) return "closing-soon";
  return "open";
}
