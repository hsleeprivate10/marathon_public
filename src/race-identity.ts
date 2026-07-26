import type { Race } from "./contract.js";
import { isKnownAggregatorUrl } from "./official-sites/application-url-policy.js";

type Destination = {
  readonly host: string;
  readonly key: string;
};

export function normalizeRaceName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/[【\[](.*?)[】\]]/g, "")
    .replace(/[（(](.*?)[）)]/g, "")
    .replace(/\s*(?:대회|마라톤|축제|코스| Challenge|Race|Run)$/i, "")
    .replace(/제\s*\d+\s*회/g, "")
    .replace(/[^\w가-힣\s]/g, "")
    .trim()
    .toLowerCase();
}

export function compactRaceName(name: string): string {
  return normalizeRaceName(name).replace(/\s+/g, "");
}

export function isAggregatorUrl(raw: string): boolean {
  return isKnownAggregatorUrl(raw);
}

export function representsSameEvent(left: Race, right: Race): boolean {
  if (left.eventDate !== right.eventDate) return false;
  const leftCompactName = compactRaceName(left.name);
  const leftDestination = destination(left);
  const rightDestination = destination(right);
  const nameSimilarity = bigramSimilarity(comparableName(left.name), comparableName(right.name));
  const venueSimilarity = bigramSimilarity(
    comparableVenue(left.venue),
    comparableVenue(right.venue),
  );

  if (leftCompactName.length >= 4 && leftCompactName === compactRaceName(right.name)) {
    if (venueSimilarity >= 0.35) return true;
    return (
      leftDestination !== undefined &&
      rightDestination !== undefined &&
      leftDestination.key === rightDestination.key
    );
  }

  if (leftDestination === undefined || rightDestination === undefined) return false;
  if (leftDestination.host !== rightDestination.host) return false;
  if (leftDestination.key === rightDestination.key)
    return nameSimilarity >= 0.5 || (nameSimilarity >= 0.15 && venueSimilarity >= 0.5);
  return nameSimilarity >= 0.5 && venueSimilarity >= 0.35;
}

function destination(race: Race): Destination | undefined {
  const identityUrl = race.urlScheme ?? race.applicationUrl;
  const url = new URL(identityUrl);
  const host = canonicalHostname(url.hostname);
  if (isKnownAggregatorUrl(identityUrl)) return undefined;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return { host, key: `${host}${path}${url.search}` };
}

function canonicalHostname(hostname: string): string {
  return hostname.replace(/\.$/, "").replace(/^www\./, "");
}

function comparableName(name: string): string {
  return normalizeRaceName(name)
    .replace(/s[-\s]*oil/gi, "s오일")
    .replace(/이차전지/g, "2차전지")
    .replace(/20\d{2}|\d+주년|전국|국제|하프|육상경기|trail|run|utmb/gi, "")
    .replace(/(?:마라톤|대회|레이스)/g, "")
    .replace(/[^a-z0-9가-힣]/gi, "");
}

function comparableVenue(venue: string): string {
  return venue.replace(/[^a-z0-9가-힣]/gi, "").toLowerCase();
}

function bigramSimilarity(left: string, right: string): number {
  if (left === right) return left.length === 0 ? 0 : 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftBigrams = new Set<string>();
  const rightBigrams = new Set<string>();
  for (let index = 0; index < left.length - 1; index += 1)
    leftBigrams.add(left.slice(index, index + 2));
  for (let index = 0; index < right.length - 1; index += 1)
    rightBigrams.add(right.slice(index, index + 2));
  let intersection = 0;
  for (const bigram of leftBigrams) if (rightBigrams.has(bigram)) intersection += 1;
  return intersection / (leftBigrams.size + rightBigrams.size - intersection);
}
