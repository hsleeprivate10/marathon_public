import { describe, expect, it } from "vitest";
import {
  type AdapterResult,
  type DiscoveredRaceLink,
  type SourceDiscoveryCandidate,
  preferredDiscoveredRaceUrl,
} from "../src/adapters/types.js";
import type { Race } from "../src/contract.js";

type ExpectTrue<Value extends true> = Value;
type AdapterResultKeys = keyof AdapterResult;
type AdapterResultAllowedKeys =
  | "discoveryCandidates"
  | "discoveredOfficialCandidates"
  | "metadata"
  | "stageCounters";

type AdapterResultOmitsRaces = ExpectTrue<"races" extends keyof AdapterResult ? false : true>;
type AdapterResultExposesOnlyCandidates = ExpectTrue<
  Exclude<AdapterResultKeys, AdapterResultAllowedKeys> extends never ? true : false
>;
type CandidateForbiddenKeys = Extract<
  keyof SourceDiscoveryCandidate | keyof DiscoveredRaceLink,
  keyof Race | "races" | "price" | "registrationState"
>;
type CandidateOmitsPublishableRaceFields = ExpectTrue<
  CandidateForbiddenKeys extends never ? true : false
>;

const adapterResultOmitsRaces: AdapterResultOmitsRaces = true;
const adapterResultExposesOnlyCandidates: AdapterResultExposesOnlyCandidates = true;
const candidateOmitsPublishableRaceFields: CandidateOmitsPublishableRaceFields = true;

describe("adapter publication contract", () => {
  it("keeps adapter candidates outside the publishable Race shape", () => {
    expect(adapterResultOmitsRaces).toBe(true);
    expect(adapterResultExposesOnlyCandidates).toBe(true);
    expect(candidateOmitsPublishableRaceFields).toBe(true);
  });

  it("publishes no URL when discovery candidates are absent", () => {
    expect(preferredDiscoveredRaceUrl([])).toBeUndefined();
  });
});
