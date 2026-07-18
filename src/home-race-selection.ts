type RaceSelection = {
  readonly year: string;
  readonly month: string;
};

type RaceSelectionOptions = {
  readonly years: readonly string[];
  readonly months: readonly string[];
};

export function raceSelectionOptions(
  raceMonths: readonly string[],
  selectedYear: string,
): RaceSelectionOptions {
  const years = [...new Set(raceMonths.map((raceMonth) => raceMonth.slice(0, 4)))].sort();
  const availableMonths =
    selectedYear === ""
      ? raceMonths
      : raceMonths.filter((raceMonth) => raceMonth.startsWith(`${selectedYear}-`));
  const months = [...new Set(availableMonths.map((raceMonth) => raceMonth.slice(5, 7)))].sort();
  return { years, months };
}

export function visibleRaceMonths(
  raceMonths: readonly string[],
  selection: RaceSelection,
): readonly string[] {
  return raceMonths.filter((raceMonth) => {
    const matchesYear = selection.year === "" || raceMonth.startsWith(`${selection.year}-`);
    const matchesMonth = selection.month === "" || raceMonth.endsWith(`-${selection.month}`);
    return matchesYear && matchesMonth;
  });
}
