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
