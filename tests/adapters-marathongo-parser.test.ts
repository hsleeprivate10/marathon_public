import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MARATHONGO_LIST_URL,
  parseMarathonGoDetail,
  parseMarathonGoList,
  safeMarathonGoDetailUrl,
} from "../src/adapters/marathongo-parser.js";

const FIXTURE_DIR = resolve(import.meta.dirname, "fixtures/marathongo");
const fixture = (name: string) => readFileSync(resolve(FIXTURE_DIR, name), "utf8");

describe("MarathonGo pure parser", () => {
  it("parses owned detail URLs and transient identity hints when list HTML contains valid race cards", () => {
    // Given: sanitized MarathonGo server-rendered domestic list HTML.
    const html = fixture("list.html");

    // When: the pure list parser extracts source-owned race details.
    const details = parseMarathonGoList(html);

    // Then: only valid owned detail routes are returned once with list identity hints.
    expect(MARATHONGO_LIST_URL).toBe("https://marathongo.co.kr/raceSchedule/domestic");
    expect(details).toEqual([
      {
        detailPath: "/raceDetail/domestic/saunarun-olympicpark-2026-07-31",
        detailUrl: "https://marathongo.co.kr/raceDetail/domestic/saunarun-olympicpark-2026-07-31",
        name: "2026 사우나런 올림픽공원",
        eventDate: "2026-07-31",
        organizer: "사우나런 운영팀",
      },
    ]);
  });

  it("parses race identity hints and direct application CTA hrefs when detail HTML contains noisy context", () => {
    // Given: sanitized MarathonGo detail HTML with scripts, related races, and tracking noise.
    const detailUrl =
      "https://marathongo.co.kr/raceDetail/domestic/saunarun-olympicpark-2026-07-31";
    const html = fixture("detail.html");

    // When: the pure detail parser extracts contextual evidence.
    const detail = parseMarathonGoDetail(html, detailUrl);

    // Then: only owned-detail identity hints and the direct 신청하기 CTA survive.
    expect(detail).toEqual({
      nameHints: ["2026 사우나런 올림픽공원"],
      dateHints: ["2026-07-31"],
      venueHints: ["서울 올림픽공원 평화의광장"],
      organizerHints: ["사우나런 운영팀"],
      applicationHrefs: ["https://saunarun.com/products/z64zdfxy4mc9?variant=44332211"],
    });
  });

  it("rejects malformed owned routes when detail paths leave the domestic race slug contract", () => {
    // Given: malformed source paths a later adapter must not fetch.
    const malformedPaths = [
      "/raceDetail/domestic/../admin",
      "/raceDetail/domestic/saunarun-olympicpark-2026-07-31?preview=1",
      "https://evil.example/raceDetail/domestic/saunarun-olympicpark-2026-07-31",
    ];

    // When: each path is normalized through the MarathonGo detail route guard.
    const urls = malformedPaths.map((path) => safeMarathonGoDetailUrl(path));

    // Then: none become owned detail URLs.
    expect(urls).toEqual([null, null, null]);
  });

  it("does not parse unsafe destinations or missing CTA details as application evidence", () => {
    // Given: details with an unsafe 신청하기 destination and no direct CTA.
    const detailUrl =
      "https://marathongo.co.kr/raceDetail/domestic/saunarun-olympicpark-2026-07-31";

    // When: the pure detail parser examines the negative fixtures.
    const unsafe = parseMarathonGoDetail(fixture("detail-unsafe-destination.html"), detailUrl);
    const missing = parseMarathonGoDetail(fixture("detail-missing-cta.html"), detailUrl);

    // Then: neither fixture yields traversal application hrefs.
    expect(unsafe.applicationHrefs).toEqual([]);
    expect(missing.applicationHrefs).toEqual([]);
  });

  it("ignores script, style, template, nav, footer, and related-card detail injections", () => {
    // Given: a sanitized detail fixture where fake chrome appears before the owned race article.
    const detailUrl =
      "https://marathongo.co.kr/raceDetail/domestic/saunarun-olympicpark-2026-07-31";
    const html = fixture("detail-injection.html");

    // When: the pure detail parser extracts identity and application evidence.
    const detail = parseMarathonGoDetail(html, detailUrl);

    // Then: only the owned race article contributes hints and 신청하기 CTA hrefs.
    expect(detail).toEqual({
      nameHints: ["2026 사우나런 올림픽공원"],
      dateHints: ["2026-07-31"],
      venueHints: ["서울 올림픽공원 평화의광장"],
      organizerHints: ["사우나런 운영팀"],
      applicationHrefs: ["https://saunarun.com/products/z64zdfxy4mc9?variant=44332211"],
    });
  });

  it("returns zero evidence when only inert or page-chrome injections contain race-like content", () => {
    // Given: a detail fixture with no owned race article and only fake script/footer/nav evidence.
    const detailUrl =
      "https://marathongo.co.kr/raceDetail/domestic/saunarun-olympicpark-2026-07-31";
    const html = fixture("detail-injection-only.html");

    // When: the pure detail parser is run against the poison-only fixture.
    const detail = parseMarathonGoDetail(html, detailUrl);

    // Then: no fake hints or 신청하기 CTA hrefs are emitted.
    expect(detail).toEqual({
      nameHints: [],
      dateHints: [],
      venueHints: [],
      organizerHints: [],
      applicationHrefs: [],
    });
  });

  it("parses current schedule-list anchors without class tokens only inside the schedule container", () => {
    // Given: sanitized current public list shape with target blank anchors and no race/card class.
    const html = fixture("list-current-shape.html");

    // When: the pure list parser extracts MarathonGo owned domestic detail candidates.
    const details = parseMarathonGoList(html);

    // Then: only the schedule-container anchor becomes a transient detail candidate.
    expect(details).toEqual([
      {
        detailPath: "/raceDetail/domestic/current-shape-run-2026-09-20",
        detailUrl: "https://marathongo.co.kr/raceDetail/domestic/current-shape-run-2026-09-20",
        name: "2026 커런트 쉐이프 런",
        eventDate: "2026-09-20",
        organizer: null,
      },
    ]);
  });

  it("parses current plain-main detail CTA buttons without leaking related or inert CTAs", () => {
    // Given: sanitized current public detail shape with plain main, MUI containers, and poisoned chrome.
    const detailUrl = "https://marathongo.co.kr/raceDetail/domestic/current-detail-run-2026-07-31";
    const html = fixture("detail-current-shape.html");

    // When: the pure detail parser extracts identity and application evidence.
    const detail = parseMarathonGoDetail(html, detailUrl);

    // Then: only the primary event CTA button becomes a contextual application href.
    expect(detail).toEqual({
      nameHints: ["2026 커런트 디테일 런"],
      dateHints: ["2026-07-31"],
      venueHints: ["부산 해운대 수영만요트경기장"],
      organizerHints: [],
      applicationHrefs: ["https://current-detail.example/apply?race=2026"],
    });
  });

  it("normalizes owned current detail title identity without trusting non-owned detail URLs", () => {
    // Given: current detail HTML with noisy owned document title, main heading, and poisoned headings.
    const ownedDetailUrl =
      "https://marathongo.co.kr/raceDetail/domestic/current-detail-run-2026-07-31";
    const html = fixture("detail-current-shape.html");

    // When: owned and non-owned detail URLs parse the same source body.
    const owned = parseMarathonGoDetail(html, ownedDetailUrl);
    const nonOwned = parseMarathonGoDetail(
      html,
      "https://example.org/raceDetail/domestic/current-detail-run-2026-07-31",
    );

    // Then: only the owned detail activates concise document identity extraction.
    expect(owned.nameHints).toEqual(["2026 커런트 디테일 런"]);
    expect(owned.dateHints).toEqual(["2026-07-31"]);
    expect(nonOwned).toEqual({
      nameHints: [],
      dateHints: [],
      venueHints: [],
      organizerHints: [],
      applicationHrefs: [],
    });
  });
});
