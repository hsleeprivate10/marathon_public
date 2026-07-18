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
    ).toEqual({ accepted: false, reason: "unsafe-official-url", race });
  });

  it("rejects a registration final official URL without changing the race", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(fixture("matching-event.html"), "https://official.example/");

    expect(mergeOfficialPage(race, parsed, "https://official.example/register.action")).toEqual({
      accepted: false,
      reason: "unsafe-official-url",
      race,
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
    expect(result.race.name).toBe(race.name);
    expect(result.race.eventDate).toBe(race.eventDate);
    expect(result.race.officialSiteUrl).toBe("https://official.example/final");
    expect(result.race.venue).toBe("서울월드컵공원 평화광장");
    expect(result.race.registrationDeadline).toBe("2026-02-28");
    expect(result.race.applicationUrl).toBe("https://apply.example/seoul");
    expect(result.race.verified).toBe(true);
    expect(result.race.lastVerified).toBe("2026-01-02T00:00:00.000Z");
    expect(result.race.registrationStatus).toBe("closed");
    expect(result.race.courses).toEqual([
      { name: "풀", price: 70000, priceSource: "structured" },
      { name: "5K", price: 10000 },
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
    ).toEqual({ accepted: false, reason: "name-mismatch", race });
  });

  it("preserves original values when accepted official fields are absent or unsafe", () => {
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
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(result.race.venue).toBe("춘천 공지천");
    expect(result.race.registrationDeadline).toBe("2026-03-01");
    expect(result.race.applicationUrl).toBe("https://source.example/apply");
  });

  it("does not replace applicationUrl from fake raw-text registration anchors", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(
      `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p>
      <script>const a = '<a href="https://fake.example/script">참가신청</a>';</script>
      <style>.x { content: '<a href="https://fake.example/style">참가신청</a>'; }</style>
      <textarea><a href="https://fake.example/textarea">참가신청</a></textarea>
      <template><a href="https://fake.example/template">참가신청</a></template>
      <!-- <a href="https://fake.example/comment">참가신청</a> -->`,
      "https://official.example/seoul",
    );

    const result = mergeOfficialPage(
      race,
      parsed,
      "https://official.example/final",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(parsed.registrationUrl).toBeNull();
    expect(result.race.applicationUrl).toBe(race.applicationUrl);
  });

  it("does not replace applicationUrl from title or quoted-attribute fake anchors", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(
      `<title><a href="https://fake.example/title">참가신청</a></title>
      <h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p>
      <div data-note="<a href='https://fake.example/double-attr'>참가신청</a>">x</div>
      <span data-note='<a href="https://fake.example/single-attr">참가신청</a>'>x</span>`,
      "https://official.example/seoul",
    );
    const result = mergeOfficialPage(
      race,
      parsed,
      "https://official.example/final",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(parsed.registrationUrl).toBeNull();
    expect(result.race.applicationUrl).toBe(race.applicationUrl);
  });

  it("does not replace applicationUrl from HTML5 inert or bogus fake registration anchors", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(
      `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p>
      <!DOCTYPE html><!-- <a href="https://fake.example/comment">참가신청</a> -->
      <![CDATA[<a href="https://fake.example/cdata">참가신청</a>]]>
      <?xml <a href="https://fake.example/pi">참가신청</a> ?>
      <!bogus <a href="https://fake.example/bogus">참가신청</a>>
      <title><a href="https://fake.example/title">참가신청</a></title>
      <xmp><a href="https://fake.example/xmp">참가신청</a></xmp>
      <iframe><a href="https://fake.example/iframe">참가신청</a></iframe>
      <noembed><a href="https://fake.example/noembed">참가신청</a></noembed>
      <noframes><a href="https://fake.example/noframes">참가신청</a></noframes>
      <plaintext><a href="https://fake.example/plaintext">참가신청</a>
      <script>const a = '<a href="https://fake.example/script">참가신청</a>';</script>
      <style>.x{content:'<a href="https://fake.example/style">참가신청</a>';}</style>
      <textarea><a href="https://fake.example/textarea">참가신청</a></textarea>
      <template><a href="https://fake.example/template">참가신청</a></template>`,
      "https://official.example/seoul",
    );
    const result = mergeOfficialPage(
      race,
      parsed,
      "https://official.example/final",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(parsed.registrationUrl).toBeNull();
    expect(result.race.applicationUrl).toBe(race.applicationUrl);
  });

  it("does not replace applicationUrl from unsafe application registration URLs", () => {
    const race = baseRace();
    for (const href of [
      "https://localhost/apply",
      "https://race.local/apply",
      "https://user:pass@apply.example/apply",
      "http://127.0.0.1/apply",
      "http://10.0.0.1/apply",
      "http://172.16.0.1/apply",
      "http://192.168.1.1/apply",
      "http://169.254.1.1/apply",
      "http://[::1]/apply",
      "http://[fc00::1]/apply",
      "http://[fe80::1]/apply",
      "https://payments.example/checkout",
    ]) {
      const parsed = parseOfficialPage(
        `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><a href="${href}">참가신청</a>`,
        "https://official.example/seoul",
      );
      const result = mergeOfficialPage(
        race,
        parsed,
        "https://official.example/final",
        "2026-01-02T00:00:00.000Z",
      );
      expect(result.accepted, href).toBe(true);
      if (!result.accepted) throw new Error(result.reason);
      expect(parsed.registrationUrl, href).toBeNull();
      expect(result.race.applicationUrl, href).toBe(race.applicationUrl);
    }
  });

  it("does not replace applicationUrl after malformed quoted fake-anchor tags", () => {
    const race = baseRace();
    const parsed = parseOfficialPage(
      `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p>
      <div data-note="<a href='https://fake.example/unterminated'>참가신청</a>
      <a href="https://fake.example/after">참가신청</a>`,
      "https://official.example/seoul",
    );
    const result = mergeOfficialPage(
      race,
      parsed,
      "https://official.example/final",
      "2026-01-02T00:00:00.000Z",
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(parsed.registrationUrl).toBeNull();
    expect(result.race.applicationUrl).toBe(race.applicationUrl);
  });
});
