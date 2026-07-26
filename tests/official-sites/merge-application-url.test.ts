import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { mergeOfficialPage } from "../../src/official-sites/merge.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";

const race: Race = {
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

const expectedApplicationUrl = "https://official.example/final";
const acceptedApplicationUrl = (html: string): string => {
  const parsed = parseOfficialPage(html, "https://official.example/seoul");
  const result = mergeOfficialPage(
    race,
    parsed,
    expectedApplicationUrl,
    "2026-01-02T00:00:00.000Z",
  );

  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.reason);
  expect(parsed.registrationUrl).toBeNull();
  return result.race.applicationUrl;
};

describe("mergeOfficialPage application URL materialization", () => {
  it("does not replace applicationUrl from fake raw-text registration anchors", () => {
    expect(
      acceptedApplicationUrl(`<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><p>장소: 서울월드컵공원 평화광장</p>
      <script>const a = '<a href="https://fake.example/script">참가신청</a>';</script>
      <style>.x { content: '<a href="https://fake.example/style">참가신청</a>'; }</style>
      <textarea><a href="https://fake.example/textarea">참가신청</a></textarea>
      <template><a href="https://fake.example/template">참가신청</a></template>
      <!-- <a href="https://fake.example/comment">참가신청</a> -->`),
    ).toBe(expectedApplicationUrl);
  });

  it("does not replace applicationUrl from title or quoted-attribute fake anchors", () => {
    expect(
      acceptedApplicationUrl(`<title><a href="https://fake.example/title">참가신청</a></title>
      <h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><p>장소: 서울월드컵공원 평화광장</p>
      <div data-note="<a href='https://fake.example/double-attr'>참가신청</a>">x</div>
      <span data-note='<a href="https://fake.example/single-attr">참가신청</a>'>x</span>`),
    ).toBe(expectedApplicationUrl);
  });

  it("does not replace applicationUrl from HTML5 inert or bogus fake registration anchors", () => {
    expect(
      acceptedApplicationUrl(`<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><p>장소: 서울월드컵공원 평화광장</p>
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
      <template><a href="https://fake.example/template">참가신청</a></template>`),
    ).toBe(expectedApplicationUrl);
  });

  it("does not replace applicationUrl from unsafe application registration URLs", () => {
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
      expect(
        acceptedApplicationUrl(
          `<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><p>장소: 서울월드컵공원 평화광장</p><a href="${href}">참가신청</a>`,
        ),
        href,
      ).toBe(expectedApplicationUrl);
    }
  });

  it("does not replace applicationUrl after malformed quoted fake-anchor tags", () => {
    expect(
      acceptedApplicationUrl(`<h1>2026 서울국제마라톤</h1><p>대회일시: 2026년 3월 15일</p><p>장소: 서울월드컵공원 평화광장</p>
      <div data-note="<a href='https://fake.example/unterminated'>참가신청</a>
      <a href="https://fake.example/after">참가신청</a>`),
    ).toBe(expectedApplicationUrl);
  });
});
