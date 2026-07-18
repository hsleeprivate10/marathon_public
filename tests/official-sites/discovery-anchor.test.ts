import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { discoverRaceLinks } from "../../src/official-sites/discovery.js";
import { scanHtmlAnchors } from "../../src/official-sites/html-anchors.js";

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

describe("anchor href parsing", () => {
  it("accepts true href attributes with HTML-compatible quoting, case, order, and whitespace", () => {
    const html = `<a class="x" href="https://ok.example/double">공식 홈페이지</a>
      <a href='https://ok.example/single' data-x="1">대회 홈페이지</a>
      <a target=_blank href=https://ok.example/unquoted>홈페이지</a>
      <a
        DATA-X="1"
        HrEf = "https://ok.example/mixed"
      >공식 홈페이지</a>`;

    expect(discover(html).map((link) => link.url)).toEqual([
      "https://ok.example/double",
      "https://ok.example/single",
      "https://ok.example/unquoted",
      "https://ok.example/mixed",
    ]);
  });

  it("rejects fake href text and attribute-name prefix or suffix tricks", () => {
    const html = `<a data-href="https://bad.example/data">공식 홈페이지</a>
      <a aria-label="href=https://bad.example/aria">공식 홈페이지</a>
      <a title="href='https://bad.example/title'">대회 홈페이지</a>
      <a x-href="https://bad.example/x">홈페이지</a>
      <a href-extra="https://bad.example/extra">공식 홈페이지</a>
      <a onhref="https://bad.example/on">대회 홈페이지</a>
      <a class="href=https://bad.example/class">홈페이지</a>`;

    expect(discover(html)).toEqual([]);
  });

  it("does not leak malformed tag text as a href", () => {
    const html = `<a data-note="broken > href=https://bad.example/leak">공식 홈페이지</a>
      <a href=>대회 홈페이지</a>
      <a href "https://bad.example/no-equals">홈페이지</a>`;

    expect(discover(html)).toEqual([]);
  });

  it("keeps tag boundaries past greater-than signs inside quoted attributes before href", () => {
    const html = `<a title="1 > 0" href="https://ok.example/double">공식 홈페이지</a>
      <a title='1 > 0' href='https://ok.example/single'>대회 홈페이지</a>`;

    expect(discover(html).map((link) => link.url)).toEqual([
      "https://ok.example/double",
      "https://ok.example/single",
    ]);
  });

  it("skips malformed anchors without scavenging a later href or next anchor", () => {
    const cases = [
      `<a title="broken href="https://bad.example/double">공식 홈페이지</a>`,
      `<a title='broken href='https://bad.example/single'>대회 홈페이지</a>`,
      `<a title="unclosed href='https://bad.example/double>공식 홈페이지</a>
        <a href="https://bad.example/next-double">공식 홈페이지</a>`,
      `<a title='unclosed href="https://bad.example/single>대회 홈페이지</a>
        <a href="https://bad.example/next-single">대회 홈페이지</a>`,
      `<a title="x" href="https://bad.example/missing" 공식 홈페이지</a>
        <a href="https://bad.example/next-missing">공식 홈페이지</a>`,
      `<a title="quote spans <a href='https://bad.example/spanned'>공식 홈페이지</a>
        <a href="https://bad.example/next-spanned">공식 홈페이지</a>`,
    ];

    for (const html of cases) expect(discover(html)).toEqual([]);
  });

  it("keeps literal anchors inside script raw text inert", () => {
    const html = `<script>
        const anchor = '<a title="1 > 0" href="https://bad.example/script">공식 홈페이지</a>';
        const fakeClose = '</scr' + 'ipt><a href="https://bad.example/fake-close">공식 홈페이지</a>';
      </script>
      <SCRIPT type="text/plain">
        <a title='2 > 1' href='https://bad.example/plain'>대회 홈페이지</a>
        </script-like>
      </SCRIPT>`;

    expect(discover(html)).toEqual([]);
  });

  it("direct scanner ignores anchor-shaped text in title and quoted attributes", () => {
    const html = `<title><a href="https://bad.example/title">참가신청</a></title>
      <div data-note="<a href='https://bad.example/double-attr'>참가신청</a>">x</div>
      <span data-note='<a href="https://bad.example/single-attr">참가신청</a>'>x</span>
      <a href="https://ok.example/visible">참가신청</a>`;

    expect(scanHtmlAnchors(html)).toEqual([
      { href: "https://ok.example/visible", text: "참가신청" },
    ]);
  });

  it("direct scanner treats malformed quoted tags as a conservative stop", () => {
    const cases = [
      `<div title="<a href='https://bad.example/unterminated'>참가신청</a>
        <a href="https://bad.example/after">참가신청</a>`,
      `<div data-note='<a href="https://bad.example/single-unterminated">참가신청</a>
        <a href="https://bad.example/after-single">참가신청</a>`,
      `<a href="https://bad.example/malformed" 참가신청</a>
        <a href="https://bad.example/after-malformed">참가신청</a>`,
    ];

    for (const html of cases) expect(scanHtmlAnchors(html)).toEqual([]);
  });

  it("direct scanner uses HTML5 semantics for inert contexts and bogus markup", () => {
    const html = `<!DOCTYPE html>
      <!-- <a href="https://bad.example/comment">참가신청</a> -->
      <![CDATA[<a href="https://bad.example/cdata">참가신청</a>]]>
      <?xml <a href="https://bad.example/pi">참가신청</a> ?>
      <!bogus <a href="https://bad.example/bogus">참가신청</a>>
      <title><a href="https://bad.example/title">참가신청</a></title>
      <xmp><a href="https://bad.example/xmp">참가신청</a></xmp>
      <iframe><a href="https://bad.example/iframe">참가신청</a></iframe>
      <noembed><a href="https://bad.example/noembed">참가신청</a></noembed>
      <noframes><a href="https://bad.example/noframes">참가신청</a></noframes>
      <plaintext><a href="https://bad.example/plaintext">참가신청</a>
      <script>const a = '<a href="https://bad.example/script">참가신청</a>';</script>
      <style>.x{content:'<a href="https://bad.example/style">참가신청</a>';}</style>
      <textarea><a href="https://bad.example/textarea">참가신청</a></textarea>
      <template><a href="https://bad.example/template">참가신청</a></template>
      <div data-note="<a href='https://bad.example/double-attr'>참가신청</a>">x</div>
      <span data-note='<a href="https://bad.example/single-attr">참가신청</a>'>x</span>`;

    expect(scanHtmlAnchors(html)).toEqual([]);
  });

  it("direct scanner preserves valid HTML anchor forms under parse5", () => {
    const html = `<A HREF="https://ok.example/upper"><strong>참가</strong>신청</A>
      <a href='https://ok.example/single'>접수</a>
      <a href=https://ok.example/unquoted>신청</a>
      <a href="/relative"><span>참가신청</span></a>`;

    expect(scanHtmlAnchors(html)).toEqual([
      { href: "https://ok.example/upper", text: "참가신청" },
      { href: "https://ok.example/single", text: "접수" },
      { href: "https://ok.example/unquoted", text: "신청" },
      { href: "/relative", text: "참가신청" },
    ]);
  });

  it("treats unclosed script raw text as the end of scannable HTML", () => {
    const html = `<script>
        const anchor = '<a href="https://bad.example/script">공식 홈페이지</a>';
      <a href="https://bad.example/after-unclosed">공식 홈페이지</a>`;

    expect(discover(html)).toEqual([]);
  });
});
