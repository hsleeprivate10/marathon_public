import { ipFamily, isPublicAddress } from "./official-sites/ip-policy.js";

const BLOCKED_LOGO_BASENAMES = new Set<string>([
  "favicon",
  "apple-touch-icon",
  "default",
  "placeholder",
  "no-image",
  "noimage",
] as const);
const MAX_URL_LENGTH = 4096;
const DECODE_PASSES = [0, 1, 2, 3] as const;

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.charCodeAt(0);
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

export function safeRaceLogoUrl(raw: string | null, base?: string): string | null {
  if (
    raw === null ||
    raw.length > MAX_URL_LENGTH ||
    raw.trim() === "" ||
    raw.trim() !== raw ||
    containsAsciiControl(raw) ||
    (base !== undefined &&
      (base.length > MAX_URL_LENGTH || base.trim() !== base || containsAsciiControl(base)))
  ) {
    return null;
  }

  let url: URL;
  if (URL.canParse(raw)) {
    url = new URL(raw);
  } else {
    if (base === undefined || !URL.canParse(base)) return null;
    const baseUrl = new URL(base);
    if (baseUrl.protocol !== "https:" || !URL.canParse(raw, baseUrl)) return null;
    url = new URL(raw, baseUrl);
  }

  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;

  const rawHostname = url.hostname.toLowerCase();
  const unwrappedHostname = rawHostname.startsWith("[") ? rawHostname.slice(1, -1) : rawHostname;
  const hostname = unwrappedHostname.endsWith(".")
    ? unwrappedHostname.slice(0, -1)
    : unwrappedHostname;
  if (
    hostname === "" ||
    hostname.split(".").some((label) => label === "") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return null;
  }

  const family = ipFamily(hostname);
  if ((family === 4 || family === 6) && !isPublicAddress(hostname, family)) return null;

  let path = url.pathname;
  for (const _pass of DECODE_PASSES) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch (error) {
      if (error instanceof URIError) return null;
      throw error;
    }
    if (decoded === path) break;
    path = decoded;
  }
  if (/%[0-9a-f]{2}/iu.test(path)) return null;

  const hasBlockedBasename = path
    .toLowerCase()
    .split(/[\\/]/u)
    .some((segment) => {
      const basename = (segment.split(";", 1)[0] ?? "").replace(/\.+$/u, "").split(".", 1)[0];
      return basename !== undefined && BLOCKED_LOGO_BASENAMES.has(basename);
    });
  return hasBlockedBasename ? null : url.toString();
}
