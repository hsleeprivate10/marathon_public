import { describe, expect, it } from "vitest";
import { type DnsLookup, resolvePublicUrl } from "../../src/official-sites/url-policy.js";

const publicLookup: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

const reservedIpv6Addresses = [
  "101::1",
  "200::1",
  "400::1",
  "800::1",
  "1000::1",
  "4000::1",
  "6000::1",
  "8000::1",
  "a000::1",
  "c000::1",
  "e000::1",
  "f000::1",
  "f800::1",
  "fe00::1",
  "::ffff:0:7f00:1",
  "::ffff:0:a00:1",
] as const;

const blockedOfficialPaths = [
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

describe("resolvePublicUrl", () => {
  it.each([
    ["not a URL", "invalid-url"],
    ["ftp://example.com/race", "unsupported-protocol"],
    ["https://user:secret@example.com/race", "credentials"],
    ["https://localhost/race", "blocked-hostname"],
    ["https://api.local/race", "blocked-hostname"],
  ])("rejects %s", async (input, reason) => {
    const result = await resolvePublicUrl(input, publicLookup);

    expect(result).toEqual({ kind: "rejected", reason });
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "224.0.0.1",
    "0.0.0.0",
    "[::1]",
    "[fc00::1]",
    "[fe80::1]",
    "[ff02::1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:10.0.0.1]",
    "[64:ff9b::7f00:1]",
    "[100:0:0:1::1]",
    "[2001:2::1]",
    "[2001:10::1]",
    "[2001:20::1]",
    "[2001:5::1]",
    "[2002:a00:1::]",
    "[3fff::1]",
    "[5f00::1]",
    "[fec0::1]",
  ])("rejects raw non-public address %s", async (hostname) => {
    const result = await resolvePublicUrl(`https://${hostname}/race`, publicLookup);

    expect(result).toEqual({ kind: "rejected", reason: "blocked-address" });
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.31.0.1",
    "192.168.0.1",
    "169.254.0.1",
    "239.1.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "ff05::1",
    "::ffff:192.168.1.1",
    "64:ff9b::7f00:1",
    "100:0:0:1::1",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "2001:5::1",
    "2002:a00:1::",
    "3fff::1",
    "5f00::1",
    "fec0::1",
  ])("rejects DNS-resolved non-public address %s", async (address) => {
    const lookup: DnsLookup = async () => [{ address, family: address.includes(":") ? 6 : 4 }];

    const result = await resolvePublicUrl("https://race.example/path", lookup);

    expect(result).toEqual({ kind: "rejected", reason: "blocked-address" });
  });

  it("rejects an answer set containing any non-public address", async () => {
    const lookup: DnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];

    const result = await resolvePublicUrl("https://race.example", lookup);

    expect(result).toEqual({ kind: "rejected", reason: "blocked-address" });
  });

  it.each(reservedIpv6Addresses)("rejects reserved top-level IPv6 literal %s", async (address) => {
    const result = await resolvePublicUrl(`https://[${address}]/race`, publicLookup);

    expect(result).toEqual({ kind: "rejected", reason: "blocked-address" });
  });

  it.each(reservedIpv6Addresses)(
    "rejects reserved top-level IPv6 DNS answer %s",
    async (address) => {
      const lookup: DnsLookup = async () => [{ address, family: 6 }];

      const result = await resolvePublicUrl("https://race.example", lookup);

      expect(result).toEqual({ kind: "rejected", reason: "blocked-address" });
    },
  );

  it("returns a canonical URL and one validated pin for public HTTPS", async () => {
    const result = await resolvePublicUrl("https://Race.Example:443/event#details", publicLookup);

    expect(result).toEqual({
      kind: "allowed",
      url: "https://race.example/event#details",
      hostname: "race.example",
      address: "93.184.216.34",
      family: 4,
    });
  });

  it.each(blockedOfficialPaths)("rejects unsafe official-page path %s", async (path) => {
    const result = await resolvePublicUrl(`https://Race.Example.${path}`, publicLookup);

    expect(result).toEqual({ kind: "rejected", reason: "unsafe-public-url" });
  });

  it("allows safe registration paths only for traversal purpose", async () => {
    // Given: a public application seed URL that is safe to inspect but not publish.
    const input = "https://Race.Example/register";

    // When: the same URL is resolved for official publication and traversal inspection.
    const official = await resolvePublicUrl(input, { lookup: publicLookup, purpose: "official" });
    const traversal = await resolvePublicUrl(input, { lookup: publicLookup, purpose: "traversal" });

    // Then: official policy stays strict while traversal receives a pinned public URL.
    expect(official).toEqual({ kind: "rejected", reason: "unsafe-public-url" });
    expect(traversal).toEqual({
      kind: "allowed",
      url: "https://race.example/register",
      hostname: "race.example",
      address: "93.184.216.34",
      family: 4,
    });
  });

  it.each([
    ["https://user:secret@race.example/register", "credentials"],
    ["https://race.example/admin", "unsafe-public-url"],
    ["https://race.example/api/races", "unsafe-public-url"],
    ["https://payments.example/register", "unsafe-public-url"],
  ])("rejects unsafe traversal URL %s", async (input, reason) => {
    // Given: a traversal seed with a forbidden target class.
    // When: traversal-purpose policy resolves it.
    const result = await resolvePublicUrl(input, { lookup: publicLookup, purpose: "traversal" });

    // Then: the seed is rejected before transport.
    expect(result).toEqual({ kind: "rejected", reason });
  });

  it.each([
    "/events/apiary",
    "/events/member-run",
    "/events/administrator-race",
    "/events/graphql-marathon#private",
    "/events/register-run",
    "/events/application-guide",
  ])("allows benign event path %s", async (path) => {
    const result = await resolvePublicUrl(`https://race.example${path}`, publicLookup);

    expect(result).toMatchObject({ kind: "allowed", address: "93.184.216.34" });
  });

  it.each([
    "2000::1",
    "3000::1",
    "2606:4700:4700::1111",
    "2001:1::1",
    "2001:3::1",
    "2001:4:112::1",
    "2001:30::1",
    "2620:4f:8000::1",
  ])("allows globally reachable IPv6 address %s", async (address) => {
    const lookup: DnsLookup = async () => [{ address, family: 6 }];

    const result = await resolvePublicUrl("https://race.example", lookup);

    expect(result).toMatchObject({ kind: "allowed", address, family: 6 });
  });

  it.each([
    "100.64.0.1",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.2",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "240.0.0.1",
  ])("rejects audited special-purpose IPv4 address %s", async (address) => {
    const lookup: DnsLookup = async () => [{ address, family: 4 }];

    const result = await resolvePublicUrl("https://race.example", lookup);

    expect(result).toEqual({ kind: "rejected", reason: "blocked-address" });
  });

  it("returns typed DNS failure instead of throwing", async () => {
    const lookup: DnsLookup = async () => {
      throw new Error("resolver unavailable");
    };

    const result = await resolvePublicUrl("https://race.example", lookup);

    expect(result).toEqual({ kind: "rejected", reason: "dns-failure" });
  });
});
