import { describe, expect, it } from "vitest";
import { mergeOfficialPage } from "../../src/official-sites/merge.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";
import { baseRace, trustedSaunarunDetail } from "./merge-helpers.js";

describe("mergeOfficialPage trusted MarathonGo detail", () => {
  it("fills only missing event date and venue from trusted MarathonGo detail after identity passes", () => {
    const race = baseRace({ name: "2026 올림픽공원 사우나런", eventDate: "2026-08-01" });
    const parsed = parseOfficialPage(
      `<title>2026 올림픽공원 사우나런</title><h1>2026 올림픽공원 사우나런</h1><a href="https://entry.saunarun.com/register/2026">참가신청</a>`,
      "https://saunarun.com/products/z64zdfxy4mc9?variant=44332211",
    );

    const result = mergeOfficialPage(
      race,
      parsed,
      "https://saunarun.com/products/z64zdfxy4mc9?variant=44332211",
      "2026-01-02T00:00:00.000Z",
      trustedSaunarunDetail(),
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race).toMatchObject({
      name: "2026 올림픽공원 사우나런",
      eventDate: "2026-07-31",
      venue: "서울 올림픽공원 평화의광장",
      officialSiteUrl: "https://saunarun.com/products/z64zdfxy4mc9?variant=44332211",
      applicationUrl: "https://entry.saunarun.com/register/2026",
      sources: ["official-sites", "marathongo"],
    });
    expect(JSON.stringify(result.race)).not.toContain("marathongo.co.kr");
    expect(result.race.courses).toEqual([]);
    expect(result.race.registrationDeadline).toBeNull();
  });

  it("keeps complete official matching date and venue authoritative without adding MarathonGo provenance", () => {
    const race = baseRace({ name: "2026 올림픽공원 사우나런", eventDate: "2026-07-31" });
    const parsed = parseOfficialPage(
      "<h1>2026 올림픽공원 사우나런</h1><p>대회일 2026년 7월 31일</p><p>장소: 서울   올림픽공원   평화의광장</p>",
      "https://saunarun.example/official",
    );

    const result = mergeOfficialPage(
      race,
      parsed,
      "https://saunarun.example/official",
      "2026-01-02T00:00:00.000Z",
      trustedSaunarunDetail(),
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.venue).toBe("서울 올림픽공원 평화의광장");
    expect(result.race.eventDate).toBe("2026-07-31");
    expect(result.race.sources).toEqual(["official-sites"]);
  });

  it("rejects trusted MarathonGo event date conflicts instead of overwriting official values", () => {
    const race = baseRace({ name: "2026 올림픽공원 사우나런", eventDate: "2026-08-01" });
    const dateConflict = parseOfficialPage(
      "<h1>2026 올림픽공원 사우나런</h1><p>대회일 2026년 8월 1일</p><p>장소: 서울 올림픽공원 평화의광장</p>",
      "https://saunarun.example/date-conflict",
    );

    expect(
      mergeOfficialPage(
        race,
        dateConflict,
        "https://saunarun.example/date-conflict",
        "2026-01-02T00:00:00.000Z",
        trustedSaunarunDetail(),
      ),
    ).toEqual({ accepted: false, reason: "trusted-event-date-conflict" });
  });

  it("rejects trusted MarathonGo venue conflicts instead of overwriting official values", () => {
    const race = baseRace({ name: "2026 올림픽공원 사우나런", eventDate: "2026-07-31" });
    const venueConflict = parseOfficialPage(
      "<h1>2026 올림픽공원 사우나런</h1><p>대회일 2026년 7월 31일</p><p>장소: 부산 해운대</p>",
      "https://saunarun.example/venue-conflict",
    );

    expect(
      mergeOfficialPage(
        race,
        venueConflict,
        "https://saunarun.example/venue-conflict",
        "2026-01-02T00:00:00.000Z",
        trustedSaunarunDetail(),
      ),
    ).toEqual({ accepted: false, reason: "trusted-venue-conflict" });
  });
});
