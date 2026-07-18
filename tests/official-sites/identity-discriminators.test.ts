import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { mergeOfficialPage } from "../../src/official-sites/merge.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

function race(name: string): Race {
  return {
    name,
    eventDate: "2026-03-15",
    registrationDeadline: null,
    venue: "미상",
    courses: [{ name: "풀", price: null }],
    applicationUrl: "https://source.example/apply",
    sources: ["test"],
    verified: false,
    lastVerified: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    generatedAt: "2026-01-01T00:00:00.000Z",
    registrationStatus: "unknown",
  };
}

function merge(name: string, html: string) {
  return mergeOfficialPage(
    race(name),
    parseOfficialPage(html, "https://official.example/seoul"),
    "https://official.example/final",
    "2026-01-02T00:00:00.000Z",
  );
}

describe("identity discriminators for JSON-LD Event selection", () => {
  it("does not select a first same-base Event with conflicting year discriminator", () => {
    const result = merge(
      "2026 서울국제마라톤",
      `<script type="application/ld+json">{"@type":"Event","name":"2025 서울국제마라톤","startDate":"2026-03-15","location":"오염장소"}</script><script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"정상장소"}</script>`,
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.venue).toBe("정상장소");
  });

  it("does not select a first same-base Event with conflicting ordinal discriminator", () => {
    const result = merge(
      "제11회 서울국제마라톤",
      `<script type="application/ld+json">{"@type":"Event","name":"제10회 서울국제마라톤","startDate":"2026-03-15","location":"오염장소"}</script><script type="application/ld+json">{"@type":"Event","name":"제11회 서울국제마라톤","startDate":"2026-03-15","location":"정상장소"}</script>`,
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.venue).toBe("정상장소");
  });

  it("still matches a title lacking year when the base name matches", () => {
    const result = merge(
      "2026 서울국제마라톤",
      `<script type="application/ld+json">{"@type":"Event","name":"서울국제마라톤","startDate":"2026-03-15","location":"정상장소"}</script>`,
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.venue).toBe("정상장소");
  });
});
