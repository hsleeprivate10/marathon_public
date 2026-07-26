import { Buffer } from "node:buffer";
import { safeApplicationUrl } from "../official-sites/application-url-policy.js";

type DetailRoute = {
  readonly pathPrefix: string;
  readonly identifierPattern: RegExp;
  readonly exactPath?: string;
  readonly searchPattern?: RegExp;
};

type DetailOptions = {
  readonly baseUrl: string;
  readonly routes: readonly DetailRoute[];
};

const SENSITIVE_SEGMENTS = new Set(["admin", "member", "file"]);
const MAX_DECODE_DEPTH = 8;

const GO_RUNNING_ROUTES = [
  {
    pathPrefix: "/races/",
    identifierPattern: /^(?:[A-Za-z0-9][A-Za-z0-9_-]*|\d+\/[A-Za-z0-9][A-Za-z0-9_-]*\/?)$/,
  },
  {
    pathPrefix: "/race/view.php",
    exactPath: "/race/view.php",
    identifierPattern: /^$/,
    searchPattern: /^\?idx=\d+$/,
  },
] as const;
const KOR_MARATHON_ROUTES = [
  { pathPrefix: "/ko/race/", identifierPattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/ },
] as const;
const E_MARATHON_ROUTES = [
  { pathPrefix: "/race/view/", identifierPattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/ },
  {
    pathPrefix: "/bbs/board.php",
    exactPath: "/bbs/board.php",
    identifierPattern: /^$/,
    searchPattern: /^\?bo_table=emara04_01&wr_id=\d+$/,
  },
] as const;
const RUNNING_MAP_ROUTES = [
  { pathPrefix: "/race/", identifierPattern: /^(?:view\/)?[\p{L}\p{N}][\p{L}\p{N}_-]*$/u },
] as const;
const MAEDAL_ROUTES = [
  { pathPrefix: "/races/", identifierPattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/ },
] as const;
const KAAF_ROUTES = [
  {
    pathPrefix: "/mobile/info/inside_view.asp",
    exactPath: "/mobile/info/inside_view.asp",
    identifierPattern: /^$/,
    searchPattern: /^\?no=\d+$/,
  },
] as const;
const MARATHON_MOA_ROUTES = [
  { pathPrefix: "/events/", identifierPattern: /^[0-9a-f]{8}-[0-9a-f-]{27}$/i },
] as const;
const MARATHON_MATE_ROUTES = [
  { pathPrefix: "/race/", identifierPattern: /^[A-Za-z0-9][A-Za-z0-9_-]*$/ },
] as const;

function decodeRecursively(value: string): string | null {
  let current = value;
  for (let depth = 0; depth < MAX_DECODE_DEPTH; depth += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch (error) {
      if (error instanceof URIError) return null;
      throw error;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function hasUnsafeRawPath(rawRef: string): boolean {
  if (rawRef.trim() !== rawRef || hasControlCharacter(rawRef)) return true;
  const decoded = decodeRecursively(rawRef);
  if (decoded === null) return true;
  if (decoded.includes("\\")) return true;
  const pathPart = decoded.split(/[?#]/, 1)[0] ?? "";
  const segments = pathPart.split(/[\/]+/).filter((segment) => segment.length > 0);
  return segments.some((segment) => segment === "." || segment === "..");
}

function normalizedSegments(pathname: string): readonly string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function hasSensitiveNormalizedPath(pathname: string): boolean {
  const segments = normalizedSegments(pathname).map((segment) => segment.toLowerCase());
  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment))) return true;
  return segments.some((segment) => segment.endsWith(".pdf"));
}

function routeMatches(url: URL, pathname: string, route: DetailRoute): boolean {
  if (route.exactPath !== undefined && pathname !== route.exactPath) return false;
  if (route.searchPattern === undefined && url.search !== "") return false;
  if (route.searchPattern !== undefined && !route.searchPattern.test(url.search)) return false;
  if (!pathname.startsWith(route.pathPrefix)) return false;
  const identifier = pathname.slice(route.pathPrefix.length);
  return route.identifierPattern.test(identifier);
}

export function safeSourceDetailUrl(rawRef: string, options: DetailOptions): string | null {
  if (hasUnsafeRawPath(rawRef)) return null;
  if (!URL.canParse(rawRef, options.baseUrl)) return null;
  const url = new URL(rawRef, options.baseUrl);
  const base = new URL(options.baseUrl);
  if (url.username !== "" || url.password !== "") return null;
  if (url.hash !== "") return null;
  if (url.origin !== base.origin) return null;
  const pathname = decodeRecursively(url.pathname);
  if (
    pathname === null ||
    hasControlCharacter(pathname) ||
    pathname.includes("\\") ||
    /%[0-9a-f]{2}/iu.test(pathname)
  )
    return null;
  if (hasSensitiveNormalizedPath(pathname)) return null;
  if (!options.routes.some((route) => routeMatches(url, pathname, route))) return null;
  return safeApplicationUrl(url.toString());
}

export function safeDetailUrl(rawRef: string, options: DetailOptions): string | null {
  return safeSourceDetailUrl(rawRef, options);
}

export function detailFixtureName(sourceUrlOrPath: string, baseUrl: string): string {
  const url = new URL(sourceUrlOrPath, baseUrl);
  const exactPath = `${url.pathname}${url.search}`;
  return `${Buffer.from(exactPath, "utf8").toString("base64url")}.html`;
}

export function safeGoRunningDetailUrl(rawRef: string): string | null {
  return safeDetailUrl(rawRef, { baseUrl: "https://gorunning.kr", routes: GO_RUNNING_ROUTES });
}

export function safeKorMarathonDetailUrl(rawRef: string): string | null {
  return safeDetailUrl(rawRef, {
    baseUrl: "https://www.kormarathon.com",
    routes: KOR_MARATHON_ROUTES,
  });
}

export function safeEMarathonDetailUrl(rawRef: string): string | null {
  return safeDetailUrl(rawRef, { baseUrl: "https://emarathon.or.kr", routes: E_MARATHON_ROUTES });
}

export function safeRunningMapDetailUrl(rawRef: string): string | null {
  return safeDetailUrl(rawRef, { baseUrl: "https://runningmap.kr", routes: RUNNING_MAP_ROUTES });
}

export function safeMaedalDetailUrl(rawRef: string): string | null {
  return safeDetailUrl(rawRef, { baseUrl: "https://maedal.com", routes: MAEDAL_ROUTES });
}

export function safeKaafDetailUrl(rawRef: string): string | null {
  return safeDetailUrl(rawRef, { baseUrl: "https://m.kaaf.or.kr", routes: KAAF_ROUTES });
}

export function safeMarathonMoaDetailUrl(rawRef: string): string | null {
  return (
    safeDetailUrl(rawRef, { baseUrl: "https://marathon.me.kr", routes: MARATHON_MOA_ROUTES }) ??
    safeDetailUrl(rawRef, { baseUrl: "https://marathonmoa.com", routes: MARATHON_MOA_ROUTES })
  );
}

export function safeMarathonMateDetailUrl(rawRef: string): string | null {
  return (
    safeDetailUrl(rawRef, {
      baseUrl: "https://marathonmate.store",
      routes: MARATHON_MATE_ROUTES,
    }) ??
    safeDetailUrl(rawRef, { baseUrl: "https://marathonmate.com", routes: MARATHON_MATE_ROUTES })
  );
}
