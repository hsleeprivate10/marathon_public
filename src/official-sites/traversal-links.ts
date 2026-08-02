import { isGenericHomepageUrl, safeOfficialPageUrl } from "./application-url-policy.js";
import { scanContextualFieldLinks } from "./contextual-field-links.js";
import { canonicalUrl } from "./discovery-url-policy.js";
import { scanHtmlAnchors } from "./html-anchors.js";

export type TraversalChildLinkDiscovery = {
  readonly links: readonly string[];
  readonly policyRejected: number;
};

type LinkCandidate = {
  readonly href: string;
  readonly explicit: boolean;
};

export function discoverTraversalChildLinks(
  html: string,
  pageUrl: string,
): TraversalChildLinkDiscovery {
  let policyRejected = 0;
  const byUrl = new Map<string, string>();
  for (const candidate of childCandidates(html, pageUrl)) {
    const canonical = canonicalUrl(candidate.href, pageUrl);
    if (canonical === undefined) {
      policyRejected += 1;
      continue;
    }
    const safe = safeOfficialPageUrl(canonical);
    if (safe === null || isGenericHomepageUrl(safe)) {
      policyRejected += 1;
      continue;
    }
    byUrl.set(safe, safe);
  }
  return {
    links: [...byUrl.values()].sort((left, right) => left.localeCompare(right)),
    policyRejected,
  };
}

function childCandidates(html: string, pageUrl: string): readonly LinkCandidate[] {
  const explicit = scanHtmlAnchors(html).flatMap((anchor) => {
    if (isOfficialLabel(anchor.text) || isSafeSameHostPage(anchor.href, pageUrl)) {
      return [{ href: anchor.href, explicit: true }];
    }
    return [];
  });
  const contextual = scanContextualFieldLinks(html).map((link) => ({
    href: link.href,
    explicit: false,
  }));
  return [...explicit, ...contextual];
}

function isOfficialLabel(value: string): boolean {
  const compact = value.replace(/[\s\p{P}\p{S}]+/gu, "");
  return /공식홈페이지|대회홈페이지|^홈페이지(?:$|안내|바로가기)/u.test(compact);
}

function isSafeSameHostPage(raw: string, pageUrl: string): boolean {
  if (!URL.canParse(raw, pageUrl)) return false;
  const url = new URL(raw, pageUrl);
  const page = new URL(pageUrl);
  if (url.hostname.toLowerCase() !== page.hostname.toLowerCase()) return false;
  const safe = safeOfficialPageUrl(url.href);
  return safe !== null && !isGenericHomepageUrl(safe);
}
