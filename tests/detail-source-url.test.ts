import { describe, expect, it } from "vitest";
import {
  safeEMarathonDetailUrl,
  safeGoRunningDetailUrl,
  safeKaafDetailUrl,
  safeKorMarathonDetailUrl,
  safeMaedalDetailUrl,
  safeMarathonMateDetailUrl,
  safeMarathonMoaDetailUrl,
  safeRunningMapDetailUrl,
} from "../src/adapters/detail-source-url.js";

describe("source detail URL route policy", () => {
  it.each([
    ["GoRunning", safeGoRunningDetailUrl, "/race/view.php?idx=1001"],
    ["KorMarathon", safeKorMarathonDetailUrl, "/ko/race/seoul-2026"],
    ["e-Marathon", safeEMarathonDetailUrl, "/bbs/board.php?bo_table=emara04_01&wr_id=1594"],
    ["Maedal", safeMaedalDetailUrl, "/races/550e8400-e29b-41d4-a716-446655440000"],
    ["KAAF", safeKaafDetailUrl, "/mobile/info/inside_view.asp?no=700"],
    ["Marathon Moa", safeMarathonMoaDetailUrl, "/events/550e8400-e29b-41d4-a716-446655440000"],
    ["RunningMap", safeRunningMapDetailUrl, "/race/view/seoul-2026"],
    ["MarathonMate", safeMarathonMateDetailUrl, "/race/seoul-2026"],
  ] as const)("allows a race-detail route for %s", (_sourceName, policy, path) => {
    expect(policy(path)).not.toBeNull();
  });

  it.each([
    ["GoRunning", safeGoRunningDetailUrl],
    ["KorMarathon", safeKorMarathonDetailUrl],
    ["e-Marathon", safeEMarathonDetailUrl],
    ["Maedal", safeMaedalDetailUrl],
    ["KAAF", safeKaafDetailUrl],
    ["Marathon Moa", safeMarathonMoaDetailUrl],
    ["RunningMap", safeRunningMapDetailUrl],
    ["MarathonMate", safeMarathonMateDetailUrl],
  ] as const)("fails closed for unsafe %s detail routes", (_sourceName, policy) => {
    expect(policy("/register")).toBeNull();
    expect(policy("/admin/detail")).toBeNull();
    expect(policy("https://user:secret@example.com/race/1")).toBeNull();
    expect(policy("file:///etc/passwd")).toBeNull();
  });
});
