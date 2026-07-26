import type {
  DiscoveredRaceLink,
  SourceDiscoveryCandidate,
  TransientRaceIdentityEvidence,
} from "../adapters/types.js";
import { type Race, RaceSchema, isValidIsoDate } from "../contract.js";
import { safeOfficialPageUrl } from "./application-url-policy.js";
import { mergeOfficialPage } from "./merge.js";
import { type OfficialPageData, parseOfficialPage } from "./parser.js";

export type OfficialPageLoadResult =
  | { readonly kind: "success"; readonly url: string; readonly body: string }
  | { readonly kind: "rejected"; readonly url: string; readonly reason: string }
  | { readonly kind: "failed"; readonly url: string; readonly reason: string }
  | {
      readonly kind: "skipped";
      readonly url: string;
      readonly reason: "missing-mapping" | "missing-file";
    };

export type OfficialPageLoader = (url: string) => Promise<OfficialPageLoadResult>;

export type EnrichmentCounts = {
  readonly candidate: number;
  readonly fetched: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly budgetSkipped: number;
};

export type OfficialEnrichmentOptions = {
  readonly today: string;
  readonly verifiedAt: string;
  readonly maxFetches: number;
  readonly courtesyDelayMs: number;
  readonly loadPage: OfficialPageLoader;
  readonly sleep: (milliseconds: number) => Promise<void>;
};

export type OfficialEnrichmentInput = {
  readonly discoveryCandidates: readonly SourceDiscoveryCandidate[];
  readonly discoveredOfficialCandidates: readonly DiscoveredRaceLink[];
};

export type OfficialEnrichmentResult = {
  readonly races: readonly Race[];
  readonly counts: EnrichmentCounts;
};

type CandidateGroup = {
  readonly url: string;
  readonly candidates: readonly OfficialCandidate[];
  readonly sortDate: string;
  readonly sortName: string;
};

type OfficialCandidate = {
  readonly url: string;
  readonly link: DiscoveredRaceLink & { readonly kind: "official-site" };
  readonly identityEvidence: TransientRaceIdentityEvidence;
};

export async function enrichOfficialSites(
  input: OfficialEnrichmentInput,
  options: OfficialEnrichmentOptions,
): Promise<OfficialEnrichmentResult> {
  const groups = groupCandidates(input, options.today);
  const races: Race[] = [];
  const delayedHosts = new Set<string>();
  const candidate = groups.length;
  let fetched = 0;
  let accepted = 0;
  let rejected = 0;
  let budgetSkipped = 0;

  for (const [index, group] of groups.entries()) {
    if (fetched >= options.maxFetches) {
      budgetSkipped += groups.length - index;
      break;
    }
    const hostname = safeHostname(group.url);
    if (hostname !== null && options.courtesyDelayMs > 0 && delayedHosts.has(hostname)) {
      await options.sleep(options.courtesyDelayMs);
    }
    if (hostname !== null) delayedHosts.add(hostname);
    fetched += 1;
    let loaded: OfficialPageLoadResult;
    try {
      loaded = await options.loadPage(group.url);
    } catch (error) {
      if (error instanceof Error) {
        rejected += 1;
        continue;
      }
      throw error;
    }
    switch (loaded.kind) {
      case "success": {
        const materialized = materializeGroup(
          group,
          parseOfficialPage(loaded.body, loaded.url),
          options.verifiedAt,
        );
        if (materialized === null) {
          rejected += 1;
          continue;
        }
        races.push(materialized);
        accepted += 1;
        break;
      }
      case "failed":
      case "rejected":
      case "skipped":
        rejected += 1;
        break;
      default:
        return assertNever(loaded);
    }
  }

  return {
    races,
    counts: { candidate, fetched, accepted, rejected, budgetSkipped },
  };
}

