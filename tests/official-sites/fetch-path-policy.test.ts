import { describe, expect, it } from "vitest";
import {
  type OfficialTransport,
  type TransportResponse,
  fetchOfficialPage,
} from "../../src/official-sites/fetch.js";
import type { DnsLookup } from "../../src/official-sites/url-policy.js";

const publicLookup: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const blockedPaths = [
  "/login",
  "/events/SIGNIN.",
  "/events/%2561dmin",
  "/administrator",
  "/events/wp%252Dadmin",
  "/member",
  "/events/MEMBERS.",
  "/private",
  "/events/%2561pi",
  "/graphql",
  "/events/foo%255Cadmin",
  "/admin.php5",
  "/login.action",
  "/api.json",
  "/wp-admin.cgi",
  "/member.php.evil",
  "/register",
  "/apply",
  "/entry",
  "/signup",
  "/join",
  "/register.php",
  "/events/%2561pply",
  "/entry.aspx.",
  "/SIGNUP.do",
  "/join.jsp",
  "/register.action",
  "/apply.cgi",
  "/entry.pl",
  "/signup.cfm",
  "/join.shtml",
] as const;

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

describe("fetchOfficialPage path policy", () => {
  it.each(blockedPaths)("rejects initial unsafe path %s before transport", async (path) => {
    let requests = 0;
    const transport: OfficialTransport = async () => {
      requests += 1;
      return response(200, { "content-type": "text/plain" });
    };

    const result = await fetchOfficialPage(`https://Race.Example.${path}`, {
      lookup: publicLookup,
      transport,
    });

    expect(result).toEqual({
      kind: "rejected",
      url: `https://Race.Example.${path}`,
      reason: "unsafe-public-url",
    });
    expect(requests).toBe(0);
  });

  it.each(blockedPaths)("rejects redirect unsafe path %s before second transport", async (path) => {
    let requests = 0;
    const transport: OfficialTransport = async () => {
      requests += 1;
      return response(302, { location: `https://Race.Example.${path}` });
    };

    const result = await fetchOfficialPage("https://race.example/start", {
      lookup: publicLookup,
      transport,
    });

    expect(result).toEqual({
      kind: "rejected",
      url: `https://race.example.${path}`,
      reason: "unsafe-public-url",
    });
    expect(requests).toBe(1);
  });

  it.each([
    "/events/apiary",
    "/events/member-run",
    "/events/graphql-marathon#admin",
    "/events/register-run",
    "/events/application-guide",
  ])("allows benign initial and redirected event path %s", async (path) => {
    let requests = 0;
    const transport: OfficialTransport = async (request) => {
      requests += 1;
      if (request.url.endsWith("/start")) {
        return response(302, { location: `https://official.example${path}` });
      }
      return response(200, { "content-type": "text/plain" });
    };

    const initial = await fetchOfficialPage(`https://official.example${path}`, {
      lookup: publicLookup,
      transport,
    });
    const redirected = await fetchOfficialPage("https://race.example/start", {
      lookup: publicLookup,
      transport,
    });

    expect(initial.kind).toBe("success");
    expect(redirected.kind).toBe("success");
    expect(requests).toBe(3);
  });
});
