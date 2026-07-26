export interface GoRunningListItem {
  readonly detailPath: string;
  readonly name: string;
  readonly eventDate: string;
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function parseRows(section: string, eventDate: string): GoRunningListItem[] {
  const races: GoRunningListItem[] = [];
  for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = row[1] ?? "";
    const link = rowHtml.match(/href="(\/races\/\d+\/[A-Za-z0-9_-]+\/?)"[^>]*>([\s\S]*?)<\/a>/i);
    if (link?.[1] === undefined || link[2] === undefined) continue;
    races.push({
      detailPath: link[1],
      name: text(link[2]),
      eventDate,
    });
  }
  return races;
}

function parseLegacyRows(html: string): GoRunningListItem[] {
  const races: GoRunningListItem[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = row[1] ?? "";
    const link = rowHtml.match(/href="(\/race\/view\.php\?idx=\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    const date = rowHtml.match(/(\d{4}-\d{2}-\d{2})/i)?.[1];
    if (link?.[1] === undefined || link[2] === undefined || date === undefined) continue;
    races.push({
      detailPath: link[1],
      name: text(link[2]),
      eventDate: date,
    });
  }
  return races;
}

export function parseGoRunningList(html: string): readonly GoRunningListItem[] {
  const anchors = [...html.matchAll(/id="race-(\d{4}-\d{2}-\d{2})"/g)];
  const races: GoRunningListItem[] = [];
  const seen = new Set<string>();

  for (const [index, anchor] of anchors.entries()) {
    const eventDate = anchor[1];
    if (eventDate === undefined) continue;
    const end = anchors[index + 1]?.index ?? html.length;
    for (const race of parseRows(html.slice(anchor.index, end), eventDate)) {
      if (seen.has(race.detailPath)) continue;
      seen.add(race.detailPath);
      races.push(race);
    }
  }

  if (races.length > 0) return races;

  const legacyRaces = parseLegacyRows(html);
  if (legacyRaces.length > 0) return legacyRaces;

  for (const match of html.matchAll(
    /<a[^>]*href="(\/races\/[^"?#]+|\/race\/view\.php\?idx=\d+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const detailPath = match[1];
    const name = text(match[2] ?? "");
    if (detailPath === undefined || name.length < 3) continue;
    races.push({ detailPath, name, eventDate: "" });
  }
  return races;
}
