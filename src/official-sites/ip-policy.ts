type IpFamily = 4 | 6;
type Prefix = readonly [network: bigint, length: number];

// IANA IPv4 special-purpose ranges plus multicast space.
const IPV4_BLOCKED_PREFIXES: readonly Prefix[] = [
  [0x00000000n, 8],
  [0x0a000000n, 8],
  [0x64400000n, 10],
  [0x7f000000n, 8],
  [0xa9fe0000n, 16],
  [0xac100000n, 12],
  [0xc0000000n, 24],
  [0xc0000200n, 24],
  [0xc0586300n, 24],
  [0xc0a80000n, 16],
  [0xc6120000n, 15],
  [0xc6336400n, 24],
  [0xcb007100n, 24],
  [0xe0000000n, 4],
  [0xf0000000n, 4],
];

// IANA non-global IPv6 space, transition prefixes, multicast, and deprecated site-local.
const IPV6_BLOCKED_PREFIXES: readonly Prefix[] = [
  [0x00000000000000000000000000000000n, 96],
  [0x00000000000000000000ffff00000000n, 96],
  [0x0064ff9b000000000000000000000000n, 96],
  [0x0064ff9b000100000000000000000000n, 48],
  [0x01000000000000000000000000000000n, 64],
  [0x01000000000000010000000000000000n, 64],
  [0x20010000000000000000000000000000n, 23],
  [0x20010000000000000000000000000000n, 32],
  [0x20010002000000000000000000000000n, 48],
  [0x20010010000000000000000000000000n, 28],
  [0x20010020000000000000000000000000n, 28],
  [0x20010db8000000000000000000000000n, 32],
  [0x20020000000000000000000000000000n, 16],
  [0x3fff0000000000000000000000000000n, 20],
  [0x5f000000000000000000000000000000n, 16],
  [0xfc000000000000000000000000000000n, 7],
  [0xfe800000000000000000000000000000n, 10],
  [0xfec00000000000000000000000000000n, 10],
  [0xff000000000000000000000000000000n, 8],
];

const IPV6_PUBLIC_EXCEPTIONS: readonly Prefix[] = [
  [0x20010001000000000000000000000001n, 128],
  [0x20010001000000000000000000000002n, 128],
  [0x20010001000000000000000000000003n, 128],
  [0x20010003000000000000000000000000n, 32],
  [0x20010004011200000000000000000000n, 48],
  [0x20010030000000000000000000000000n, 28],
];

const IPV6_GLOBAL_UNICAST: Prefix = [0x20000000000000000000000000000000n, 3];

function ipv4Value(address: string): bigint | undefined {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return undefined;
  }
  return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function ipv6Value(address: string): bigint | undefined {
  const sides = address.toLowerCase().split("::");
  if (sides.length > 2) return undefined;
  const left = sides[0] === "" ? [] : (sides[0]?.split(":") ?? []);
  const right = sides.length === 1 || sides[1] === "" ? [] : (sides[1]?.split(":") ?? []);
  const parse = (part: string): number | undefined =>
    /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : undefined;
  const parsed = [...left.map(parse), ...right.map(parse)];
  const missing = 8 - left.length - right.length;
  if (
    parsed.includes(undefined) ||
    (sides.length === 1 && missing !== 0) ||
    (sides.length === 2 && missing < 1)
  ) {
    return undefined;
  }
  const groups = [
    ...left.map(parse),
    ...Array.from({ length: missing }, () => 0),
    ...right.map(parse),
  ];
  return groups.reduce((value, group) => (value << 16n) | BigInt(group ?? 0), 0n);
}

export function ipFamily(address: string): IpFamily | 0 {
  if (ipv4Value(address) !== undefined) return 4;
  if (ipv6Value(address) !== undefined) return 6;
  return 0;
}

function matchesPrefix(value: bigint, prefix: Prefix, width: number): boolean {
  const shift = BigInt(width - prefix[1]);
  return value >> shift === prefix[0] >> shift;
}

export function isPublicAddress(address: string, family: IpFamily): boolean {
  if (ipFamily(address) !== family) return false;
  const value = family === 4 ? ipv4Value(address) : ipv6Value(address);
  if (value === undefined) return false;
  const prefixes = family === 4 ? IPV4_BLOCKED_PREFIXES : IPV6_BLOCKED_PREFIXES;
  const width = family === 4 ? 32 : 128;
  if (family === 6 && !matchesPrefix(value, IPV6_GLOBAL_UNICAST, width)) return false;
  if (
    family === 6 &&
    IPV6_PUBLIC_EXCEPTIONS.some((prefix) => matchesPrefix(value, prefix, width))
  ) {
    return true;
  }
  return !prefixes.some((prefix) => matchesPrefix(value, prefix, width));
}
