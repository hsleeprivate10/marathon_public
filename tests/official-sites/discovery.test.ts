import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detailFixtureName } from "../../src/adapters/detail-source-url.js";
import type { Race } from "../../src/contract.js";
import { dedupKey } from "../../src/normalize.js";
import { discoverRaceLinks } from "../../src/official-sites/discovery.js";
function makeRace(overrides: Partial<Race> = {}): Race {
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
    ...overrides,
  };
}
function discover(html: string, race: Race = makeRace()) {
  return discoverRaceLinks({
    race,
    sourceId: "gorunning",
    sourcePageUrl: "https://www.gorunning.co.kr/race/view.php?idx=1001",
    sourceHosts: ["www.gorunning.co.kr"],
    aggregatorHosts: ["gorunning.co.kr", "www.gorunning.co.kr"],
    html,
    raceDetailContext: { present: true },
  });
}
describe("discoverRaceLinks", () => {
  it("classifies explicit Korean homepage labels as official-site candidates", () => {
    // Given a race detail page with explicit official homepage labels
    const html = `<a href="https://official.example.com/a?utm_campaign=x&id=1001#section">공식 홈페이지</a>
      <a href="https://race.example.org/home">대회 홈페이지</a>
      <a href="https://home.example.net/">홈페이지</a>`;
    // When links are discovered
    const links = discover(html);
    // Then every explicit homepage label becomes an official-site candidate
    expect(links.map((link) => [link.kind, link.evidence, link.url])).toEqual([
      ["official-site", "explicit-label", "https://official.example.com/a?id=1001"],
      ["official-site", "explicit-label", "https://race.example.org/home"],
      ["official-site", "explicit-label", "https://home.example.net/"],
    ]);
  });
  it("classifies structured Event URLs as official-site candidates", () => {
    // Given Event JSON-LD with a public URL
    const html = `<script type="application/ld+json">{
      "@context":"https://schema.org",
      "@type":"Event",
      "url":"https://event.example.com/race?utm_source=x&eventId=abc#top"
    }</script>`;
    // When structured data is discovered
    const links = discover(html);
    // Then the Event URL is official with structured-event evidence
    expect(links).toEqual([
      {
        dedupKey: dedupKey(makeRace()),
        kind: "official-site",
        url: "https://event.example.com/race?eventId=abc",
        sourceId: "gorunning",
        sourcePageUrl: "https://www.gorunning.co.kr/race/view.php?idx=1001",
        evidence: "structured-event",
      },
    ]);
  });
  it("classifies structured organizer URLs as official-site candidates", () => {
    // Given organizer JSON-LD with a public URL
    const html = `<script type="application/ld+json">{
      "@type":"Event",
      "organizer":{"@type":"Organization","url":"https://organizer.example.com/marathon?fbclid=x&event=2025"}
    }</script>`;
    // When structured data is discovered
    const links = discover(html);
    // Then the organizer URL is official with structured-organizer evidence
    expect(links.map((link) => [link.kind, link.evidence, link.url])).toEqual([
      [
        "official-site",
        "structured-organizer",
        "https://organizer.example.com/marathon?event=2025",
      ],
    ]);
  });
  it("classifies Korean application labels as application only", () => {
    // Given registration labels including 신청하기
    const html = `<a href="https://apply.example.com/register">참가신청</a>
      <a href="https://apply.example.com/open">접수</a>
      <a href="https://apply.example.com/start">신청하기</a>`;
    // When links are discovered
    const links = discover(html);
    // Then they are applications and never official sites
    expect(links.map((link) => link.kind)).toEqual(["application", "application", "application"]);
    expect(links.some((link) => link.kind === "official-site")).toBe(false);
  });
  it("classifies registration destinations across structured and explicit evidence", () => {
    const html = `<a href="https://official.example.com/Register.php?utm_source=x&race=1">공식 홈페이지</a>
      <script type="application/ld+json">{
        "@type":"Event",
        "url":"https://event.example.com/Registration.html?utm_medium=x&id=7",
        "organizer":{"@type":"Organization","url":"https://organizer.example.com/%41PPLICATION.aspx?fbclid=x&org=1"}
      }</script>`;
    const links = discover(html);
    expect(links.map((link) => [link.kind, link.evidence, link.url])).toEqual([
      ["application", "explicit-label", "https://official.example.com/Register.php?race=1"],
      ["application", "structured-event", "https://event.example.com/Registration.html?id=7"],
      [
        "application",
        "structured-organizer",
        "https://organizer.example.com/%41PPLICATION.aspx?org=1",
      ],
    ]);
  });
  it("rejects payment registration destinations and keeps benign homepage destinations official", () => {
    const payment = discover(`<a href="https://payments.example/register">공식 홈페이지</a>
      <script type="application/ld+json">{"@type":"Event","url":"https://race.example.com/payment/register"}</script>`);
    const benign = discover(`<a href="https://registration-guide.example/event">공식 홈페이지</a>
      <script type="application/ld+json">{
        "@type":"Event",
        "url":"https://official.example.com/register-run",
        "organizer":{"url":"https://official.example.com/application-guide"}
      }</script>`);
    expect(payment).toEqual([]);
    expect(benign.map((link) => [link.kind, link.evidence, link.url])).toEqual([
      ["official-site", "explicit-label", "https://registration-guide.example/event"],
      ["official-site", "structured-event", "https://official.example.com/register-run"],
      ["official-site", "structured-organizer", "https://official.example.com/application-guide"],
    ]);
  });
  it("deduplicates the same canonical registration URL as one application candidate", () => {
    const html = `<a href="https://apply.example.com/register?utm_source=x&id=1#top">공식 홈페이지</a>
      <script type="application/ld+json">{
        "@type":"Event",
        "url":"https://apply.example.com/register?id=1",
        "organizer":{"url":"https://apply.example.com/register?id=1&utm_medium=y"}
      }</script>`;
    const links = discover(html);
    expect(links.map((link) => [link.kind, link.evidence, link.url])).toEqual([
      ["application", "explicit-label", "https://apply.example.com/register?id=1"],
    ]);
  });
  it("resolves relative URLs and canonicalizes only tracking noise", () => {
    // Given a relative application link and official link with tracking and event IDs
    const html = `<a href="/apply?utm_medium=email&idx=1001&eventId=abc#form">참가신청</a>
      <a href="https://official.example.com/path?utm_source=x&gclid=y&id=1001&event=2025#frag">공식 홈페이지</a>`;
    // When links are discovered
    const links = discover(html);
    // Then relative URLs resolve and event query identifiers are preserved
    expect(links.map((link) => link.url)).toEqual([
      "https://www.gorunning.co.kr/apply?idx=1001&eventId=abc",
      "https://official.example.com/path?id=1001&event=2025",
    ]);
  });
  it("binds every candidate to exactly the canonical race dedup key", () => {
    // Given a specific race identity
    const race = makeRace({ name: "2025 경주벚꽃마라톤대회", eventDate: "2025-04-05" });
    // When a link is discovered for that race detail
    const links = discover(`<a href="https://cherry.example.com">대회 홈페이지</a>`, race);
    // Then the candidate identity exactly matches dedupKey(race)
    expect(links.map((link) => link.dedupKey)).toEqual([dedupKey(race)]);
  });
  it("requires a race detail context before discovering links", () => {
    // Given a source page that is not a race detail context
    const race = makeRace();
    // When discovery is called without the required detail indicator
    const links = discoverRaceLinks({
      race,
      sourceId: "gorunning",
      sourcePageUrl: "https://www.gorunning.co.kr/race/list.php",
      sourceHosts: ["www.gorunning.co.kr"],
      aggregatorHosts: ["gorunning.co.kr", "www.gorunning.co.kr"],
      html: `<a href="https://official.example.com">공식 홈페이지</a>`,
      raceDetailContext: { present: false },
    });
    // Then no arbitrary page-wide external link is classified
    expect(links).toEqual([]);
  });
  it("treats malformed and untrusted HTML as inert text", () => {
    // Given malformed JSON-LD, executable scripts, and prompt-like content
    const html = readFileSync("tests/fixtures/official-sites/discovery-malformed.html", "utf8");
    // When discovery parses it as inert text
    const links = discover(html);
    // Then no script URL or prompt-suggested URL is obeyed
    expect(links).toEqual([]);
  });
  it("discovers ordered candidates from the positive official-home fixture", () => {
    // Given a positive detail fixture containing labels and JSON-LD
    const html = readFileSync("tests/fixtures/official-sites/discovery-positive.html", "utf8");
    // When discovery runs end-to-end
    const links = discover(html);
    // Then explicit, application, Event, and organizer links are classified conservatively
    expect(links.map((link) => [link.kind, link.evidence, link.url])).toEqual([
      ["official-site", "explicit-label", "https://official.example.com/event?eventId=1001"],
      ["application", "explicit-label", "https://www.gorunning.co.kr/race/view.php?idx=1001"],
      ["official-site", "structured-event", "https://event.example.org/home?id=seoul-2025"],
      [
        "official-site",
        "structured-organizer",
        "https://organizer.example.net/seoul-marathon?event=2025",
      ],
    ]);
  });
  it("keeps 신청하기 from the existing GoRunning detail fixture as application only", () => {
    // Given the existing GoRunning detail fixture that has only 신청하기
    const fixture = detailFixtureName("/race/view.php?idx=1001", "https://gorunning.kr");
    const html = readFileSync(`tests/fixtures/gorunning/${fixture}`, "utf8");
    // When discovery runs on the detail fixture
    const links = discover(html);
    // Then the 신청하기 link is not promoted to official-site
    expect(links.map((link) => [link.kind, link.url])).toEqual([
      ["application", "https://www.gorunning.co.kr/race/view.php?idx=1001"],
    ]);
  });
});
