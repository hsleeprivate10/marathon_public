import type { Course } from "./contract.js";

const courseAliases: Readonly<Record<string, Course["name"]>> = {
  풀: "풀",
  풀코스: "풀",
  full: "풀",
  fullcourse: "풀",
  "42.195k": "풀",
  "42.195km": "풀",
  하프: "하프",
  하프코스: "하프",
  half: "하프",
  halfcourse: "하프",
  "21.0975k": "하프",
  "21.0975km": "하프",
  "10k": "10K",
  "10km": "10K",
  "5k": "5K",
  "5km": "5K",
};

type RawCourse = {
  readonly name: string;
  readonly price: number | null;
  readonly priceSource?: Course["priceSource"];
};

export function canonicalCourseName(raw: string): Course["name"] | null {
  return courseAliases[raw.trim().toLowerCase().replaceAll(/\s+/g, "")] ?? null;
}

export function canonicalCourses(rawCourses: ReadonlyArray<RawCourse>): Course[] {
  const courses = new Map<Course["name"], Course>();
  for (const raw of rawCourses) {
    const name = canonicalCourseName(raw.name);
    if (name === null) continue;
    const existing = courses.get(name);
    if (existing !== undefined && existing.price !== null) continue;
    courses.set(name, {
      name,
      price: raw.price,
      ...(raw.priceSource === undefined ? {} : { priceSource: raw.priceSource }),
    });
  }
  return [...courses.values()];
}
