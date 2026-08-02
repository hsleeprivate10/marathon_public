import type {
  MarathonGoTrustedDetail,
  SourceDiscoveryCandidate,
  TransientRaceIdentityEvidence,
  TraversalSeed,
} from "../adapters/types.js";
import { type Race, RaceSchema, isValidIsoDate } from "../contract.js";
import { safeOfficialPageUrl } from "./application-url-policy.js";
import {
  evidenceVariants,
  present,
  trustedDetailForChain,
  uniqueTrustedDetails,
} from "./enrichment-provenance.js";
import { mergeOfficialPage } from "./merge.js";
import type { TraversalAcceptedPage } from "./traversal.js";

export type TraversalSeedChain = {
  readonly canonicalUrl: string;
  readonly seeds: readonly TraversalSeed[];
  readonly identityEvidence: readonly TransientRaceIdentityEvidence[];
  readonly trustedDetails: readonly MarathonGoTrustedDetail[];
  readonly sortDate: string;
  readonly sortName: string;
};

type SeedEntry = {
  readonly seed: TraversalSeed;
  readonly identityEvidence: TransientRaceIdentityEvidence;
};

export type OfficialEnrichmentInput = {
  readonly discoveryCandidates: readonly SourceDiscoveryCandidate[];
  readonly traversalSeeds: readonly TraversalSeed[];
};

export function groupTraversalSeedChains(
  input: OfficialEnrichmentInput,
  today: string,
): TraversalSeedChain[] {
  const evidenceByDetail = discoveryEvidenceByDetail(input.discoveryCandidates);
  const grouped = new Map<string, SeedEntry[]>();
  for (const seed of input.traversalSeeds) {
    if (seed.kind === "official" && safeOfficialPageUrl(seed.url) === null) continue;
    const identityEvidence = linkEvidence(seed, evidenceByDetail);
    if (!isCurrentOrUndated(identityEvidence, today)) continue;
    const canonicalUrl = canonicalSeedUrl(seed.url);
    grouped.set(canonicalUrl, [...(grouped.get(canonicalUrl) ?? []), { seed, identityEvidence }]);
  }

  return [...grouped.entries()]
    .map(([canonicalUrl, entries]) => seedChain(canonicalUrl, entries))
    .sort((left, right) => {
      const date = left.sortDate.localeCompare(right.sortDate);
      if (date !== 0) return date;
      const name = left.sortName.localeCompare(right.sortName, "ko-KR");
      return name === 0 ? left.canonicalUrl.localeCompare(right.canonicalUrl) : name;
    });
}

export function seedRaceForChain(chain: TraversalSeedChain, generatedAt: string): Race | null {
  return seedRacesForChain(chain, generatedAt)[0] ?? null;
}

export function seedRacesForChain(chain: TraversalSeedChain, generatedAt: string): readonly Race[] {
  const races: Race[] = [];
  for (const evidence of chain.identityEvidence) {
    for (const variant of evidenceVariants(evidence)) {
      const race = seedRace(variant, chain.canonicalUrl, generatedAt);
      if (race !== null) races.push(race);
    }
  }
  return races;
}

export function materializeAcceptedPage(
  chain: TraversalSeedChain,
  page: TraversalAcceptedPage,
  verifiedAt: string,
): Race | null {
  const trustedDetail = trustedDetailForChain(chain);
  if (trustedDetail === "conflict") return null;
  const merged = mergeOfficialPage(
    page.matchedRace,
    page.page,
    page.finalUrl,
    verifiedAt,
    trustedDetail,
  );
  if (!merged.accepted) return null;
  const parsed = RaceSchema.safeParse(merged.race);
  return parsed.success ? parsed.data : null;
}

function discoveryEvidenceByDetail(
  discoveryCandidates: readonly SourceDiscoveryCandidate[],
): ReadonlyMap<string, TransientRaceIdentityEvidence> {
  const evidenceByDetail = new Map<string, TransientRaceIdentityEvidence>();
  for (const candidate of discoveryCandidates) {
    evidenceByDetail.set(
      sourceDetailKey(candidate.sourceId, candidate.sourceDetailUrl),
      candidate.identityEvidence,
    );
  }
  return evidenceByDetail;
}

function seedChain(canonicalUrl: string, entries: readonly SeedEntry[]): TraversalSeedChain {
  const sorted = [...entries].sort(compareSeedEntries);
  const first = sorted[0];
  const identityEvidence = uniqueEvidence(sorted.map((entry) => entry.identityEvidence));
  const trustedDetails = uniqueTrustedDetails(
    sorted.flatMap((entry) => present(entry.seed.trustedDetail)),
  );
  const representative =
    first === undefined ? [] : [{ ...first.seed, identityEvidence: first.identityEvidence }];
  return {
    canonicalUrl,
    seeds: representative,
    identityEvidence,
    trustedDetails,
    sortDate: first === undefined ? "9999-12-31" : sortDate(first.identityEvidence),
    sortName: first === undefined ? "" : sortName(first.identityEvidence),
  };
}

function compareSeedEntries(left: SeedEntry, right: SeedEntry): number {
  const date = sortDate(left.identityEvidence).localeCompare(sortDate(right.identityEvidence));
  if (date !== 0) return date;
  const name = sortName(left.identityEvidence).localeCompare(
    sortName(right.identityEvidence),
    "ko-KR",
  );
  if (name !== 0) return name;
  return left.seed.sourceId.localeCompare(right.seed.sourceId);
}

function linkEvidence(
  seed: TraversalSeed,
  evidenceByDetail: ReadonlyMap<string, TransientRaceIdentityEvidence>,
): TransientRaceIdentityEvidence {
  if (hasIdentityEvidence(seed.identityEvidence) || seed.sourceDetailUrl === undefined) {
    return seed.identityEvidence;
  }
  return (
    evidenceByDetail.get(sourceDetailKey(seed.sourceId, seed.sourceDetailUrl)) ??
    seed.identityEvidence
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

function uniqueEvidence(
  evidences: readonly TransientRaceIdentityEvidence[],
): readonly TransientRaceIdentityEvidence[] {
  const seen = new Set<string>();
  const unique: TransientRaceIdentityEvidence[] = [];
  for (const evidence of evidences) {
    const key = `${evidence.titleHints.join("|")}\u0000${evidence.dateHints.join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(evidence);
  }
  return unique;
}

function canonicalSeedUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.+$/u, "");
  return parsed.toString();
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
