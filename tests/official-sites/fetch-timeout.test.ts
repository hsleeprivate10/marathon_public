import { afterEach, describe, expect, it, vi } from "vitest";
import { type OfficialTransport, fetchOfficialPage } from "../../src/official-sites/fetch.js";
import type { DnsLookup } from "../../src/official-sites/url-policy.js";

const publicLookup: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("fetchOfficialPage deadlines", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not start transport when DNS exhausts the deadline", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValue(125);
    let transportCalls = 0;
    const transport: OfficialTransport = async () => {
      transportCalls += 1;
      return {
        statusCode: 200,
        headers: { "content-type": "text/plain" },
        body: (async function* () {
          yield new TextEncoder().encode("late");
        })(),
        discard: () => undefined,
      };
    };

    const result = await fetchOfficialPage("https://race.example", {
      lookup: publicLookup,
      transport,
      timeoutMs: 10,
    });

    expect(result).toEqual({
      kind: "failed",
      url: "https://race.example/",
      reason: "timeout",
    });
    expect(transportCalls).toBe(0);
  });

  it("actively aborts an in-flight transport on deadline", async () => {
    vi.useFakeTimers();
    let aborted = false;
    let observedTimeout = 0;
    let markTransportStarted: (() => void) | undefined;
    const transportStarted = new Promise<void>((resolve) => {
      markTransportStarted = resolve;
    });
    const transport: OfficialTransport = (request) => {
      observedTimeout = request.timeoutMs;
      markTransportStarted?.();
      const signal = Object.getOwnPropertyDescriptor(request, "signal")?.value;
      if (signal instanceof AbortSignal) {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
      }
      return new Promise(() => undefined);
    };

    const result = fetchOfficialPage("https://race.example", {
      lookup: publicLookup,
      transport,
      timeoutMs: 25,
    });
    await transportStarted;
    vi.advanceTimersByTime(25);

    await expect(result).resolves.toEqual({
      kind: "failed",
      url: "https://race.example/",
      reason: "timeout",
    });
    expect(observedTimeout).toBeGreaterThan(0);
    expect(aborted).toBe(true);
  });

  it("times out a DNS lookup that never settles", async () => {
    vi.useFakeTimers();
    const hangingLookup: DnsLookup = () => new Promise(() => undefined);

    const result = fetchOfficialPage("https://race.example", {
      lookup: hangingLookup,
      timeoutMs: 25,
    });
    vi.advanceTimersByTime(25);

    await expect(result).resolves.toEqual({
      kind: "failed",
      url: "https://race.example",
      reason: "timeout",
    });
  });

  it("discards a response whose body stream times out", async () => {
    vi.useFakeTimers();
    let discards = 0;
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const transport: OfficialTransport = async () => ({
      statusCode: 200,
      headers: { "content-type": "text/html" },
      body: {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            markBodyStarted?.();
            return new Promise(() => undefined);
          },
        }),
      },
      discard: () => {
        discards += 1;
      },
    });

    const result = fetchOfficialPage("https://race.example", {
      lookup: publicLookup,
      transport,
      timeoutMs: 25,
    });
    await bodyStarted;
    vi.advanceTimersByTime(25);

    await expect(result).resolves.toEqual({
      kind: "failed",
      url: "https://race.example/",
      reason: "timeout",
    });
    expect(discards).toBe(1);
  });
});
