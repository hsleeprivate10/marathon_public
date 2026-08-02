import { safeKorMarathonDetailUrl } from "./detail-source-url.js";

export type ParsedKorMarathonRace = {
  readonly name: string;
  readonly eventDate: string;
  readonly detailUrl: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const isoMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const dottedMatch = raw.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (dottedMatch) {
    return `${dottedMatch[1]}-${(dottedMatch[2] ?? "").padStart(2, "0")}-${(dottedMatch[3] ?? "").padStart(2, "0")}`;
  }
  return null;
}

function parseJsonLdRace(rawData: unknown): ParsedKorMarathonRace | null {
  if (!isRecord(rawData)) return null;
  if (rawData["@type"] !== "Event" && !rawData.name) return null;
  const name = typeof rawData.name === "string" ? rawData.name : "";
  if (name.length <= 2) return null;
  const startDate = typeof rawData.startDate === "string" ? rawData.startDate : "";
  const eventDate = normalizeDate(startDate);
  if (eventDate === null) return null;
  return {
    name,
    eventDate,
    detailUrl:
      typeof rawData.identifier === "string"
        ? safeKorMarathonDetailUrl(`/ko/race/${rawData.identifier}`)
        : null,
  };
}

export function parseKorMarathonHtml(html: string): ReadonlyArray<ParsedKorMarathonRace> {
  const races: ParsedKorMarathonRace[] = [];
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch = jsonLdPattern.exec(html);
  while (ldMatch !== null) {
    try {
      const parsed = parseJsonLdRace(JSON.parse(ldMatch[1] ?? ""));
      if (parsed !== null) races.push(parsed);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    ldMatch = jsonLdPattern.exec(html);
  }

  const rscPattern = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let rscMatch = rscPattern.exec(html);
  while (rscMatch !== null) {
    const decoded = (rscMatch[1] ?? "")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    const nameMatch = decoded.match(/"name":"([^"]{4,80})"/);
    const dateMatch = decoded.match(/"date":"(\d{4}-\d{2}-\d{2})"/);
    const idMatch = decoded.match(/"id":"([^"]+)"/);
    if (nameMatch?.[1] && dateMatch?.[1]) {
      races.push({
        name: nameMatch[1],
        eventDate: dateMatch[1],
        detailUrl:
          idMatch?.[1] === undefined ? null : safeKorMarathonDetailUrl(`/ko/race/${idMatch[1]}`),
      });
    }
    rscMatch = rscPattern.exec(html);
  }

  const cardPattern = /<div[^>]*class="[^"]*race[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let cardMatch = cardPattern.exec(html);
  while (cardMatch !== null) {
    const inner = cardMatch[1] ?? "";
    const nameTag = inner.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
    const dateTag = inner.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (nameTag?.[1] && dateTag) {
      races.push({
        name: nameTag[1].trim(),
        eventDate: `${dateTag[1]}-${dateTag[2]?.padStart(2, "0")}-${dateTag[3]?.padStart(2, "0")}`,
        detailUrl: null,
      });
    }
    cardMatch = cardPattern.exec(html);
  }

  return races;
}
