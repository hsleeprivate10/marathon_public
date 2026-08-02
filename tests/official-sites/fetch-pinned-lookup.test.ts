import { describe, expect, it } from "vitest";
import { type PinnedRequest, pinnedLookup } from "../../src/official-sites/fetch.js";

const basePinnedRequest = {
  url: "https://race.example/event",
  hostname: "race.example",
  method: "GET",
  headers: {},
  timeoutMs: 1000,
  signal: new AbortController().signal,
} satisfies Omit<PinnedRequest, "address" | "family">;

describe("pinnedLookup", () => {
  it.each([
    ["IPv4", "93.184.216.34", 4],
    ["IPv6", "2606:4700:4700::1111", 6],
  ] as const)(
    "returns a pinned %s array when lookup requests all addresses",
    async (_label, address, family) => {
      const lookup = pinnedLookup({ ...basePinnedRequest, address, family });

      const result = await new Promise<
        readonly { readonly address: string; readonly family: 4 | 6 }[]
      >((resolve, reject) => {
        lookup("race.example", { all: true }, (error, addresses) => {
          if (error !== null) {
            reject(error);
            return;
          }
          if (!Array.isArray(addresses)) {
            reject(new TypeError("expected all-address lookup result"));
            return;
          }
          const pinnedAddresses: { readonly address: string; readonly family: 4 | 6 }[] = [];
          for (const entry of addresses) {
            if (entry.family === 4) {
              pinnedAddresses.push({ address: entry.address, family: 4 });
            } else if (entry.family === 6) {
              pinnedAddresses.push({ address: entry.address, family: 6 });
            } else {
              reject(new TypeError("expected pinned lookup families"));
              return;
            }
          }
          resolve(pinnedAddresses);
        });
      });

      expect(result).toEqual([{ address, family }]);
    },
  );

  it.each([
    ["IPv4", "93.184.216.34", 4],
    ["IPv6", "2606:4700:4700::1111", 6],
  ] as const)(
    "returns a pinned %s scalar when lookup requests one address",
    async (_label, address, family) => {
      const lookup = pinnedLookup({ ...basePinnedRequest, address, family });

      const result = await new Promise<{ readonly address: string; readonly family: 4 | 6 }>(
        (resolve, reject) => {
          lookup("race.example", {}, (error, resolvedAddress, resolvedFamily) => {
            if (error !== null) {
              reject(error);
              return;
            }
            if (typeof resolvedAddress !== "string") {
              reject(new TypeError("expected scalar lookup address"));
              return;
            }
            if (resolvedFamily !== 4 && resolvedFamily !== 6) {
              reject(new TypeError("expected scalar lookup family"));
              return;
            }
            resolve({ address: resolvedAddress, family: resolvedFamily });
          });
        },
      );

      expect(result).toEqual({ address, family });
    },
  );
});
