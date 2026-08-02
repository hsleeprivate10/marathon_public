import { describe, expect, it } from "vitest";
import {
  type TraversalSeed,
  discoveredOfficialHomepageUrl,
  sourceDetailUrl,
  sourceId,
  transientIdentityHint,
} from "../src/adapters/types.js";
import { RaceSchema } from "../src/contract.js";
import { dedupKey } from "../src/normalize.js";

describe("TraversalSeed", () => {
  it("binds an internal official traversal seed to its associated race", () => {
    const associatedRace = RaceSchema.parse({
      name: "2025 서울국제마라톤",
      eventDate: "2025-03-16",
      registrationDeadline: "2025-02-28",
      venue: "서울시청 앞 광장",
      courses: [{ name: "풀", price: 70000 }],
      applicationUrl: "https://www.gorunning.co.kr/race/view.php?idx=1001",
      sources: ["gorunning"],
      verified: true,
      lastVerified: "2025-01-15T12:00:00.000Z",
      updatedAt: "2025-01-15T12:00:00.000Z",
      generatedAt: "2025-01-15T12:00:00.000Z",
      registrationStatus: "open",
    });
    const officialUrl = discoveredOfficialHomepageUrl("https://race.example.com");
    expect(officialUrl).not.toBeNull();
    if (officialUrl === null) return;
    const link = {
      dedupKey: transientIdentityHint(dedupKey(associatedRace)),
      kind: "official",
      url: officialUrl,
      sourceId: sourceId("gorunning"),
      sourceDetailUrl: sourceDetailUrl("https://gorunning.kr/races/1001"),
      identityEvidence: {
        titleHints: [transientIdentityHint(associatedRace.name)],
        dateHints: [transientIdentityHint(associatedRace.eventDate)],
        organizerHints: [],
      },
      evidence: "explicit-label",
    } satisfies TraversalSeed;
    const racesByDedupKey = new Map([
      [transientIdentityHint(dedupKey(associatedRace)), associatedRace],
    ]);

    expect(link.dedupKey).toBe(transientIdentityHint(dedupKey(associatedRace)));
    expect(racesByDedupKey.get(link.dedupKey)).toBe(associatedRace);
  });
});
