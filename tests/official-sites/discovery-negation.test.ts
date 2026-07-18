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

describe("homepage label negation", () => {
  it("does not classify local denial labels as official sites", () => {
    const html = `<a href="https://bad.example/one">비공식 홈페이지</a>
      <a href="https://bad.example/two">비 공식 홈페이지</a>
      <a href="https://bad.example/three">공식 홈페이지 아님</a>
      <a href="https://bad.example/four">공식 홈페이지가 아닙니다.</a>
      <a href="https://bad.example/five">홈페이지 없음</a>
      <a href="https://bad.example/six">홈페이지 미운영</a>
      <a href="https://bad.example/seven">대회 홈페이지 - 미운영</a>
      <a href="https://bad.example/eight">공식 홈페이지(아님)</a>
      <a href="https://bad.example/nine">공식 홈페이지가 없습니다</a>
      <a href="https://bad.example/ten">공식 홈페이지가 없어요!</a>
      <a href="https://bad.example/eleven">공식 홈페이지가 존재하지 않습니다.</a>
      <a href="https://bad.example/twelve">공식 홈페이지를 운영하지 않습니다</a>
      <a href="https://bad.example/thirteen">공식 홈페이지 운영하지 않습니다.</a>
      <a href="https://bad.example/fourteen">비공식 대회 홈페이지</a>
      <a href="https://bad.example/fifteen">공식   홈페이지는
존재하지 않습니다</a>
      <a href="https://bad.example/sixteen">공식 홈페이지를 현재 운영하지 않아요</a>
      <a href="https://bad.example/seventeen">공식 홈페이지 운영 안함</a>
      <a href="https://bad.example/eighteen">공식 홈페이지 운영안함</a>
      <a href="https://bad.example/nineteen">홈페이지 운영 안 함</a>
      <a href="https://bad.example/twenty">홈페이지 운영안함</a>
      <a href="https://bad.example/twenty-one">공식 홈페이지 - 운영 안함.</a>
      <a href="https://bad.example/twenty-two">홈페이지(운영안함)</a>`;

    expect(discover(html)).toEqual([]);
  });

  it("keeps nearby positive explicit labels official", () => {
    const html = `<a href="https://official.example/one">공식 홈페이지</a>
      <a href="https://official.example/two">대회 공식 홈페이지 바로가기</a>
      <a href="https://official.example/three">홈페이지 안내</a>
      <p>공식 홈페이지가 없습니다. 아래 링크는 협력사 안내 문구입니다.</p>
      <a href="https://official.example/four">대회 공식 홈페이지</a>
      <a href="https://official.example/five">공식 홈페이지 운영 안내</a>
      <a href="https://official.example/six">공식 홈페이지 · 운영 안내</a>
      <a href="https://apply.example/register">공식 홈페이지 신청하기</a>`;

    expect(discover(html).map((link) => [link.kind, link.url])).toEqual([
      ["official-site", "https://official.example/one"],
      ["official-site", "https://official.example/two"],
      ["official-site", "https://official.example/three"],
      ["official-site", "https://official.example/four"],
      ["official-site", "https://official.example/five"],
      ["official-site", "https://official.example/six"],
      ["application", "https://apply.example/register"],
    ]);
  });
});
