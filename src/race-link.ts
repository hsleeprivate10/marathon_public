import type { Race } from "./contract.js";

export function raceHref(race: Race): string | null {
  return race.officialSiteUrl ?? null;
}
