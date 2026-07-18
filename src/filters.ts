import type { Race } from "./contract.js";

export type Filters = {
  readonly region: string;
  readonly distance: string;
  readonly status: string;
};

export function filterRaces(races: readonly Race[], filters: Filters): readonly Race[] {
  return races.filter((race) => {
    const hasDistance =
      filters.distance === "" || race.courses.some((course) => course.name === filters.distance);
    return (
      (filters.region === "" || race.region === filters.region) &&
      hasDistance &&
      (filters.status === "" || race.registrationStatus === filters.status)
    );
  });
}
