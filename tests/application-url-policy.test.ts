import { describe, expect, it } from "vitest";
import { RaceSchema } from "../src/contract.js";

const validRace = {
  name: "공개 대회",
  eventDate: "2026-12-01",
  registrationDeadline: null,
  venue: "서울",
  courses: [],
  applicationUrl: "https://source.example/detail",
  sources: ["source"],
  verified: true,
  lastVerified: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
  generatedAt: "2026-07-17T00:00:00.000Z",
  registrationStatus: "open" as const,
};

describe("RaceSchema application URL publication policy", () => {
  it.each([
    "not-a-url",
    "javascript:alert(1)",
    "ftp://apply.example/register",
    "https://user:secret@apply.example/register",
    "http://localhost/register",
    "https://race.local/register",
    "http://127.0.0.1/register",
    "http://10.0.0.1/register",
    "http://169.254.1.1/register",
    "http://[::1]/register",
    "http://[fc00::1]/register",
    "http://[fe80::1]/register",
    "https://payments.example/checkout",
    "https://race.example/checkout.php",
    "https://race.example/payment.html",
    "https://race.example/billing.do",
    "https://race.example/purchase-action",
    "https://race.example/race-checkout",
    "https://race.example/checkout;jsessionid=abc",
    "https://race.example/%63heckout%3Bjsessionid=abc",
    "https://race.example/pay:now",
    "https://race.example/payment~start",
    "https://emarathon.or.kr",
    "https://gorunning.kr/races/",
    "https://m.kaaf.or.kr/mobile/info/inside_all.asp",
    "https://www.kormarathon.com",
    "https://maedal.com",
    "https://marathon.me.kr/events",
    "https://marathonmate.store/domestic",
    "https://runningmap.kr",
    "https://generic-organizer.example/?utm_source=list",
    "https://generic-organizer.example/#home",
    "https://generic-organizer.example/main.php",
    "https://gorunning.kr/race/view.php?idx=123&next=/admin",
    "https://m.kaaf.or.kr/mobile/info/inside_view.asp?no=7&next=/admin",
    "https://m.kaaf.or.kr/mobile/info/notice.asp?no=7",
  ])("rejects an unsafe applicationUrl: %s", (applicationUrl) => {
    expect(RaceSchema.safeParse({ ...validRace, applicationUrl }).success).toBe(false);
  });

  it.each([
    "https://apply.example/register",
    "http://apply.example/register",
    "https://payments-marathon.example/register",
    "https://m.kaaf.or.kr/mobile/info/inside_view.asp?no=7",
  ])("accepts a public HTTP(S) applicationUrl: %s", (applicationUrl) => {
    expect(RaceSchema.safeParse({ ...validRace, applicationUrl }).success).toBe(true);
  });

  it.each([
    "https://emarathon.or.kr/bbs/board.php?bo_table=emara04_01&wr_id=1594&next=/admin",
    "https://emarathon.or.kr/bbs/board.php?wr_id=1594&bo_table=emara04_01",
    "https://emarathon.or.kr/bbs/board.php?bo_table=emara04_01&wr_id=1594&wr_id=1595",
  ])("rejects a non-canonical e-Marathon detail query: %s", (applicationUrl) => {
    expect(RaceSchema.safeParse({ ...validRace, applicationUrl }).success).toBe(false);
  });

  it.each(["http://localhost/race", "http://10.0.0.1/race", "https://payments.example/checkout"])(
    "rejects an unsafe urlScheme identity: %s",
    (urlScheme) => {
      expect(RaceSchema.safeParse({ ...validRace, urlScheme }).success).toBe(false);
    },
  );
});
