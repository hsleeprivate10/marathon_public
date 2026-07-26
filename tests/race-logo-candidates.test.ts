import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Race } from "../src/contract.js";
import { parseRaceLogoCandidates, selectRaceLogoCandidate } from "../src/race-logo-candidates.js";

const target = {
  name: "제12회 2026 서울국제마라톤",
  eventDate: "2026-03-15",
} satisfies Pick<Race, "name" | "eventDate">;
const fixture = (name: string): string =>
  readFileSync(`tests/fixtures/race-logo-candidates/${name}`, "utf8");

function select(
  html: string,
  pageUrl = "https://official.example/races/seoul",
): string | undefined {
  return selectRaceLogoCandidate(parseRaceLogoCandidates(html, pageUrl), target);
}

function jsonLd(record: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(record)}</script>`;
}

describe("race logo JSON-LD candidates", () => {
  it.each([
    ["Event", "/media/seoul-logo.png"],
    ["https://schema.org/SportsEvent", { url: "/media/seoul-logo.png" }],
    ["SportsEvent", { contentUrl: "/media/seoul-logo.png" }],
    ["http://schema.org/Event", ["/media/seoul-logo.png"]],
  ])("accepts matching exact %s logo shapes", (type, logo) => {
    const html = jsonLd({
      "@type": type,
      name: target.name,
      startDate: target.eventDate,
      logo,
    });

    expect(select(html)).toBe("https://official.example/media/seoul-logo.png");
  });

  it.each([
    ["URL basename", "/media/seoul-race-logo.webp"],
    ["ImageObject name", { url: "/media/hero.webp", name: "서울국제마라톤 로고" }],
    ["ImageObject caption", { contentUrl: "/media/crest.webp", caption: "event emblem" }],
    ["array", ["/media/poster.webp", "/media/seoul-mark.svg"]],
  ])("accepts a logo-like image identified by %s", (_label, image) => {
    const html = jsonLd({
      "@type": "SportsEvent",
      name: target.name,
      eventDate: target.eventDate,
      image,
    });

    expect(select(html)).toBe(
      typeof image === "string"
        ? new URL(image, "https://official.example/races/seoul").toString()
        : Array.isArray(image)
          ? "https://official.example/media/seoul-mark.svg"
          : new URL(
              "url" in image ? String(image.url) : String(image.contentUrl),
              "https://official.example/races/seoul",
            ).toString(),
    );
  });

  it("prefers logo candidates before image candidates", () => {
    const html = jsonLd({
      "@type": "Event",
      name: target.name,
      startDate: target.eventDate,
      logo: "/media/primary-logo.png",
      image: "/media/secondary-logo.png",
    });

    expect(select(html)).toBe("https://official.example/media/primary-logo.png");
  });

  it.each(["event", "RaceEvent", "EventSeries", "https://schema.org/SportsEvent/"])(
    "rejects non-exact logo event type %s",
    (type) => {
      const html = jsonLd({
        "@type": type,
        name: target.name,
        startDate: target.eventDate,
        logo: "/media/race-logo.png",
      });

      expect(select(html)).toBeUndefined();
    },
  );

  it("rejects unrelated records, generic images, and cross-event arrays", () => {
    const html = jsonLd([
      { "@type": "Organization", name: target.name, logo: "/media/org-logo.png" },
      { "@type": "WebSite", name: target.name, logo: "/media/site-logo.png" },
      {
        "@type": "SportsEvent",
        name: target.name,
        startDate: target.eventDate,
        image: "/media/race-poster.jpg",
      },
      {
        "@type": "Event",
        name: "2026 부산바다마라톤",
        startDate: target.eventDate,
        logo: "/media/busan-logo.png",
      },
    ]);

    expect(select(html)).toBeUndefined();
  });

  it.each([
    ["year", "제12회 2027 서울국제마라톤", target.eventDate],
    ["ordinal", "제13회 2026 서울국제마라톤", target.eventDate],
    ["date", target.name, "2026-04-01"],
    ["missing date", target.name, undefined],
  ])("rejects a matching name with a conflicting %s", (_label, name, startDate) => {
    expect(
      select(jsonLd({ "@type": "Event", name, startDate, logo: "/media/race-logo.png" })),
    ).toBeUndefined();
  });

  it("returns undefined when matching candidates are ambiguous", () => {
    const html = jsonLd({
      "@type": "Event",
      name: target.name,
      startDate: target.eventDate,
      logo: ["/media/first-logo.png", "/media/second-logo.png"],
    });

    expect(select(html)).toBeUndefined();
  });

  it.each([
    "logo.png",
    "site-logo.png",
    "site_logo.png",
    "brand-logo.png",
    "header-logo.png",
    "seoul-event-logo.png",
  ])("rejects aggregator JSON-LD %s without event-specific ImageObject metadata", (basename) => {
    const generic = jsonLd({
      "@type": "Event",
      name: target.name,
      startDate: target.eventDate,
      logo: `/images/${basename}`,
    });

    expect(select(generic, "https://gorunning.co.kr/race/1")).toBeUndefined();
  });

  it("accepts an aggregator logo with event-specific ImageObject metadata", () => {
    const specific = jsonLd({
      "@type": "Event",
      name: target.name,
      startDate: target.eventDate,
      logo: { url: "/images/logo.png", name: `${target.name} 로고` },
    });
    expect(select(specific, "https://gorunning.co.kr/race/1")).toBe(
      "https://gorunning.co.kr/images/logo.png",
    );
  });
});

describe("race-owned DOM logo candidates", () => {
  it("selects the fixture-backed SportsEvent logo", () => {
    expect(select(fixture("sports-event-positive.html"))).toBe(
      "https://official.example/media/seoul-logo.png",
    );
  });

  it("selects the fixture-backed isolated DOM logo", () => {
    expect(select(fixture("owned-dom-positive.html"), "https://gorunning.co.kr/races/1")).toBe(
      "https://gorunning.co.kr/events/seoul-mark.png",
    );
  });

  it("rejects fixture-backed generic and cross-card evidence", () => {
    expect(
      select(fixture("multi-event-negative.html"), "https://gorunning.co.kr/races"),
    ).toBeUndefined();
  });

  it("accepts an associated marked image in an isolated race block", () => {
    const html = `<article><h2>${target.name}</h2><time datetime="${target.eventDate}"></time><img src="/logos/seoul.png" alt="${target.name} 로고"></article>`;

    expect(select(html)).toBe("https://official.example/logos/seoul.png");
  });

  it("uses the enclosing dated race card through nested image wrappers", () => {
    const html = `<article><h2>${target.name}</h2><time datetime="${target.eventDate}"></time><div class="media"><img src="/logos/seoul.png" alt="${target.name} 로고"></div></article>`;

    expect(select(html)).toBe("https://official.example/logos/seoul.png");
  });

  it("rejects an image whose enclosing card names another race", () => {
    const html = `<article><h2>2026 부산바다마라톤</h2><time datetime="${target.eventDate}"></time><img src="/logos/seoul.png" alt="${target.name} 로고"></article>`;

    expect(select(html)).toBeUndefined();
  });

  it("does not use script text as race ownership or date evidence", () => {
    const html = `<article><script>${target.name} ${target.eventDate}</script><img src="/logos/seoul.png" alt="${target.name} 로고"></article>`;

    expect(select(html)).toBeUndefined();
  });

  it("requires an aggregator block to name the target for a generic logo basename", () => {
    const named = `<article><h2>${target.name}</h2><time datetime="${target.eventDate}"></time><img src="/logo.png" alt="${target.name} 로고"></article>`;
    const unnamed = `<article><time datetime="${target.eventDate}"></time><img src="/logo.png" alt="${target.name} 로고"></article>`;

    expect(select(named, "https://gorunning.co.kr/races/1")).toBe(
      "https://gorunning.co.kr/logo.png",
    );
    expect(select(unnamed, "https://gorunning.co.kr/races/1")).toBeUndefined();
  });

  it.each([
    ["header", `<header><img src="/seoul-logo.png" alt="${target.name} 로고"></header>`],
    [
      "missing race association",
      `<article><time datetime="${target.eventDate}"></time><img src="/seoul-logo.png" alt="공식 로고"></article>`,
    ],
    [
      "missing logo marker",
      `<article><time datetime="${target.eventDate}"></time><img src="/photo.png" alt="${target.name}"></article>`,
    ],
    [
      "unsafe URL",
      `<article><time datetime="${target.eventDate}"></time><img src="http://images.example/seoul-logo.png" alt="${target.name} 로고"></article>`,
    ],
  ])("rejects %s DOM imagery", (_label, html) => {
    expect(select(html)).toBeUndefined();
  });

  it("does not let script or text that resembles markup influence DOM ownership", () => {
    const html = `<article><time datetime="${target.eventDate}"></time><script>document.write('<img src="https://evil.example/logo.png" alt="${target.name} 로고">')</script><p>&lt;img src="https://evil.example/logo.png" alt="${target.name} 로고"&gt;</p></article>`;

    expect(select(html)).toBeUndefined();
  });

  it("returns no candidate when a multi-event document has only generic or cross-card images", () => {
    const html = `<meta property="og:image" content="https://gorunning.co.kr/site-logo.png"><header><img src="/logo.png" alt="사이트 로고"></header><main><article><h2>${target.name}</h2><time datetime="${target.eventDate}"></time><img src="/poster.jpg" alt="${target.name} 포스터"></article><article><h2>2026 부산바다마라톤</h2><time datetime="${target.eventDate}"></time><img src="/busan-logo.png" alt="2026 부산바다마라톤 로고"></article></main>`;

    expect(select(html, "https://gorunning.co.kr/races")).toBeUndefined();
  });

  it("ignores malformed JSON-LD without throwing", () => {
    expect(select(`<script type="application/ld+json">{not json</script>`)).toBeUndefined();
  });

  it("returns no candidate for deeply nested DOM without throwing", () => {
    const depth = 5_000;
    const html = `${"<div>".repeat(depth)}<img src="/logo.png" alt="${target.name} 로고">${"</div>".repeat(depth)}`;

    expect(select(html)).toBeUndefined();
  });

  it("returns no candidate for deeply nested JSON-LD without throwing", () => {
    const depth = 10_000;
    const nested = `${'{"@graph":'.repeat(depth)}[]${"}".repeat(depth)}`;

    expect(select(`<script type="application/ld+json">${nested}</script>`)).toBeUndefined();
  });
});
