import { ipFamily, isPublicAddress } from "./ip-policy.js";

const PAYMENT_HOST_LABELS = new Set(["pay", "payment", "payments", "checkout", "billing"]);
const PAYMENT_PATH_SEGMENTS = new Set([
  "pay",
  "payment",
  "payments",
  "checkout",
  "billing",
  "purchase",
]);
const BLOCKED_OFFICIAL_PATH_SEGMENTS = new Set([
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
]);
const REGISTRATION_DESTINATION_LABELS = new Set([
  "register",
  "registration",
  "apply",
  "application",
  "entry",
  "signup",
  "sign-up",
  "join",
  "enroll",
]);
export const KNOWN_AGGREGATOR_HOSTS = [
  "e-marathon.co.kr",
  "emarathon.or.kr",
  "gorunning.co.kr",
  "gorunning.kr",
  "kaaf.or.kr",
  "kormarathon.com",
  "m.kaaf.or.kr",
  "maedal.com",
  "marathon.me.kr",
  "marathongo.co.kr",
  "marathonmate.com",
  "marathonmate.store",
  "marathonmoa.com",
  "runningmap.com",
  "runningmap.kr",
] as const;
const AGGREGATOR_HOSTS = new Set<string>(KNOWN_AGGREGATOR_HOSTS);
const RACE_ID_QUERY_KEYS = new Set([
  "event",
  "eventid",
  "id",
  "idx",
  "no",
  "race",
  "raceid",
  "wr_id",
]);

export function safeApplicationUrl(raw: string | null, base?: string): string | null {
  if (raw === null) return null;
  try {
    const url = base === undefined ? new URL(raw) : new URL(raw, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    const hostname = normalizedHostname(url);
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    ) {
      return null;
    }
    const family = ipFamily(hostname);
    if ((family === 4 || family === 6) && !isPublicAddress(hostname, family)) return null;
    if (hostname.split(".").some((label) => PAYMENT_HOST_LABELS.has(label))) return null;
    const path = decodedPath(url.pathname);
    if (
      path === null ||
      hasBlockedPrivateBasename(path) ||
      path
        .split(/[\\/]/u)
        .some((segment) =>
          segment.split(/[^a-z0-9]+/u).some((token) => PAYMENT_PATH_SEGMENTS.has(token)),
        )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isGenericHomepageUrl(raw: string): boolean {
  const url = new URL(raw);
  const path = decodedPath(url.pathname);
  if (path === null) return true;
  const normalizedPath = path.replace(/\/+$/u, "") || "/";
  const isLandingPath = /^(?:\/|\/(?:home|main|index)(?:\.[a-z0-9]+)?|\/(?:en|ko|kr))$/u.test(
    normalizedPath,
  );
  if (!isLandingPath) return false;
  return ![...url.searchParams].some(
    ([key, value]) => RACE_ID_QUERY_KEYS.has(key.toLowerCase()) && value.trim() !== "",
  );
}

export function isKnownAggregatorUrl(raw: string): boolean {
  const url = new URL(raw);
  return AGGREGATOR_HOSTS.has(normalizedHostname(url).replace(/^www\./u, ""));
}

export function safeRaceApplicationUrl(raw: string | null, base?: string): string | null {
  const safeUrl = safeApplicationUrl(raw, base);
  if (safeUrl === null) return null;
  if (isGenericHomepageUrl(safeUrl)) return null;
  const url = new URL(safeUrl);
  const host = normalizedHostname(url).replace(/^www\./u, "");
  if (!AGGREGATOR_HOSTS.has(host)) return safeUrl;
  const path = decodedPath(url.pathname);
  if (path === null) return null;

  let isRaceSpecific = false;
  if (host === "emarathon.or.kr" || host === "e-marathon.co.kr") {
    isRaceSpecific =
      /^\/race\/view\/[a-z0-9][a-z0-9_-]*$/u.test(path) ||
      (path === "/bbs/board.php" && /^\?bo_table=emara04_01&wr_id=\d+$/u.test(url.search));
  } else if (host === "gorunning.kr" || host === "gorunning.co.kr") {
    isRaceSpecific =
      /^\/races\/(?:[a-z0-9][a-z0-9_-]*|\d+\/[a-z0-9][a-z0-9_-]*\/?)$/u.test(path) ||
      (path === "/race/view.php" && /^\?idx=\d+$/u.test(url.search));
  } else if (host === "kormarathon.com") {
    isRaceSpecific = /^\/ko\/race\/[a-z0-9][a-z0-9_-]*$/u.test(path);
  } else if (host === "runningmap.kr" || host === "runningmap.com") {
    isRaceSpecific = /^\/race\/(?:view\/)?[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(path);
  } else if (host === "maedal.com") {
    isRaceSpecific = /^\/races\/[a-z0-9][a-z0-9_-]*$/u.test(path);
  } else if (host === "marathon.me.kr" || host === "marathonmoa.com") {
    isRaceSpecific = /^\/events\/[a-z0-9][a-z0-9_-]*$/u.test(path);
  } else if (host === "marathonmate.store" || host === "marathonmate.com") {
    isRaceSpecific = /^\/race\/[a-z0-9][a-z0-9_-]*$/u.test(path);
  } else if (host === "kaaf.or.kr" || host === "m.kaaf.or.kr") {
    isRaceSpecific = path.endsWith("/inside_view.asp") && /^\?no=\d+$/u.test(url.search);
  }
  return isRaceSpecific ? safeUrl : null;
}

export function safeOfficialPageUrl(raw: string, base?: string): string | null {
  const safeUrl = safeApplicationUrl(raw, base);
  if (safeUrl === null) return null;
  const path = decodedPath(new URL(safeUrl).pathname);
  if (path === null || hasBlockedPrivateBasename(path)) return null;
  return isRegistrationDestination(safeUrl) ? null : safeUrl;
}

export function isRegistrationDestination(urlText: string): boolean {
  const url = new URL(urlText);
  const hostname = normalizedHostname(url);
  if (hostname.split(".").some((label) => REGISTRATION_DESTINATION_LABELS.has(label))) {
    return true;
  }
  const path = decodedPath(url.pathname);
  if (path === null) return false;
  return path.split(/[\\/]/u).some((segment) => {
    const basename = extensionlessBasename(segment.split(";", 1)[0] ?? "");
    return REGISTRATION_DESTINATION_LABELS.has(basename);
  });
}

function extensionlessBasename(segment: string): string {
  return segment.replace(/\.+$/u, "").split(".", 1)[0] ?? "";
}

export function hasBlockedPrivateBasename(path: string): boolean {
  return path.split(/[\\/]/u).some((rawSegment) => {
    const basename = extensionlessBasename(rawSegment.split(";", 1)[0] ?? "");
    return BLOCKED_OFFICIAL_PATH_SEGMENTS.has(basename);
  });
}

export function decodedPath(pathname: string): string | null {
  let current = pathname;
  for (const _pass of [0, 1, 2, 3] as const) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) return next.toLowerCase();
      current = next;
    } catch (error) {
      if (error instanceof URIError) return null;
      throw error;
    }
  }
  return /%[0-9a-f]{2}/iu.test(current) ? null : current.toLowerCase();
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase();
  const unwrapped = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return unwrapped.endsWith(".") ? unwrapped.slice(0, -1) : unwrapped;
}
