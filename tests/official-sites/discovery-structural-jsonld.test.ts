import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { discoverRaceLinks } from "../../src/official-sites/discovery.js";

const race: Race = {
  name: "제25회 서울국제마라톤",
  eventDate: "2025-03-16",
  registrationDeadline: "2025-02-28",
  venue: "서울시청 앞 광장",
  courses: [{ name: "풀", price: 70000 }],
  applicationUrl: "https://source.example/detail",
  sources: ["test"],
  verified: true,
  lastVerified: "2025-01-15T12:00:00.000Z",
  updatedAt: "2025-01-15T12:00:00.000Z",
  generatedAt: "2025-01-15T12:00:00.000Z",
  registrationStatus: "open",
};

function urls(html: string): readonly string[] {
  return discoverRaceLinks({
    race,
    sourceId: "test",
    sourcePageUrl: "https://source.example/detail",
    sourceHosts: ["source.example"],
    aggregatorHosts: ["source.example"],
    html,
    raceDetailContext: { present: true, sourceDetailUrl: "https://source.example/detail" },
  }).map((link) => link.url);
}

describe("discovery structural JSON-LD script detection", () => {
  it("accepts exact application/ld+json script type and ignores approximate attributes", () => {
    expect(
      urls(
        `<script TYPE="application/ld+json">{"@type":"Event","url":"https://event.example/exact"}</script>`,
      ),
    ).toEqual([]);
    expect(
      urls(
        `<script TYPE="application/ld+json">{"@type":"Event","name":"제25회 서울국제마라톤","startDate":"2025-03-16","url":"https://event.example/exact"}</script>`,
      ),
    ).toEqual(["https://event.example/exact"]);
    for (const attrs of [
      `notype="application/ld+json"`,
      `data-type="application/ld+json"`,
      `x-type="application/ld+json"`,
      "",
      `type="application/ld+json; charset=utf-8"`,
      `type=" application/ld+json"`,
      `type="application/ld+json "`,
    ]) {
      expect(
        urls(`<script ${attrs}>{"@type":"Event","url":"https://event.example/bad"}</script>`),
        attrs,
      ).toEqual([]);
    }
  });
});
