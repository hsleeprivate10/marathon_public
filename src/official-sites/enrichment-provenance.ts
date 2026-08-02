import type { MarathonGoTrustedDetail, TransientRaceIdentityEvidence } from "../adapters/types.js";
import type { TraversalSeedChain } from "./enrichment-groups.js";

export function evidenceVariants(
  evidence: TransientRaceIdentityEvidence,
): readonly TransientRaceIdentityEvidence[] {
  return [...evidence.titleHints]
    .reverse()
    .map((titleHint) => ({ ...evidence, titleHints: [titleHint] }));
}

export function trustedDetailForChain(
  chain: TraversalSeedChain,
): MarathonGoTrustedDetail | "conflict" | undefined {
  if (chain.trustedDetails.length === 0) return undefined;
  const first = chain.trustedDetails[0];
  if (first === undefined) return undefined;
  const eventDates = new Set(chain.trustedDetails.flatMap((detail) => present(detail.eventDate)));
  const venues = new Set(chain.trustedDetails.flatMap((detail) => present(detail.venue)));
  if (eventDates.size > 1 || venues.size > 1) return "conflict";
  return first;
}

export function uniqueTrustedDetails(
  details: readonly MarathonGoTrustedDetail[],
): readonly MarathonGoTrustedDetail[] {
  const seen = new Set<string>();
  const unique: MarathonGoTrustedDetail[] = [];
  for (const detail of details) {
    const key = `${detail.eventDate ?? ""}\u0000${detail.venue ?? ""}\u0000${detail.sourceDetailUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(detail);
  }
  return unique;
}

export function present<Value>(value: Value | undefined): readonly Value[] {
  return value === undefined ? [] : [value];
}
