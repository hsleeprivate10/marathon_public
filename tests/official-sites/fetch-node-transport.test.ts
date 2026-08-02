import { describe, expect, it } from "vitest";
import { fetchOfficialPage } from "../../src/official-sites/fetch.js";

describe("fetchOfficialPage node transport", () => {
  it("fetches a representative live traversal seed through pinned Bun node transport", async () => {
    // Given: a sanitized public traversal seed from live debug evidence.
    const input = "https://web.runit.co.kr/races/1120";

    // When: the real default node:http(s) transport is used under Bun.
    const result = await fetchOfficialPage(input, { purpose: "traversal", timeoutMs: 10_000 });

    // Then: the pinned transport must reach HTTP/policy handling instead of Bun lookup failure.
    expect(result.kind).not.toBe("failed");
  }, 15_000);
});
