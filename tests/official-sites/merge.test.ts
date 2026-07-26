import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { mergeOfficialPage } from "../../src/official-sites/merge.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

const fixture = (name: string) => readFileSync(`tests/fixtures/official-sites/${name}`, "utf8");
const baseRace = (overrides: Partial<Race> = {}): Race => ({
  name: "2026 서울국제마라톤",
  eventDate: "2026-03-15",
  registrationDeadline: null,
  venue: "미상",
  courses: [
    { name: "풀", price: null },
    { name: "5K", price: 10000 },
  ],
  applicationUrl: "https://source.example/apply",
  sources: ["gorunning"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "unknown",
  ...overrides,
});

describe("mergeOfficialPage", () => {
  it("replaces an adapter logo with a matching accepted official event logo", () => {
    const race = baseRace({ logoUrl: "https://adapter.example/seoul-logo.png" });
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"서울월드컵공원 평화광장","logo":"/media/seoul-event-logo.png"}</script><h1>2026 서울국제마라톤</h1>`,
      "https://official.example/seoul-2026-logo",
    );

    const result = mergeOfficialPage(race, parsed, "https://official.example/seoul-2026-logo");

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.logoUrl).toBe("https://official.example/media/seoul-event-logo.png");
  });

  it.each([
    ["absent", fixture("matching-event.html")],
    [
      "wrong event",
      `<script type="application/ld+json">[{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"서울월드컵공원 평화광장"},{"@type":"Event","name":"2026 부산바다마라톤","startDate":"2026-03-15","logo":"/media/busan-logo.png"}]</script><h1>2026 서울국제마라톤</h1>`,
    ],
    [
      "unsafe",
      `<script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"서울월드컵공원 평화광장","logo":"http://images.example/seoul-logo.png"}</script><h1>2026 서울국제마라톤</h1>`,
    ],
    [
      "ambiguous",
      `<script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"서울월드컵공원 평화광장","logo":["/media/first-logo.png","/media/second-logo.png"]}</script><h1>2026 서울국제마라톤</h1>`,
    ],
    [
      "a misleading body-only image",
      `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><p>장소: 서울월드컵공원 평화광장</p><img src="/media/site-logo.png" alt="2026 서울국제마라톤 로고">`,
    ],
  ])("preserves an adapter logo when accepted official logo evidence is %s", (_case, html) => {
    const race = baseRace({ logoUrl: "https://adapter.example/seoul-logo.png" });
    const parsed = parseOfficialPage(html, "https://official.example/seoul-2026");

    const result = mergeOfficialPage(race, parsed, "https://official.example/seoul-2026");

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.logoUrl).toBeUndefined();
  });

  it("returns only a typed reason when official identity is rejected", () => {
    const race = baseRace({ logoUrl: "https://adapter.example/seoul-logo.png" });
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"2026 부산바다마라톤","startDate":"2026-03-15","logo":"/media/busan-logo.png"}</script><h1>2026 부산바다마라톤</h1>`,
      "https://official.example/busan",
    );

    expect(mergeOfficialPage(race, parsed, "https://official.example/busan")).toEqual({
      accepted: false,
      reason: "name-mismatch",
    });
  });

  it("rejects a payment final official URL without changing the race", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(
      fixture("matching-event.html"),
      "https://official.example/seoul-2026",
    );

    expect(
      mergeOfficialPage(
        race,
        parsed,
        "https://payments.example/checkout",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toEqual({ accepted: false, reason: "unsafe-official-url" });
  });

  it("rejects a registration final official URL without changing the race", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(fixture("matching-event.html"), "https://official.example/");

    expect(mergeOfficialPage(race, parsed, "https://official.example/register.action")).toEqual({
      accepted: false,
      reason: "unsafe-official-url",
    });
  });

  it("authoritatively enriches accepted official data without changing name/date", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(
      fixture("matching-event.html"),
      "https://official.example/seoul-2026",
    );
    const result = mergeOfficialPage(
      race,
      parsed,
      "https://official.example/final",
      "2026-01-02T00:00:00.000Z",
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.name).toBe("2026 서울국제마라톤");
    expect(result.race.eventDate).toBe("2026-03-15");
    expect(result.race.officialSiteUrl).toBe("https://official.example/final");
    expect(result.race.venue).toBe("서울월드컵공원 평화광장");
    expect(result.race.registrationDeadline).toBe("2026-02-28");
    expect(result.race.applicationUrl).toBe("https://apply.example/seoul");
    expect(result.race.verified).toBe(true);
    expect(result.race.lastVerified).toBe("2026-01-02T00:00:00.000Z");
    expect(result.race.registrationStatus).toBe("closed");
    expect(result.race.courses).toEqual([
      { name: "풀", price: 70000, priceSource: "structured" },
      { name: "10K", price: 40000, priceSource: "structured" },
      { name: "하프", price: 55000, priceSource: "body-text" },
    ]);
  });

  it("returns typed rejections and leaves mismatched races unchanged", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(
      fixture("mismatch-event.html"),
      "https://official.example/busan",
    );
    expect(
      mergeOfficialPage(race, parsed, "https://official.example/busan", "2026-01-02T00:00:00.000Z"),
    ).toEqual({ accepted: false, reason: "name-mismatch" });
  });

  it("rejects accepted identity when required official fields are absent", () => {
    const race = baseRace({
      name: "춘천호수마라톤",
      eventDate: "2026-04-12",
      venue: "춘천 공지천",
      registrationDeadline: "2026-03-01",
    });
    const parsed = {
      names: ["춘천호수마라톤"],
      eventDate: null,
      eventDates: [],
      venue: null,
      registrationDeadline: null,
      courses: [],
      registrationUrl: "https://user:pass@example.com/join",
    };
    const result = mergeOfficialPage(
      race,
      parsed,
      "https://lake.example/final",
      "2026-01-02T00:00:00.000Z",
    );
    expect(result).toEqual({ accepted: false, reason: "missing-event-date" });
  });
});
