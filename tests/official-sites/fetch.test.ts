import { describe, expect, it } from "vitest";
import { USER_AGENT } from "../../src/adapters/types.js";
import {
  type OfficialTransport,
  OfficialTransportError,
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

describe("fetchOfficialPage", () => {
  it("fetches public HTML using only the validated pinned address", async () => {
    const requests: PinnedRequest[] = [];
    const transport: OfficialTransport = async (request) => {
      requests.push(request);
      return response(200, { "content-type": "text/html; charset=utf-8" }, [text("<h1>Race</h1>")]);
    };

    const result = await fetchOfficialPage("https://race.example/event", {
      lookup: publicLookup,
      transport,
    });

    expect(result).toEqual({
      kind: "success",
      url: "https://race.example/event",
      address: "93.184.216.34",
      contentType: "text/html",
      body: "<h1>Race</h1>",
    });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "GET",
        address: "93.184.216.34",
        family: 4,
        headers: {
          Accept: "text/html, application/xhtml+xml, text/plain",
          "User-Agent": USER_AGENT,
        },
      }),
    ]);
  });

  it("does not perform a second DNS lookup inside the transport", async () => {
    let calls = 0;
    const lookup: DnsLookup = async () => {
      calls += 1;
      return [{ address: calls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    };
    const transport: OfficialTransport = async (request) => {
      expect(request.address).toBe("93.184.216.34");
      return response(200, { "content-type": "text/plain" }, [text("race")]);
    };

    const result = await fetchOfficialPage("https://race.example", { lookup, transport });

    expect(result.kind).toBe("success");
    expect(calls).toBe(1);
  });

  it("validates and pins one public redirect", async () => {
    const pins: string[] = [];
    const lookup: DnsLookup = async (hostname) => [
      { address: hostname === "race.example" ? "93.184.216.34" : "1.1.1.1", family: 4 },
    ];
    const transport: OfficialTransport = async (request) => {
      pins.push(request.address);
      if (request.url.includes("race.example")) {
        return response(302, { location: "https://official.example/home" });
      }
      return response(200, { "content-type": "application/xhtml+xml" }, [text("<html />")]);
    };

    const result = await fetchOfficialPage("https://race.example", { lookup, transport });

    expect(result).toMatchObject({
      kind: "success",
      url: "https://official.example/home",
      address: "1.1.1.1",
    });
    expect(pins).toEqual(["93.184.216.34", "1.1.1.1"]);
  });

  it("rejects a redirect to a private target before transport", async () => {
    let requests = 0;
    const transport: OfficialTransport = async () => {
      requests += 1;
      return response(302, { location: "http://127.0.0.1/admin" });
    };

    const result = await fetchOfficialPage("https://race.example", {
      lookup: publicLookup,
      transport,
    });

    expect(result).toEqual({
      kind: "rejected",
      url: "http://127.0.0.1/admin",
      reason: "blocked-address",
    });
    expect(requests).toBe(1);
  });

  it("rejects a redirect to a payment target before transport", async () => {
    let requests = 0;
    const transport: OfficialTransport = async () => {
      requests += 1;
      return response(302, { location: "https://payments.example/checkout" });
    };

    const result = await fetchOfficialPage("https://race.example", {
      lookup: publicLookup,
      transport,
    });

    expect(result).toEqual({
      kind: "rejected",
      url: "https://payments.example/checkout",
      reason: "unsafe-public-url",
    });
    expect(requests).toBe(1);
  });

  it("rejects more than two redirects", async () => {
    let requests = 0;
    const transport: OfficialTransport = async (request) => {
      requests += 1;
      return response(302, { location: new URL(`/next-${requests}`, request.url).href });
    };

    const result = await fetchOfficialPage("https://race.example/start", {
      lookup: publicLookup,
      transport,
    });

    expect(result).toEqual({
      kind: "rejected",
      url: "https://race.example/next-3",
      reason: "too-many-redirects",
    });
    expect(requests).toBe(3);
  });

  it.each(["application/json", "text/htmlish", "image/svg+xml"])(
    "rejects non-document content type %s",
    async (contentType) => {
      const transport: OfficialTransport = async () =>
        response(200, { "content-type": contentType }, [text("ignored")]);

      const result = await fetchOfficialPage("https://race.example", {
        lookup: publicLookup,
        transport,
      });

      expect(result).toEqual({
        kind: "rejected",
        url: "https://race.example/",
        reason: "unsupported-content-type",
      });
    },
  );

  it("rejects a streamed body larger than 1 MiB", async () => {
    const transport: OfficialTransport = async () =>
      response(200, { "content-type": "text/html" }, [
        new Uint8Array(700_000),
        new Uint8Array(400_000),
      ]);

    const result = await fetchOfficialPage("https://race.example", {
      lookup: publicLookup,
      transport,
    });

    expect(result).toEqual({
      kind: "rejected",
      url: "https://race.example/",
      reason: "body-too-large",
    });
  });

  it("returns typed failures for DNS and transport errors", async () => {
    const failedLookup: DnsLookup = async () => {
      throw new Error("DNS unavailable");
    };
    const failedTransport: OfficialTransport = async () => {
      throw new Error("socket reset");
    };
    const timedOutTransport: OfficialTransport = async (request) => {
      expect(request.timeoutMs).toBeGreaterThan(0);
      expect(request.timeoutMs).toBeLessThanOrEqual(123);
      throw new OfficialTransportError("timeout");
    };

    await expect(
      fetchOfficialPage("https://race.example", { lookup: failedLookup }),
    ).resolves.toEqual({
      kind: "rejected",
      url: "https://race.example",
      reason: "dns-failure",
    });
    await expect(
      fetchOfficialPage("https://race.example", {
        lookup: publicLookup,
        transport: failedTransport,
      }),
    ).resolves.toEqual({ kind: "failed", url: "https://race.example/", reason: "network" });
    await expect(
      fetchOfficialPage("https://race.example", {
        lookup: publicLookup,
        transport: timedOutTransport,
        timeoutMs: 123,
      }),
    ).resolves.toEqual({ kind: "failed", url: "https://race.example/", reason: "timeout" });
  });
});
