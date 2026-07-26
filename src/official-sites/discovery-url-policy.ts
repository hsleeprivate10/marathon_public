import type { DiscoveredRaceLink } from "../adapters/types.js";
import {
  decodedPath,
  hasBlockedPrivateBasename,
  safeOfficialPageUrl,
} from "./application-url-policy.js";

type LinkKind = DiscoveredRaceLink["kind"];

export interface RaceDetailContext {
  readonly present: boolean;
  readonly sourceDetailUrl?: string;
}

export interface UrlPolicyInput {
  readonly sourcePageUrl: string;
  readonly sourceHosts: readonly string[];
  readonly aggregatorHosts: readonly string[];
  readonly raceDetailContext: RaceDetailContext;
}

const TRACKING_PARAMS =
  "utm_source utm_medium utm_campaign utm_term utm_content gclid fbclid mc_cid mc_eid".split(" ");
const SOCIAL_HOST_PARTS = [
  "facebook.",
  "twitter.",
  "instagram.",
  "youtube.",
  "youtu.be",
  "band.us",
  "pf.kakao.com",
  "story.kakao.com",
  "x.com",
] as const;

const BLOCKED_EXTENSIONS = [
  ".pdf",
  ".hwp",
  ".hwpx",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".zip",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
] as const;
export function canonicalUrl(raw: string, base: string): string | undefined {
  const trimmed = raw.trim();
  if (!URL.canParse(trimmed, base)) return undefined;
  const url = new URL(trimmed, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const host = canonicalHostname(url.hostname);
  if (host === undefined) return undefined;
  try {
    url.hostname = host;
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  if (url.username !== "" || url.password !== "") return undefined;
  url.username = "";
  url.password = "";
  url.hash = "";
  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  return url.toString();
}

export function isAllowedUrl(urlText: string, kind: LinkKind, input: UrlPolicyInput): boolean {
  if (kind === "application") return false;
  if (safeOfficialPageUrl(urlText) === null) return false;
  const url = new URL(urlText);
  const host = canonicalHostname(url.hostname);
  const path = decodedPath(url.pathname);
  if (host === undefined || path === null) return false;
  if (isBlockedHost(host)) return false;
  if (hasBlockedPrivateBasename(path)) return false;
  if (BLOCKED_EXTENSIONS.some((extension) => path.endsWith(extension))) return false;
  if (kind === "official-site" && isSourceOrAggregatorHost(host, input)) return false;
  return true;
}

export function hasOwnedSourceDetailContext(input: UrlPolicyInput): boolean {
  if (!input.raceDetailContext.present) return false;
  const sourceDetailUrl = input.raceDetailContext.sourceDetailUrl;
  if (sourceDetailUrl === undefined) return false;
  const canonicalSourcePageUrl = canonicalUrl(input.sourcePageUrl, input.sourcePageUrl);
  const canonicalSourceDetailUrl = canonicalUrl(sourceDetailUrl, input.sourcePageUrl);
  return (
    canonicalSourcePageUrl !== undefined &&
    canonicalSourceDetailUrl !== undefined &&
    canonicalSourcePageUrl === canonicalSourceDetailUrl
  );
}

export function canonicalHostname(value: string): string | undefined {
  const trimmed = value.trim().replace(/\.+$/u, "");
  if (trimmed === "") return undefined;
  if (!URL.canParse(`http://${trimmed}/`)) return undefined;
  const url = new URL(`http://${trimmed}/`);
  return url.hostname.toLowerCase().replace(/\.+$/u, "");
}

function isBlockedHost(host: string): boolean {
  if (host.startsWith("cdn.") || host.includes(".cdn.")) return true;
  if (host.startsWith("static.") || host.startsWith("assets.")) return true;
  return SOCIAL_HOST_PARTS.some((part) => host.includes(part));
}

function isSourceOrAggregatorHost(host: string, input: UrlPolicyInput): boolean {
  const sourcePageHost = canonicalHostname(new URL(input.sourcePageUrl).hostname);
  const configuredHosts = [sourcePageHost, ...input.sourceHosts, ...input.aggregatorHosts];
  const blocked = configuredHosts.flatMap((item) => {
    if (item === undefined) return [];
    const canonical = canonicalHostname(item);
    return canonical === undefined ? [] : [canonical];
  });
  return blocked.some((item) => host === item || host.endsWith(`.${item}`));
}
