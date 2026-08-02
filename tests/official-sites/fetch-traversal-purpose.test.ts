import { describe, expect, it } from "vitest";
import {
  type OfficialTransport,
  type PinnedRequest,
  type TransportResponse,
  fetchOfficialPage,
} from "../../src/official-sites/fetch.js";
import type { DnsLookup } from "../../src/official-sites/url-policy.js";

const publicLookup: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function response(
  statusCode: number,
  headers: Readonly<Record<string, string | undefined>>,
  chunks: readonly Uint8Array[] = [],
): TransportResponse {
  return {
    statusCode,
    headers,
    body: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    discard: () => undefined,
  };
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("fetchOfficialPage traversal purpose", () => {
  it("fetches a safe registration seed without making it official", async () => {
    // Given: a safe public application route with HTML behind the pinned transport.
    const requests: PinnedRequest[] = [];
    const transport: OfficialTransport = async (request) => {
      requests.push(request);
      return response(200, { "content-type": "text/html" }, [text("<h1>Register</h1>")]);
    };

    // When: official and traversal purposes fetch the same registration URL.
    const official = await fetchOfficialPage("https://race.example/register", {
      lookup: publicLookup,
      transport,
      purpose: "official",
    });
    const traversal = await fetchOfficialPage("https://race.example/register", {
      lookup: publicLookup,
      transport,
      purpose: "traversal",
    });

    // Then: official policy rejects before transport, but traversal may inspect the page.
    expect(official).toEqual({
      kind: "rejected",
      url: "https://race.example/register",
      reason: "unsafe-public-url",
    });
    expect(traversal).toMatchObject({
      kind: "success",
      url: "https://race.example/register",
      body: "<h1>Register</h1>",
    });
    expect(requests).toHaveLength(1);
  });

  it("fetches a final HTTP page that has no HTTPS redirect", async () => {
    // Given: a verified public HTTP official page fixture with no redirect.
    const transport: OfficialTransport = async () =>
      response(200, { "content-type": "text/plain" }, [text("verified race")]);

    // When: the page is fetched through official policy.
    const result = await fetchOfficialPage("http://race.example/final", {
      lookup: publicLookup,
      transport,
      purpose: "official",
    });

    // Then: network policy allows the HTTP final page for later identity verification.
    expect(result).toEqual({
      kind: "success",
      url: "http://race.example/final",
      address: "93.184.216.34",
      contentType: "text/plain",
      body: "verified race",
    });
  });

  it.each([
    ["private redirect", "http://127.0.0.1/admin", "blocked-address"],
    ["payment redirect", "https://payments.example/checkout", "unsafe-public-url"],
    ["admin redirect", "https://race.example/admin", "unsafe-public-url"],
    ["API redirect", "https://race.example/api/races", "unsafe-public-url"],
    ["credentialed redirect", "https://user:secret@race.example/register", "credentials"],
  ])("rejects traversal %s before the next transport", async (_label, location, reason) => {
    // Given: a traversal seed whose first response redirects to a forbidden target.
    let requests = 0;
    const transport: OfficialTransport = async () => {
      requests += 1;
      return response(302, { location });
    };

    // When: traversal-purpose fetch resolves the redirect target.
    const result = await fetchOfficialPage("https://race.example/register", {
      lookup: publicLookup,
      transport,
      purpose: "traversal",
    });

    // Then: the redirect is revalidated with traversal purpose and rejected before transport.
    expect(result).toEqual({ kind: "rejected", url: location, reason });
    expect(requests).toBe(1);
  });

  it("rejects a third redirect before a fourth transport", async () => {
    // Given: a traversal-safe chain that keeps redirecting.
    let requests = 0;
    const transport: OfficialTransport = async (request) => {
      requests += 1;
      return response(302, { location: new URL(`/register-${requests}`, request.url).href });
    };

    // When: traversal-purpose fetch reaches the third redirect target.
    const result = await fetchOfficialPage("https://race.example/register", {
      lookup: publicLookup,
      transport,
      purpose: "traversal",
    });

    // Then: max-two redirect behavior is preserved.
    expect(result).toEqual({
      kind: "rejected",
      url: "https://race.example/register-3",
      reason: "too-many-redirects",
    });
    expect(requests).toBe(3);
  });

  it("rejects non-document content", async () => {
    // Given: a traversal seed returning unsupported content.
    const transport: OfficialTransport = async () =>
      response(200, { "content-type": "application/json" }, [text("{}")]);

    // When: traversal-purpose fetch receives the response.
    const result = await fetchOfficialPage("https://race.example/register", {
      lookup: publicLookup,
      transport,
      purpose: "traversal",
    });

    // Then: content-type policy remains unchanged.
    expect(result).toEqual({
      kind: "rejected",
      url: "https://race.example/register",
      reason: "unsupported-content-type",
    });
  });

  it("rejects bodies larger than 1 MiB", async () => {
    // Given: a traversal seed streaming beyond the body limit.
    const transport: OfficialTransport = async () =>
      response(200, { "content-type": "text/html" }, [
        new Uint8Array(700_000),
        new Uint8Array(400_000),
      ]);

    // When: traversal-purpose fetch reads the response body.
    const result = await fetchOfficialPage("https://race.example/register", {
      lookup: publicLookup,
      transport,
      purpose: "traversal",
    });

    // Then: the existing 1 MiB cap still rejects it.
    expect(result).toEqual({
      kind: "rejected",
      url: "https://race.example/register",
      reason: "body-too-large",
    });
  });
});
