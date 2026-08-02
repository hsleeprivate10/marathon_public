import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { safeApplicationUrl, safeOfficialPageUrl } from "./application-url-policy.js";
import { isPublicAddress } from "./ip-policy.js";

export type IpFamily = 4 | 6;

export type DnsAddress = {
  readonly address: string;
  readonly family: IpFamily;
};

export type DnsLookup = (hostname: string) => Promise<readonly DnsAddress[]>;

export type UrlFetchPurpose = "official" | "traversal";

export type ResolvePublicUrlOptions = {
  readonly lookup?: DnsLookup;
  readonly purpose?: UrlFetchPurpose;
};

export type UrlPolicyRejection =
  | "invalid-url"
  | "unsupported-protocol"
  | "credentials"
  | "blocked-hostname"
  | "blocked-address"
  | "unsafe-public-url"
  | "dns-failure";

export type UrlPolicyResult =
  | {
      readonly kind: "allowed";
      readonly url: string;
      readonly hostname: string;
      readonly address: string;
      readonly family: IpFamily;
    }
  | { readonly kind: "rejected"; readonly reason: UrlPolicyRejection };

const defaultLookup: DnsLookup = async (hostname) => {
  const addresses = await nodeLookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : [],
  );
};

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase();
  const unwrapped = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return unwrapped.endsWith(".") ? unwrapped.slice(0, -1) : unwrapped;
}

function safeUrlForPurpose(url: URL, purpose: UrlFetchPurpose): string | null {
  switch (purpose) {
    case "official":
      return safeOfficialPageUrl(url.href);
    case "traversal":
      return safeApplicationUrl(url.href);
  }
}

function urlPolicyOptions(
  options: DnsLookup | ResolvePublicUrlOptions,
): Required<ResolvePublicUrlOptions> {
  if (typeof options === "function") return { lookup: options, purpose: "official" };
  return { lookup: options.lookup ?? defaultLookup, purpose: options.purpose ?? "official" };
}

export async function resolvePublicUrl(
  input: string,
  options: DnsLookup | ResolvePublicUrlOptions = {},
): Promise<UrlPolicyResult> {
  const { lookup, purpose } = urlPolicyOptions(options);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { kind: "rejected", reason: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "rejected", reason: "unsupported-protocol" };
  }
  if (url.username !== "" || url.password !== "") {
    return { kind: "rejected", reason: "credentials" };
  }

  const hostname = normalizedHostname(url);
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return { kind: "rejected", reason: "blocked-hostname" };
  }

  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!isPublicAddress(hostname, literalFamily)) {
      return { kind: "rejected", reason: "blocked-address" };
    }
    const safeUrl = safeUrlForPurpose(url, purpose);
    if (safeUrl === null) return { kind: "rejected", reason: "unsafe-public-url" };
    return { kind: "allowed", url: safeUrl, hostname, address: hostname, family: literalFamily };
  }

  let addresses: readonly DnsAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return { kind: "rejected", reason: "dns-failure" };
  }
  if (addresses.length === 0) return { kind: "rejected", reason: "dns-failure" };
  if (addresses.some((entry) => !isPublicAddress(entry.address, entry.family))) {
    return { kind: "rejected", reason: "blocked-address" };
  }
  const pinned = addresses[0];
  if (pinned === undefined) return { kind: "rejected", reason: "dns-failure" };
  const safeUrl = safeUrlForPurpose(url, purpose);
  if (safeUrl === null) return { kind: "rejected", reason: "unsafe-public-url" };
  return {
    kind: "allowed",
    url: safeUrl,
    hostname,
    address: pinned.address,
    family: pinned.family,
  };
}
