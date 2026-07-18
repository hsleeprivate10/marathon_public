import type { Race } from "./contract.js";

export function raceHref(race: Race): string {
  return race.applicationUrl;
}
