import type { Race } from "../contract.js";
import { computeRegistrationStatus } from "../contract.js";
import { dedupKey } from "../normalize.js";
import { detailFixtureName, safeMarathonGoDetailUrl } from "./detail-source-url.js";
import {
  MARATHONGO_BASE_URL,
  MARATHONGO_LIST_URL,
  type MarathonGoDetailEvidence,
  type MarathonGoListItem,
  parseMarathonGoDetail,
  parseMarathonGoList,
} from "./marathongo-parser.js";
import { discoveredApplicationUrl } from "./types.js";
import {
  type AdapterResult,
  type AdapterStageCounters,
  type CollectConfig,
  INTER_FETCH_DELAY_MS,
  type SourceAdapter,
  type SourceDiscoveryCandidate,
  type TraversalSeed,
  applicationTraversalSeed,
  failedMetadata,
  fetchWithTimeout,
  marathonGoTrustedDetail,
  readFixture,
  sleep,
  sourceDetailUrl,
  sourceId,
  sourceResultUrl,
  successMetadata,
  transientIdentityHint,
} from "./types.js";

const DETAIL_BUDGET = 200;
const EMPTY_COUNTERS: AdapterStageCounters = {
  discoveryCandidates: 0,
  sourceDetailsFetched: 0,
  traversalSeeds: 0,
  rejectedCandidates: 0,
  budgetSkipped: 0,
};

type EffectiveIdentity = {
  readonly name: string;
  readonly eventDate: string;
  readonly organizer: string | null;
};

type ApplicationSeedContext = {
  readonly item: MarathonGoListItem;
  readonly candidate: SourceDiscoveryCandidate;
  readonly detail: MarathonGoDetailEvidence;
  readonly detailUrl: string;
  readonly now: string;
};

function identityEvidence(item: MarathonGoListItem): SourceDiscoveryCandidate["identityEvidence"] {
  return {
    titleHints: [transientIdentityHint(item.name)],
    dateHints: [transientIdentityHint(item.eventDate)],
    organizerHints: item.organizer === null ? [] : [transientIdentityHint(item.organizer)],
  };
}

function candidateFromItem(item: MarathonGoListItem, detailUrl: string): SourceDiscoveryCandidate {
  return {
    sourceId: sourceId("marathongo"),
    sourceResultUrl: sourceResultUrl(MARATHONGO_LIST_URL),
    sourceDetailUrl: sourceDetailUrl(detailUrl),
    identityEvidence: identityEvidence(item),
  };
}

function transientRace(identity: EffectiveIdentity, detailUrl: string, now: string): Race {
  return {
    name: identity.name,
    eventDate: identity.eventDate,
    registrationDeadline: null,
    venue: "미상",
    courses: [],
    applicationUrl: detailUrl,
    sources: ["marathongo"],
    verified: false,
    lastVerified: null,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: computeRegistrationStatus(null, identity.eventDate),
  };
}

function effectiveIdentity(
  item: MarathonGoListItem,
  detail: MarathonGoDetailEvidence,
): EffectiveIdentity {
  return {
    name: detail.nameHints[0] ?? item.name,
    eventDate: detail.dateHints[0] ?? item.eventDate,
    organizer: detail.organizerHints[0] ?? item.organizer,
  };
}

function effectiveIdentityEvidence(
  identity: EffectiveIdentity,
): SourceDiscoveryCandidate["identityEvidence"] {
  return {
    titleHints: titleHints(identity.name).map(transientIdentityHint),
    dateHints: [transientIdentityHint(identity.eventDate)],
    organizerHints: identity.organizer === null ? [] : [transientIdentityHint(identity.organizer)],
  };
}

function titleHints(name: string): readonly string[] {
  const base = [name, ...inTitleAliases(name)];
  const compactLocation = /^(20\d{2})\s+(.+?)\s+(올림픽공원)$/u.exec(name);
  const expanded =
    compactLocation === null
      ? base
      : [
          ...base,
          `${compactLocation[1]} ${compactLocation[2]} in ${compactLocation[3]}`,
          `${compactLocation[1]} ${compactLocation[3]} ${compactLocation[2]}`,
        ];
  return [...new Set(expanded)];
}

function inTitleAliases(name: string): readonly string[] {
  const parts = name.split(/\s+in\s+/iu);
  if (parts.length !== 2) return [];
  const left = parts[0]?.trim() ?? "";
  const location = parts[1]?.trim() ?? "";
  if (left === "" || location === "") return [];
  const yearMatch = /^(20\d{2})\s+(.+)$/u.exec(left);
  const year = yearMatch?.[1];
  const event = yearMatch?.[2]?.trim() ?? left;
  if (event === "") return [];
  return [year === undefined ? `${location} ${event}` : `${year} ${location} ${event}`];
}

