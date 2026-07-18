import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { discoverRaceLinks } from "../../src/official-sites/discovery.js";

function makeRace(): Race {
  const now = "2025-01-15T12:00:00.000Z";
  return {
    name: "제25회 서울국제마라톤",
    eventDate: "2025-03-16",
    registrationDeadline: "2025-02-28",
    venue: "서울시청 앞 광장",
    courses: [{ name: "풀", price: 70000 }],
    applicationUrl: "https://www.gorunning.co.kr/race/view.php?idx=1001",
    sources: ["gorunning"],
    verified: true,
    lastVerified: now,
    updatedAt: now,
    generatedAt: now,
    registrationStatus: "open",
  };
}

function discover(html: string) {
  return discoverRaceLinks({
    race: makeRace(),
    sourceId: "gorunning",
    sourcePageUrl: "https://www.gorunning.co.kr/race/view.php?idx=1001",
    sourceHosts: ["www.gorunning.co.kr"],
    aggregatorHosts: ["gorunning.co.kr", "www.gorunning.co.kr"],
    html,
    raceDetailContext: { present: true },
  });
}

function rows(html: string) {
  return discover(html).map((link) => [link.kind, link.evidence, link.url]);
}

describe("cross-evidence canonical deduplication", () => {
  it("keeps one explicit official candidate when JSON-LD appears before matching anchor text", () => {
    const html = `<script type="application/ld+json">{
        "@type":"Event",
        "url":"https://dup.example/home?eventId=abc&utm_source=x",
        "organizer":{"url":"https://dup.example./home?eventId=abc"}
      }</script>
      <a href="https://DUP.example./home?eventId=abc#top">공식 홈페이지</a>`;

    expect(rows(html)).toEqual([
      ["official-site", "explicit-label", "https://dup.example/home?eventId=abc"],
    ]);
  });

  it("keeps one explicit official candidate when JSON-LD appears after matching anchor text", () => {
    const html = `<a href="https://예시.example./race?event=2025">대회 홈페이지</a>
      <script type="application/ld+json">{
        "@type":"Event",
        "url":"https://xn--vv4b11d.example/race?event=2025",
        "organizer":[
          {"url":"https://예시.example/race?event=2025"},
          "https://xn--vv4b11d.example./race?event=2025"
        ]
      }</script>`;

    expect(rows(html)).toEqual([
      ["official-site", "explicit-label", "https://xn--vv4b11d.example/race?event=2025"],
    ]);
  });

  it("prefers structured Event over duplicate organizer URLs when no explicit link exists", () => {
    const html = `<script type="application/ld+json">{
      "@type":"Event",
      "organizer":[
        {"url":"https://struct.example/home?id=7"},
        {"url":"https://STRUCT.example./home?id=7&utm_medium=x"}
      ],
      "url":"https://struct.example./home?id=7#event"
    }</script>`;

    expect(rows(html)).toEqual([
      ["official-site", "structured-event", "https://struct.example/home?id=7"],
    ]);
  });

  it("keeps application semantics when an application and official candidate share a URL", () => {
    const html = `<a href="https://same.example/register?idx=1001">참가신청</a>
      <a href="https://same.example/register?idx=1001&utm_source=x">공식 홈페이지</a>
      <script type="application/ld+json">{
        "@type":"Event",
        "url":"https://same.example/register?idx=1001#official"
      }</script>`;

    expect(rows(html)).toEqual([
      ["application", "explicit-label", "https://same.example/register?idx=1001"],
    ]);
  });
});
