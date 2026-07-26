import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { checkOfficialPageIdentity } from "../../src/official-sites/identity.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

const fixture = (name: string) => readFileSync(`tests/fixtures/official-sites/${name}`, "utf8");
const identityRace: Race = {
  name: "2026 서울국제마라톤",
  eventDate: "2026-03-15",
  registrationDeadline: null,
  venue: "미상",
  courses: [],
  applicationUrl: "https://source.example/apply",
  sources: ["test"],
  verified: false,
  lastVerified: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "unknown",
};

describe("parseOfficialPage JSON-LD", () => {
  it("retains matching event logo candidates without changing official Event fields", () => {
    const parsed = parseOfficialPage(
      fixture("matching-event-logo.html"),
      "https://official.example/seoul-2026-logo",
    );

    expect(parsed.logoCandidates).toEqual([
      {
        url: "https://official.example/media/seoul-event-logo.png",
        kind: "logo",
        eventDate: "2026-03-15",
        identity: "2026 서울국제마라톤",
        aggregatorEvidence: "2026 서울국제마라톤",
      },
    ]);
    expect(parsed.eventDate).toBe("2026-03-15");
  });

  it("prefers Event JSON-LD and explicit Korean labels for official fields", () => {
    const parsed = parseOfficialPage(
      fixture("matching-event.html"),
      "https://official.example/seoul-2026?utm_source=x#top",
    );
    expect(parsed.names).toEqual(expect.arrayContaining(["2026 서울국제마라톤"]));
    expect(parsed.eventDate).toBe("2026-03-15");
    expect(parsed.venue).toBe("서울월드컵공원 평화광장");
    expect(parsed.registrationDeadline).toBe("2026-02-28");
    expect(parsed.courses).toEqual([
      { name: "풀", price: 70000, priceSource: "structured" },
      { name: "10K", price: 40000, priceSource: "structured" },
      { name: "하프", price: 55000, priceSource: "body-text" },
    ]);
    expect(parsed.registrationUrl).toBe("https://apply.example/seoul");
  });

  it("retains all explicitly published race-level dates for identity conflict checks", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15"}</script><h1>2026 서울국제마라톤</h1><p>대회일시: 2027년 3월 15일</p>`,
      "https://official.example/seoul-2026",
    );
    expect(parsed.eventDate).toBe("2026-03-15");
    expect(parsed.eventDates).toEqual(["2026-03-15", "2027-03-15"]);
  });

  it("collects Event names and dates across multiple JSON-LD scripts while enriching from the first Event", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":{"name":"첫 장소"},"offers":[{"name":"풀","price":"70000"}]}</script><script type="application/ld+json">{"@type":"Event","name":"서울국제마라톤","startDate":"2027-03-15","location":{"name":"둘째 장소"},"offers":[{"name":"10K","price":"40000"}]}</script><h1>서울국제마라톤 공식</h1><title>서울국제마라톤 타이틀</title>`,
      "https://official.example/seoul",
    );
    expect(parsed.eventDate).toBe("2026-03-15");
    expect(parsed.eventDates).toEqual(["2026-03-15", "2027-03-15"]);
    expect(parsed.names).toEqual([
      "2026 서울국제마라톤",
      "서울국제마라톤",
      "서울국제마라톤 공식",
      "서울국제마라톤 타이틀",
    ]);
    expect(parsed.venue).toBe("첫 장소");
    expect(parsed.courses).toEqual([{ name: "풀", price: 70000, priceSource: "structured" }]);
    expect(checkOfficialPageIdentity(identityRace, parsed)).toEqual({
      accepted: false,
      reason: "date-mismatch",
    });
  });

  it("dedupes repeated matching Event names and dates across malformed and unrelated JSON-LD", () => {
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{bad json</script><script type="application/ld+json">[{"@type":"BreadcrumbList","name":"탐색"},{"@graph":[{"@type":"Event","name":"2026 서울국제마라톤","startDate":"2026-03-15","location":"첫 장소"},{"@type":"Event","name":"2026 서울국제마라톤","eventDate":"2026-03-15","location":"중복 장소"}]}]</script><script type="application/ld+json">{"@type":"Organization","name":"주최자"}</script><script type="application/ld+json">{"@graph":[{"@type":"Event","name":"서울국제마라톤","startDate":"2026-03-15"}]}</script><script type="application/ld+json">not json</script><h1>2026 서울국제마라톤</h1>`,
      "https://official.example/seoul",
    );
    expect(parsed.eventDate).toBe("2026-03-15");
    expect(parsed.eventDates).toEqual(["2026-03-15"]);
    expect(parsed.names).toEqual(["2026 서울국제마라톤", "서울국제마라톤"]);
    expect(parsed.venue).toBe("첫 장소");
    expect(checkOfficialPageIdentity(identityRace, parsed)).toMatchObject({ accepted: true });
  });

  it("rejects non-padded JSON-LD Event dates but accepts strict datetimes", () => {
    for (const startDate of ["2026/03/15", "2026-3-15", "2026-03-5"]) {
      const parsed = parseOfficialPage(
        `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"서울국제마라톤","startDate":"${startDate}"}</script><h1>서울국제마라톤</h1>`,
        "https://official.example/seoul",
      );
      expect(parsed.eventDate, startDate).toBeNull();
      expect(parsed.eventDates, startDate).toEqual([]);
      expect(checkOfficialPageIdentity(identityRace, parsed), startDate).toEqual({
        accepted: false,
        reason: "invalid-date",
      });
    }
    const parsed = parseOfficialPage(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"서울국제마라톤","startDate":"2026-03-15T09:00:00+09:00"}</script>`,
      "https://official.example/seoul",
    );
    expect(parsed.eventDate).toBe("2026-03-15");
  });

  it("keeps exact valid JSON-LD dates and rejects exact impossible JSON-LD dates", () => {
    const leap = parseOfficialPage(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"윤년마라톤","startDate":"2024-02-29"}</script><h1>윤년마라톤</h1>`,
      "https://official.example/leap",
    );
    const impossible = parseOfficialPage(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"오류마라톤","eventDate":"2025-02-29"}</script><h1>오류마라톤</h1>`,
      "https://official.example/bad-date",
    );
    expect(leap.eventDate).toBe("2024-02-29");
    expect(leap.eventDates).toEqual(["2024-02-29"]);
    expect(impossible.eventDate).toBeNull();
    expect(impossible.eventDates).toEqual([]);
    expect(impossible.events?.[0]?.eventDateStatus.kind).toBe("invalid");
  });
});
