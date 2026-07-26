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

const SOURCE_DETAIL_URL = "https://www.gorunning.co.kr/race/view.php?idx=1001";

function discover(html: string) {
  return discoverRaceLinks({
    race: makeRace(),
    sourceId: "gorunning",
    sourcePageUrl: SOURCE_DETAIL_URL,
    sourceHosts: ["www.gorunning.co.kr", "서울.example"],
    aggregatorHosts: ["gorunning.co.kr", "마라톤.example"],
    html,
    raceDetailContext: { present: true, sourceDetailUrl: SOURCE_DETAIL_URL },
  });
}

function urls(html: string): readonly string[] {
  return discover(html).map((link) => link.url);
}

describe("discovery URL policy", () => {
  it.each([
    "http://localhost/register",
    "https://race.local/register",
    "https://user:secret@apply.example/register",
    "http://127.0.0.1/register",
    "http://10.0.0.1/register",
    "http://169.254.1.1/register",
    "http://[::1]/register",
    "http://[fc00::1]/register",
    "http://[fe80::1]/register",
    "https://payments.example/checkout",
  ])("does not emit an unsafe explicit application URL: %s", (applicationUrl) => {
    expect(discover(`<a href="${applicationUrl}">참가신청</a>`)).toEqual([]);
  });

  it.each([
    "https://apply.example/register",
    "http://apply.example/register",
    "https://payments-marathon.example/register",
  ])("treats source-detail application URL as negative evidence only: %s", (applicationUrl) => {
    expect(discover(`<a href="${applicationUrl}">참가신청</a>`)).toEqual([]);
  });

  it("accepts explicit and structured official homepage links only from owned source detail HTML", () => {
    const html = `<a href="https://official.example.com/home?utm_source=x&id=1001#top">공식 홈페이지</a>
      <script type="application/ld+json">{
        "@type":"Event",
        "url":"https://event.example.com/race?utm_campaign=x&eventId=abc",
        "organizer":{"@type":"Organization","url":"https://organizer.example.com/home?fbclid=x&race=1"}
      }</script>`;

    expect(discover(html).map((link) => [link.kind, link.evidence, link.url])).toEqual([
      ["official-site", "explicit-label", "https://official.example.com/home?id=1001"],
      ["official-site", "structured-event", "https://event.example.com/race?eventId=abc"],
      ["official-site", "structured-organizer", "https://organizer.example.com/home?race=1"],
    ]);
  });

  it("rejects official homepage labels in source list HTML even when the list row names one race", () => {
    const links = discoverRaceLinks({
      race: makeRace(),
      sourceId: "gorunning",
      sourcePageUrl: "https://www.gorunning.co.kr/races/",
      sourceHosts: ["www.gorunning.co.kr"],
      aggregatorHosts: ["gorunning.co.kr"],
      html: `<article><h2>제25회 서울국제마라톤</h2><a href="https://official.example.com/home">공식 홈페이지</a></article>`,
      raceDetailContext: { present: false },
    });

    expect(links).toEqual([]);
  });

  it("fails closed when detail discovery lacks the owned source detail URL", () => {
    const links = discoverRaceLinks({
      race: makeRace(),
      sourceId: "gorunning",
      sourcePageUrl: SOURCE_DETAIL_URL,
      sourceHosts: ["www.gorunning.co.kr"],
      aggregatorHosts: ["gorunning.co.kr"],
      html: `<a href="https://official.example.com/home">공식 홈페이지</a>`,
      raceDetailContext: { present: true },
    });

    expect(links).toEqual([]);
  });

  it("rejects generic nav, social/share, CDN, admin/member, payment, file, self, and unlabeled links", () => {
    const html = `<a href="https://official.example.com/about">소개</a>
      <a href="https://facebook.com/race">공식 홈페이지</a>
      <a href="https://twitter.com/share?url=x">대회 홈페이지</a>
      <a href="https://cdn.example.com/site">홈페이지</a>
      <a href="https://official.example.com/admin">공식 홈페이지</a>
      <a href="https://official.example.com/member/login">홈페이지</a>
      <a href="https://pay.example.com/checkout">공식 홈페이지</a>
      <a href="https://official.example.com/billing">대회 홈페이지</a>
      <a href="https://official.example.com/purchase">홈페이지</a>
      <a href="https://official.example.com/file.pdf">대회 홈페이지</a>
      <a href="https://www.gorunning.co.kr/race/view.php?idx=1001">공식 홈페이지</a>
      <a href="https://unlabeled.example.com/race"></a>`;

    expect(discover(html)).toEqual([]);
  });

  it("rejects encoded blocked paths, file extensions, and malformed path escapes", () => {
    const html = `<a href="https://official.example.com/%61dmin">공식 홈페이지</a>
      <a href="https://official.example.com/%2fadmin">대회 홈페이지</a>
      <a href="https://official.example.com/%2Fmember">홈페이지</a>
      <a href="https://official.example.com/file%2epdf">공식 홈페이지</a>
      <a href="https://official.example.com/%E0%A4%A">대회 홈페이지</a>`;

    expect(discover(html)).toEqual([]);
  });

  it("rejects double-encoded blocked paths and file extensions", () => {
    const html = `<a href="https://official.example.com/%2561dmin">공식 홈페이지</a>
      <a href="https://official.example.com/%252fadmin">대회 홈페이지</a>
      <a href="https://official.example.com/%252Fmember">홈페이지</a>
      <a href="https://official.example.com/pay%252Fcheckout">공식 홈페이지</a>
      <a href="https://official.example.com/file%252epdf">대회 홈페이지</a>`;

    expect(discover(html)).toEqual([]);
  });

  it("rejects credentialed explicit and structured URLs instead of rewriting them", () => {
    const html = `<a href="https://user:pass@official.example.com/home">공식 홈페이지</a>
      <script type="application/ld+json">{
        "@type":"Event",
        "url":"https://user@event.example.com/race?eventId=abc",
        "organizer":{"@type":"Organization","url":"https://:pass@organizer.example.com/home?event=2025"}
      }</script>`;

    expect(discover(html)).toEqual([]);
  });

  it("normalizes terminal-dot, case, and IDNA host forms before exclusions", () => {
    const html = `<a href="https://WWW.GoRunning.co.kr./race/view.php?idx=1001">공식 홈페이지</a>
      <a href="https://서울.example./home">공식 홈페이지</a>
      <a href="https://마라톤.example./home">대회 홈페이지</a>
      <a href="https://FACEBOOK.com./race">홈페이지</a>
      <a href="https://static.Example.com./home">공식 홈페이지</a>
      <a href="https://assets.example.com./home">대회 홈페이지</a>
      <a href="https://cdn.example.com./home">홈페이지</a>`;

    expect(discover(html)).toEqual([]);
  });

  it("rejects dedicated payment hosts with benign paths without substring false positives", () => {
    const html = `<a href="https://pay.example.com/home">공식 홈페이지</a>
      <a href="https://payment.example.com./home">대회 홈페이지</a>
      <a href="https://sub.checkout.example.com/home">홈페이지</a>
      <a href="https://payments.example/home">공식 홈페이지</a>
      <a href="https://billing.example/home">대회 홈페이지</a>
      <a href="https://PAY.example.com/home">공식 홈페이지</a>
      <a href="https://payments-marathon.example/home">대회 홈페이지</a>
      <a href="https://checkout-race.example/home">홈페이지</a>`;

    expect(urls(html)).toEqual([
      "https://payments-marathon.example/home",
      "https://checkout-race.example/home",
    ]);
  });

  it("serializes output hostnames in canonical DNS-equivalent forms", () => {
    const html = `<a href="https://Official.Example.com./home?utm_source=x&id=1001#top">공식 홈페이지</a>
      <a href="https://official.example.com/home?id=1001">공식 홈페이지</a>
      <a href="https://예시.example./race?eventId=abc&utm_campaign=x#frag">대회 홈페이지</a>
      <a href="https://XN--VV4B11D.EXAMPLE/race?eventId=abc">대회 홈페이지</a>`;

    expect(urls(html)).toEqual([
      "https://official.example.com/home?id=1001",
      "https://xn--vv4b11d.example/race?eventId=abc",
    ]);
  });

  it("keeps deterministic evidence when canonical host duplicates collapse", () => {
    const links =
      discover(`<a href="https://Official.Example.com./home?event=2025">공식 홈페이지</a>
      <a href="https://official.example.com/home?event=2025">공식 홈페이지</a>`);

    expect(links.map((link) => [link.evidence, link.url])).toEqual([
      ["explicit-label", "https://official.example.com/home?event=2025"],
    ]);
  });

  it("makes absent race-detail context unbypassable", () => {
    const inputContext: Parameters<typeof discoverRaceLinks>[0]["raceDetailContext"] = {
      present: false,
    };
    const links = discoverRaceLinks({
      race: makeRace(),
      sourceId: "gorunning",
      sourcePageUrl: "https://www.gorunning.co.kr/race/list.php",
      sourceHosts: ["www.gorunning.co.kr"],
      aggregatorHosts: ["gorunning.co.kr"],
      html: `<a href="https://official.example.com/home">공식 홈페이지</a>`,
      raceDetailContext: inputContext,
    });

    expect(links).toEqual([]);
    expect(Object.keys(inputContext)).toEqual(["present"]);
  });
});
