import { describe, expect, it } from "vitest";
import {
  type AdapterResult,
  type ApplicationTraversalSeed,
  type OfficialTraversalSeed,
  type SourceDiscoveryCandidate,
  type TraversalSeed,
  applicationTraversalSeed,
  discoveredApplicationUrl,
  discoveredOfficialHomepageUrl,
  officialTraversalSeed,
  preferredTraversalApplicationUrl,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../src/adapters/types.js";
import type { Race } from "../src/contract.js";

type ExpectTrue<Value extends true> = Value;
type AdapterResultKeys = keyof AdapterResult;
type AdapterResultAllowedKeys =
  | "discoveryCandidates"
  | "traversalSeeds"
  | "metadata"
  | "stageCounters";
type AdapterResultRequiresTraversalSeeds = ExpectTrue<
  AdapterResult extends { readonly traversalSeeds: readonly TraversalSeed[] } ? true : false
>;
type OfficialSeedRejectsApplicationUrl = ExpectTrue<
  ApplicationTraversalSeed extends OfficialTraversalSeed ? false : true
>;
type ApplicationSeedRejectsOfficialUrl = ExpectTrue<
  OfficialTraversalSeed extends ApplicationTraversalSeed ? false : true
>;

type AdapterResultOmitsRaces = ExpectTrue<"races" extends keyof AdapterResult ? false : true>;
type AdapterResultExposesOnlyCandidates = ExpectTrue<
  Exclude<AdapterResultKeys, AdapterResultAllowedKeys> extends never ? true : false
>;
type CandidateForbiddenKeys = Extract<
  keyof SourceDiscoveryCandidate | keyof TraversalSeed,
  keyof Race | "races" | "price" | "registrationState"
>;
type CandidateOmitsPublishableRaceFields = ExpectTrue<
  CandidateForbiddenKeys extends never ? true : false
>;

const adapterResultOmitsRaces: AdapterResultOmitsRaces = true;
const adapterResultExposesOnlyCandidates: AdapterResultExposesOnlyCandidates = true;
const adapterResultRequiresTraversalSeeds: AdapterResultRequiresTraversalSeeds = true;
const candidateOmitsPublishableRaceFields: CandidateOmitsPublishableRaceFields = true;
const officialSeedRejectsApplicationUrl: OfficialSeedRejectsApplicationUrl = true;
const applicationSeedRejectsOfficialUrl: ApplicationSeedRejectsOfficialUrl = true;

describe("adapter publication contract", () => {
  it("keeps adapter candidates outside the publishable Race shape", () => {
    expect(adapterResultOmitsRaces).toBe(true);
    expect(adapterResultExposesOnlyCandidates).toBe(true);
    expect(adapterResultRequiresTraversalSeeds).toBe(true);
    expect(candidateOmitsPublishableRaceFields).toBe(true);
    expect(officialSeedRejectsApplicationUrl).toBe(true);
    expect(applicationSeedRejectsOfficialUrl).toBe(true);
  });

  it("keeps official and application traversal seeds distinct when constructing evidence", () => {
    // Given: one owned detail page with one official URL and one application URL.
    const ownedDetailUrl = sourceDetailUrl("https://source.example/races/seoul-2025");
    const identityEvidence = {
      titleHints: [transientIdentityHint("서울국제마라톤")],
      dateHints: [transientIdentityHint("2025-03-16")],
      organizerHints: [transientIdentityHint("서울 조직위")],
    };
    const officialUrl = discoveredOfficialHomepageUrl("https://official.example/seoul-2025");
    const applicationUrl = discoveredApplicationUrl("https://apply.example/register/seoul-2025");

    if (officialUrl === null || applicationUrl === null) {
      throw new TypeError("test URLs must satisfy their branded constructors");
    }

    // When: adapters construct traversal evidence for each purpose.
    const officialSeed = officialTraversalSeed({
      dedupKey: transientIdentityHint("서울국제마라톤|2025-03-16|official"),
      sourceId: sourceId("contract-source"),
      sourceDetailUrl: ownedDetailUrl,
      identityEvidence,
      evidence: "explicit-label",
      url: officialUrl,
    });
    const applicationSeed = applicationTraversalSeed({
      dedupKey: transientIdentityHint("서울국제마라톤|2025-03-16|application"),
      sourceId: sourceId("contract-source"),
      sourceDetailUrl: ownedDetailUrl,
      identityEvidence,
      evidence: "explicit-label",
      url: applicationUrl,
    });

    // Then: the variants preserve purpose and branded URLs without publication authority leakage.
    expect(officialSeed).toMatchObject({ kind: "official", url: officialUrl });
    expect(applicationSeed).toMatchObject({ kind: "application", url: applicationUrl });
    expect(preferredTraversalApplicationUrl([officialSeed])).toBeUndefined();
    expect(preferredTraversalApplicationUrl([applicationSeed])).toBe(applicationUrl);
  });

  it("publishes no URL when discovery candidates are absent", () => {
    expect(preferredTraversalApplicationUrl([])).toBeUndefined();
  });
});
