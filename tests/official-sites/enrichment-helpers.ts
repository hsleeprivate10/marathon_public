import { vi } from "vitest";
import { MarathonGoAdapter } from "../../src/adapters/marathongo.js";
import {
  type SourceDiscoveryCandidate,
  type TransientRaceIdentityEvidence,
  type TraversalSeed,
  discoveredApplicationUrl,
  discoveredOfficialHomepageUrl,
  marathonGoTrustedDetail,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../../src/adapters/types.js";
import type {
  OfficialEnrichmentInput,
  OfficialPageLoader,
} from "../../src/official-sites/enrichment.js";

export const FIXTURES = new URL("../fixtures/official-sites", import.meta.url).pathname;
export const NOW = "2026-01-02T03:04:05.000Z";

export type OfficialPageFixture = {
  readonly name: string;
  readonly eventDate: string;
  readonly venue?: string;
  readonly registrationPath?: string;
};

export function evidence(name: string, eventDate: string): TransientRaceIdentityEvidence {
  return {
    titleHints: [transientIdentityHint(name)],
    dateHints: [transientIdentityHint(eventDate)],
    organizerHints: [],
  };
}

export function discovery(
  name: string,
  eventDate: string,
  source = "source",
): SourceDiscoveryCandidate {
  const id = sourceId(source);
  return {
    sourceId: id,
    sourceDetailUrl: sourceDetailUrl(
      `https://${source}.example/detail/${encodeURIComponent(name)}`,
    ),
    identityEvidence: evidence(name, eventDate),
  };
}

export function officialLink(
  candidate: SourceDiscoveryCandidate,
  url: string,
  linkEvidence = candidate.identityEvidence,
): TraversalSeed {
  const parsed = discoveredOfficialHomepageUrl(url);
  if (parsed === null) throw new TypeError(`unsafe official URL: ${url}`);
  return {
    dedupKey: transientIdentityHint(
      `${linkEvidence.titleHints[0] ?? "race"}|${linkEvidence.dateHints[0] ?? "date"}`,
    ),
    kind: "official",
    url: parsed,
    sourceId: candidate.sourceId,
    sourceDetailUrl: candidate.sourceDetailUrl,
    identityEvidence: linkEvidence,
    evidence: "explicit-label",
  };
}

export function applicationLink(candidate: SourceDiscoveryCandidate, url: string): TraversalSeed {
  const parsed = discoveredApplicationUrl(url);
  if (parsed === null) throw new TypeError(`unsafe application URL: ${url}`);
  return {
    dedupKey: transientIdentityHint(`${candidate.identityEvidence.titleHints[0] ?? "race"}|apply`),
    kind: "application",
    url: parsed,
    sourceId: candidate.sourceId,
    sourceDetailUrl: candidate.sourceDetailUrl,
    identityEvidence: candidate.identityEvidence,
    evidence: "explicit-label",
  };
}

export function marathonGoApplicationLink(
  candidate: SourceDiscoveryCandidate,
  url: string,
): TraversalSeed {
  const parsed = discoveredApplicationUrl(url);
  const trustedDetail = marathonGoTrustedDetail({
    sourceId: candidate.sourceId,
    sourceDetailUrl: sourceDetailUrl(
      "https://marathongo.co.kr/raceDetail/domestic/saunarun-olympicpark-2026-07-31",
    ),
    eventDate: "2026-07-31",
    venue: "서울 올림픽공원 평화의광장",
  });
  if (parsed === null || trustedDetail === undefined) throw new TypeError("invalid fixture seed");
  return {
    dedupKey: transientIdentityHint("saunarun-2026"),
    kind: "application",
    url: parsed,
    sourceId: sourceId("marathongo"),
    sourceDetailUrl: trustedDetail.sourceDetailUrl,
    identityEvidence: {
      titleHints: [
        transientIdentityHint("2026 사우나런 in 올림픽공원"),
        transientIdentityHint("2026 올림픽공원 사우나런"),
      ],
      dateHints: [transientIdentityHint("2026-07-31")],
      organizerHints: [],
    },
    evidence: "explicit-label",
    trustedDetail,
  };
}

export function conflictingMarathonGoApplicationLink(
  candidate: SourceDiscoveryCandidate,
  url: string,
): TraversalSeed {
  const seed = marathonGoApplicationLink(candidate, url);
  return {
    ...seed,
    dedupKey: transientIdentityHint("saunarun-conflict-2026"),
    identityEvidence: candidate.identityEvidence,
  };
}

export function input(
  discoveryCandidates: readonly SourceDiscoveryCandidate[],
  traversalSeeds: readonly TraversalSeed[],
): OfficialEnrichmentInput {
  return { discoveryCandidates, traversalSeeds };
}

export function page(fixture: OfficialPageFixture): string {
  const venue = fixture.venue ?? "공식 장소";
  const registrationPath = fixture.registrationPath ?? "/register";
  return `<title>${fixture.name}</title><h1>${fixture.name}</h1><p>대회일 ${fixture.eventDate}</p><p>장소: ${venue}</p><a href="${registrationPath}">참가신청</a>`;
}

export function options(loadPage: OfficialPageLoader, maxFetches = 40) {
  return {
    today: "2026-01-01",
    verifiedAt: NOW,
    maxFetches,
    courtesyDelayMs: 0,
    loadPage,
    sleep: vi.fn(() => Promise.resolve()),
  };
}

export async function collectMarathonGoAliasFixture() {
  return MarathonGoAdapter.collect({
    fixtureDir: new URL("../fixtures/marathongo/ttukseom-alias", import.meta.url).pathname,
    detailBudget: 1,
  });
}