function applicationSeeds(context: ApplicationSeedContext): readonly TraversalSeed[] {
  const identity = effectiveIdentity(context.item, context.detail);
  const raceKey = transientIdentityHint(
    dedupKey(transientRace(identity, context.detailUrl, context.now)),
  );
  const seedIdentityEvidence = effectiveIdentityEvidence(identity);
  const trustedDetail = marathonGoTrustedDetail({
    sourceId: context.candidate.sourceId,
    sourceDetailUrl: context.candidate.sourceDetailUrl,
    ...(context.detail.dateHints[0] === undefined
      ? {}
      : { eventDate: context.detail.dateHints[0] }),
    ...(context.detail.venueHints[0] === undefined ? {} : { venue: context.detail.venueHints[0] }),
  });
  const seeds: TraversalSeed[] = [];
  const sourceResult = context.candidate.sourceResultUrl;
  if (sourceResult === undefined) return seeds;
  for (const href of context.detail.applicationHrefs) {
    const url = discoveredApplicationUrl(href);
    if (url === null) continue;
    seeds.push(
      applicationTraversalSeed({
        dedupKey: raceKey,
        sourceId: context.candidate.sourceId,
        sourceResultUrl: sourceResult,
        sourceDetailUrl: context.candidate.sourceDetailUrl,
        identityEvidence: seedIdentityEvidence,
        evidence: "explicit-label",
        ...(trustedDetail === undefined ? {} : { trustedDetail }),
        url,
      }),
    );
  }
  return seeds;
}

export const MarathonGoAdapter: SourceAdapter = {
  id: "marathongo",
  name: "MarathonGo",
  baseUrl: MARATHONGO_BASE_URL,
  allowedPaths: ["/raceSchedule/domestic", "/raceDetail/domestic/"],

  async collect(config: CollectConfig): Promise<AdapterResult> {
    const id = this.id;
    try {
      const listHtml = config.fixtureDir
        ? await readFixture(config.fixtureDir, "list.html")
        : await fetchWithTimeout(MARATHONGO_LIST_URL);
      const items = parseMarathonGoList(listHtml);
      const budget = config.detailBudget ?? DETAIL_BUDGET;
      const discoveryCandidates: SourceDiscoveryCandidate[] = [];
      const traversalSeeds: TraversalSeed[] = [];
      let sourceDetailsFetched = 0;
      let rejectedCandidates = 0;
      let budgetSkipped = 0;
      const now = new Date().toISOString();

      for (const [index, item] of items.entries()) {
        const detailUrl = safeMarathonGoDetailUrl(item.detailPath);
        if (detailUrl === null) {
          rejectedCandidates += 1;
          continue;
        }
        const candidate = candidateFromItem(item, detailUrl);
        discoveryCandidates.push(candidate);
        if (index >= budget) {
          budgetSkipped += 1;
          continue;
        }

        let detailHtml: string;
        try {
          detailHtml = config.fixtureDir
            ? await readFixture(
                config.fixtureDir,
                detailFixtureName(detailUrl, MARATHONGO_BASE_URL),
              )
            : await fetchWithTimeout(detailUrl);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          rejectedCandidates += 1;
          continue;
        }
        sourceDetailsFetched += 1;
        const seeds = applicationSeeds({
          item,
          candidate,
          detail: parseMarathonGoDetail(detailHtml, detailUrl),
          detailUrl,
          now,
        });
        if (seeds.length === 0) rejectedCandidates += 1;
        traversalSeeds.push(...seeds);

        if (config.fixtureDir === undefined) await sleep(INTER_FETCH_DELAY_MS);
      }

      return {
        discoveryCandidates,
        traversalSeeds,
        metadata: successMetadata(
          id,
          traversalSeeds.length,
          `Discovered ${discoveryCandidates.length} MarathonGo source-detail candidates; fetched ${sourceDetailsFetched}; traversal seeds ${traversalSeeds.length}; rejected ${rejectedCandidates}; budget skipped ${budgetSkipped}`,
        ),
        stageCounters: {
          discoveryCandidates: discoveryCandidates.length,
          sourceDetailsFetched,
          traversalSeeds: traversalSeeds.length,
          rejectedCandidates,
          budgetSkipped,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        discoveryCandidates: [],
        traversalSeeds: [],
        metadata: failedMetadata(id, true, `MarathonGo failed: ${message}`),
        stageCounters: EMPTY_COUNTERS,
      };
    }
  },
};
