import { describe, expect, it } from "vitest";
import type { Race } from "../../src/contract.js";
import { RaceSchema } from "../../src/contract.js";
import { safeApplicationUrl } from "../../src/official-sites/application-url-policy.js";
import { discoverRaceLinks } from "../../src/official-sites/discovery.js";
import {
  type OfficialTransport,
  type TransportResponse,
  fetchOfficialPage,
} from "../../src/official-sites/fetch.js";
import { parseOfficialPage } from "../../src/official-sites/parser.js";
import type { DnsLookup } from "../../src/official-sites/url-policy.js";

const race: Race = {
  name: "2026 서울국제마라톤",
  eventDate: "2026-03-15",
  registrationDeadline: null,
  venue: "서울",
  courses: [],
  applicationUrl: "https://source.example/detail",
  sources: ["test"],
  verified: true,
  lastVerified: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  generatedAt: "2026-01-01T00:00:00.000Z",
  registrationStatus: "open",
};
const publicLookup: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const blockedNames = [
  "login",
  "signin",
  "admin",
  "administrator",
  "wp-admin",
  "member",
  "members",
  "private",
  "api",
  "graphql",
] as const;
const serverExtensions = ["php", "html", "htm", "asp", "aspx", "do", "jsp"] as const;
const blockedPaths = blockedNames.flatMap((name) => [
  `/${name}`,
  ...serverExtensions.map((extension) => `/events/${name}.${extension}`),
]);

function discover(html: string): readonly string[] {
  return discoverRaceLinks({
    race,
    sourceId: "test",
    sourcePageUrl: "https://source.example/detail",
    sourceHosts: ["source.example"],
    aggregatorHosts: ["source.example"],
    html,
    raceDetailContext: { present: true, sourceDetailUrl: "https://source.example/detail" },
  }).map((link) => link.url);
}

function jsonLd(type: unknown, url = "https://event.example/race"): string {
  return `<script type="application/ld+json">${JSON.stringify({
    "@type": type,
    name: race.name,
    startDate: race.eventDate,
    url,
  })}</script>`;
}

function response(
  statusCode: number,
  headers: Readonly<Record<string, string>>,
): TransportResponse {
  return {
    statusCode,
    headers,
    body: (async function* () {
      yield new TextEncoder().encode("event");
    })(),
    discard: () => undefined,
  };
}

describe("exact JSON-LD Event types", () => {
  it.each(["Event", "http://schema.org/Event", "https://schema.org/Event"])(
    "accepts the canonical type %s in discovery and parsing",
    (type) => {
      const html = jsonLd(type);

      expect(discover(html)).toEqual(["https://event.example/race"]);
      expect(parseOfficialPage(html, "https://official.example/race").events).toHaveLength(1);
    },
  );

  it.each([
    "event",
    "EVENT",
    "RaceEvent",
    "EventSeries",
    "https://schema.org/EventSeries",
    "https://schema.org/Event/",
  ])("rejects non-canonical type %s in discovery and parsing", (type) => {
    const html = jsonLd(type);

    expect(discover(html)).toEqual([]);
    expect(parseOfficialPage(html, "https://official.example/race").events).toHaveLength(0);
  });

  it("accepts only an exact canonical member of an @type array", () => {
    expect(discover(jsonLd(["Thing", "https://schema.org/Event"]))).toHaveLength(1);
    expect(discover(jsonLd(["Thing", "event", "EventSeries"]))).toEqual([]);
  });
});

describe("private path basenames", () => {
  it.each(blockedPaths)("rejects application and schema URLs ending in %s", (path) => {
    const url = `https://race.example${path}`;

    expect(safeApplicationUrl(url)).toBeNull();
    expect(RaceSchema.safeParse({ ...race, applicationUrl: url }).success).toBe(false);
    expect(RaceSchema.safeParse({ ...race, officialSiteUrl: url }).success).toBe(false);
  });

  it.each(["/LOGIN.PHP", "/%2561dmin%252Ehtml", "/events%255Cprivate.jsp"])(
    "rejects encoded, case, and backslash variant %s",
    (path) => {
      expect(safeApplicationUrl(`https://race.example${path}`)).toBeNull();
    },
  );

  it.each(["/login-race.php", "/administer.html", "/apiary.do"])(
    "allows benign basename %s at application and discovery boundaries",
    (path) => {
      const url = `https://official.example${path}`;

      expect(safeApplicationUrl(url)).toBe(url);
      expect(discover(`<a href="${url}">공식 홈페이지</a>`)).toEqual([url]);
    },
  );

  it.each(["/login.php", "/ADMINISTRATOR.AspX", "/events%255Cgraphql.do"])(
    "rejects initial and redirected official fetch path %s before transport",
    async (path) => {
      let requests = 0;
      const transport: OfficialTransport = async (request) => {
        requests += 1;
        return request.url.endsWith("/start")
          ? response(302, { location: `https://race.example${path}` })
          : response(200, { "content-type": "text/plain" });
      };

      const initial = await fetchOfficialPage(`https://race.example${path}`, {
        lookup: publicLookup,
        transport,
      });
      const redirected = await fetchOfficialPage("https://race.example/start", {
        lookup: publicLookup,
        transport,
      });

      expect(initial).toMatchObject({ kind: "rejected", reason: "unsafe-public-url" });
      expect(redirected).toMatchObject({ kind: "rejected", reason: "unsafe-public-url" });
      expect(requests).toBe(1);
    },
  );
});
