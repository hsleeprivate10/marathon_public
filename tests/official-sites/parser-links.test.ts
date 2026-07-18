import { describe, expect, it } from "vitest";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

describe("parseOfficialPage registration links", () => {
  it("ignores fake registration anchors in title, quoted attributes, raw text, comments, and malformed tags", () => {
    for (const html of [
      `<title><a href="https://fake.example/title">참가신청</a></title><h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><div data-note="<a href='https://fake.example/double-attr'>참가신청</a>">x</div><span data-note='<a href="https://fake.example/single-attr">참가신청</a>'>x</span>`,
      `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><div data-note="<a href='https://fake.example/unterminated'>참가신청</a><a href="https://fake.example/after">참가신청</a>`,
      `<h1>2026 서울국제마라톤</h1><script>const a = '<a href="https://fake.example/script">참가신청</a>';</script><style>.x::before { content: '<a href="https://fake.example/style">참가신청</a>'; }</style><textarea><a href="https://fake.example/textarea">참가신청</a></textarea><template><a href="https://fake.example/template">참가신청</a></template><!-- <a href="https://fake.example/comment">참가신청</a> -->`,
    ])
      expect(parseOfficialPage(html, "https://official.example/seoul").registrationUrl).toBeNull();
  });

  it("ignores fake registration anchors across HTML5 inert and bogus contexts", () => {
    const html = `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><!DOCTYPE html><!-- <a href="https://fake.example/comment">참가신청</a> --><![CDATA[<a href="https://fake.example/cdata">참가신청</a>]]><?xml <a href="https://fake.example/pi">참가신청</a> ?><!bogus <a href="https://fake.example/bogus">참가신청</a>><title><a href="https://fake.example/title">참가신청</a></title><xmp><a href="https://fake.example/xmp">참가신청</a></xmp><iframe><a href="https://fake.example/iframe">참가신청</a></iframe><noembed><a href="https://fake.example/noembed">참가신청</a></noembed><noframes><a href="https://fake.example/noframes">참가신청</a></noframes><plaintext><a href="https://fake.example/plaintext">참가신청</a><script>const a = '<a href="https://fake.example/script">참가신청</a>';</script><style>.x{content:'<a href="https://fake.example/style">참가신청</a>';}</style><textarea><a href="https://fake.example/textarea">참가신청</a></textarea><template><a href="https://fake.example/template">참가신청</a></template>`;
    expect(parseOfficialPage(html, "https://official.example/seoul").registrationUrl).toBeNull();
  });

  it("rejects unsafe application registration URLs without DNS or fetch", () => {
    const blocked = [
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
    ];
    for (const href of blocked) {
      const parsed = parseOfficialPage(
        `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><a href="${href}">참가신청</a>`,
        "https://official.example/seoul",
      );
      expect(parsed.registrationUrl, href).toBeNull();
    }
    for (const href of [
      "https://apply.example/apply",
      "http://public.example/apply",
      "https://payments-marathon.example/apply",
    ]) {
      const parsed = parseOfficialPage(
        `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><a href="${href}">참가신청</a>`,
        "https://official.example/seoul",
      );
      expect(parsed.registrationUrl, href).toBe(href);
    }
  });

  it("keeps a visible safe registration anchor", () => {
    expect(
      parseOfficialPage(
        `<h1>2026 서울국제마라톤</h1><a href="https://apply.example/visible">참가신청</a>`,
        "https://official.example/seoul",
      ).registrationUrl,
    ).toBe("https://apply.example/visible");
  });
});