function groupCandidates(input: OfficialEnrichmentInput, today: string): CandidateGroup[] {
  const evidenceByDetail = new Map<string, TransientRaceIdentityEvidence>();
  for (const candidate of input.discoveryCandidates) {
    evidenceByDetail.set(
      sourceDetailKey(candidate.sourceId, candidate.sourceDetailUrl),
      candidate.identityEvidence,
    );
  }

  const grouped = new Map<string, OfficialCandidate[]>();
  for (const link of input.discoveredOfficialCandidates) {
    if (link.kind !== "official-site") continue;
    const officialUrl = safeOfficialPageUrl(link.url);
    if (officialUrl === null) continue;
    const identityEvidence = linkEvidence(link, evidenceByDetail);
    if (!isCurrentOrUndated(identityEvidence, today)) continue;
    const group = grouped.get(officialUrl) ?? [];
    grouped.set(officialUrl, [...group, { url: officialUrl, link, identityEvidence }]);
  }

  return [...grouped.entries()]
    .map(([url, candidates]) => candidateGroup(url, candidates))
    .sort((left, right) => {
      const date = left.sortDate.localeCompare(right.sortDate);
      if (date !== 0) return date;
      const name = left.sortName.localeCompare(right.sortName, "ko-KR");
      return name === 0 ? left.url.localeCompare(right.url) : name;
    });
}

function candidateGroup(url: string, candidates: readonly OfficialCandidate[]): CandidateGroup {
  const sorted = [...candidates].sort((left, right) => {
    const date = sortDate(left.identityEvidence).localeCompare(sortDate(right.identityEvidence));
    if (date !== 0) return date;
    const name = sortName(left.identityEvidence).localeCompare(
      sortName(right.identityEvidence),
      "ko-KR",
    );
    return name === 0 ? left.link.sourceId.localeCompare(right.link.sourceId) : name;
  });
  const first = sorted[0];
  return {
    url,
    candidates: sorted,
    sortDate: first === undefined ? "9999-12-31" : sortDate(first.identityEvidence),
    sortName: first === undefined ? "" : sortName(first.identityEvidence),
  };
}

function materializeGroup(
  group: CandidateGroup,
  page: OfficialPageData,
  verifiedAt: string,
): Race | null {
  for (const candidate of group.candidates) {
    const seed = seedRace(candidate.identityEvidence, group.url, verifiedAt);
    if (seed === null) continue;
    const merged = mergeOfficialPage(seed, page, group.url, verifiedAt);
    if (!merged.accepted) continue;
    const parsed = RaceSchema.safeParse(merged.race);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function seedRace(
  evidence: TransientRaceIdentityEvidence,
  officialUrl: string,
  generatedAt: string,
): Race | null {
  const name = firstPresent(evidence.titleHints);
  const eventDate = firstValidDate(evidence.dateHints);
  if (name === undefined || eventDate === undefined) return null;
  return {
    name,
    eventDate,
    registrationDeadline: null,
    venue: "미상",
    courses: [],
    applicationUrl: officialUrl,
    sources: ["official-sites"],
    verified: false,
    lastVerified: null,
    updatedAt: generatedAt,
    generatedAt,
    registrationStatus: "unknown",
  };
}

function linkEvidence(
  link: DiscoveredRaceLink,
  evidenceByDetail: ReadonlyMap<string, TransientRaceIdentityEvidence>,
): TransientRaceIdentityEvidence {
  if (hasIdentityEvidence(link.identityEvidence) || link.sourceDetailUrl === undefined) {
    return link.identityEvidence;
  }
  return (
    evidenceByDetail.get(sourceDetailKey(link.sourceId, link.sourceDetailUrl)) ??
    link.identityEvidence
  );
}

function hasIdentityEvidence(evidence: TransientRaceIdentityEvidence): boolean {
  return evidence.titleHints.length > 0 || evidence.dateHints.length > 0;
}

function sourceDetailKey(source: string, detailUrl: string): string {
  return `${source}\u0000${detailUrl}`;
}

function isCurrentOrUndated(evidence: TransientRaceIdentityEvidence, today: string): boolean {
  const eventDate = firstValidDate(evidence.dateHints);
  return eventDate === undefined || eventDate >= today;
}

function sortDate(evidence: TransientRaceIdentityEvidence): string {
  return firstValidDate(evidence.dateHints) ?? "9999-12-31";
}

function sortName(evidence: TransientRaceIdentityEvidence): string {
  return firstPresent(evidence.titleHints) ?? "";
}

function firstPresent(values: readonly string[]): string | undefined {
  return values.find((value) => value.trim().length > 0);
}

function firstValidDate(values: readonly string[]): string | undefined {
  return values.find(isValidIsoDate);
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected official page load result: ${JSON.stringify(value)}`);
}
