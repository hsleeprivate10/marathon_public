import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { vi } from "vitest";
import {
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  type TransientRaceIdentityEvidence,
  type TraversalSeed,
  discoveredApplicationUrl,
  discoveredOfficialHomepageUrl,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../src/adapters/types.js";

export const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");
export const TMP_DIR = resolve(import.meta.dirname, "__tmp_output__");
export const NOW = "2026-01-02T03:04:05.000Z";

export type AdapterFixture = {
  readonly id: string;
  readonly name: string;
  readonly eventDate: string;
  readonly officialUrls?: readonly string[];
  readonly applicationUrls?: readonly string[];
};

export type OfficialPageFixture = {
  readonly name: string;
  readonly eventDate: string;
  readonly venue?: string;
  readonly registrationPath?: string | null;
};

export async function createOutputDir(directory = TMP_DIR): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export async function removeOutputDir(directory = TMP_DIR): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

function identityEvidence(name: string, eventDate: string): TransientRaceIdentityEvidence {
  return {
    titleHints: [transientIdentityHint(name)],
    dateHints: [transientIdentityHint(eventDate)],
    organizerHints: [],
  };
}

function discoveryCandidate(fixture: AdapterFixture): SourceDiscoveryCandidate {
  const id = sourceId(fixture.id);
  return {
    sourceId: id,
    sourceDetailUrl: sourceDetailUrl(
      `https://${fixture.id}.example/detail/${encodeURIComponent(fixture.name)}`,
    ),
    identityEvidence: identityEvidence(fixture.name, fixture.eventDate),
  };
}

function officialLink(candidate: SourceDiscoveryCandidate, url: string): TraversalSeed {
  const parsed = discoveredOfficialHomepageUrl(url);
  if (parsed === null) throw new TypeError(`unsafe official URL: ${url}`);
  return {
    dedupKey: transientIdentityHint(
      `${candidate.identityEvidence.titleHints[0] ?? "race"}|${candidate.identityEvidence.dateHints[0] ?? "date"}`,
    ),
    kind: "official",
    url: parsed,
    sourceId: candidate.sourceId,
    sourceDetailUrl: candidate.sourceDetailUrl,
    identityEvidence: candidate.identityEvidence,
    evidence: "explicit-label",
  };
}

function applicationLink(candidate: SourceDiscoveryCandidate, url: string): TraversalSeed {
  const parsed = discoveredApplicationUrl(url);
  if (parsed === null) throw new TypeError(`unsafe application URL: ${url}`);
  return {
    dedupKey: transientIdentityHint(
      `${candidate.identityEvidence.titleHints[0] ?? "race"}|application`,
    ),
    kind: "application",
    url: parsed,
    sourceId: candidate.sourceId,
    sourceDetailUrl: candidate.sourceDetailUrl,
    identityEvidence: candidate.identityEvidence,
    evidence: "explicit-label",
  };
}

export function adapter(fixture: AdapterFixture): SourceAdapter {
  return {
    id: fixture.id,
    name: fixture.id,
    baseUrl: `https://${fixture.id}.example`,
    allowedPaths: ["/"],
    collect: async () => {
      const candidate = discoveryCandidate(fixture);
      const officialUrls = fixture.officialUrls ?? [];
      const applicationUrls = fixture.applicationUrls ?? [];
      return {
        discoveryCandidates: [candidate],
        traversalSeeds: [
          ...officialUrls.map((url) => officialLink(candidate, url)),
          ...applicationUrls.map((url) => applicationLink(candidate, url)),
        ],
        metadata: {
          id: fixture.id,
          attempted: true,
          succeeded: true,
          recordCount: officialUrls.length,
          message: "ok",
        },
        stageCounters: {
          discoveryCandidates: 1,
          sourceDetailsFetched: 1,
          traversalSeeds: officialUrls.length,
          rejectedCandidates: 0,
          budgetSkipped: 0,
        },
      };
    },
  };
}

export function emptyAdapter(id: string): SourceAdapter {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.example`,
    allowedPaths: ["/"],
    collect: async () => ({
      discoveryCandidates: [],
      traversalSeeds: [],
      metadata: { id, attempted: true, succeeded: true, recordCount: 0, message: "empty" },
      stageCounters: {
        discoveryCandidates: 0,
        sourceDetailsFetched: 0,
        traversalSeeds: 0,
        rejectedCandidates: 0,
        budgetSkipped: 0,
      },
    }),
  };
}

export function officialPage(fixture: OfficialPageFixture): string {
  const venue = fixture.venue ?? "공식 장소";
  const registrationPath =
    fixture.registrationPath === undefined ? "/entry" : fixture.registrationPath;
  const registration =
    registrationPath === null ? "" : `<a href="${registrationPath}">참가신청</a>`;
  return `<title>${fixture.name}</title><h1>${fixture.name}</h1><p>대회일 ${fixture.eventDate}</p><p>장소: ${venue}</p>${registration}`;
}

export const noDelay = {
  now: () => NOW,
  sleep: vi.fn(() => Promise.resolve()),
  courtesyDelayMs: 0,
} as const;
