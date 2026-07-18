import type { Race } from "./contract.js";

export type PageRoute = "home" | "calendar";

export type RaceMonthGroup = {
  readonly month: string;
  readonly races: readonly Race[];
};

export function parsePageRoute(hash: string): PageRoute {
  return hash === "#/calendar" ? "calendar" : "home";
}

export function groupRacesByMonth(races: readonly Race[]): readonly RaceMonthGroup[] {
  const racesByMonth = new Map<string, Race[]>();

  for (const race of [...races].sort((left, right) =>
    left.eventDate.localeCompare(right.eventDate),
  )) {
    const month = race.eventDate.slice(0, 7);
    const monthRaces = racesByMonth.get(month);
    if (monthRaces === undefined) {
      racesByMonth.set(month, [race]);
    } else {
      monthRaces.push(race);
    }
  }

  return [...racesByMonth].map(([month, monthRaces]) => ({ month, races: monthRaces }));
}
