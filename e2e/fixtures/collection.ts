import type { Page } from "@playwright/test";
import type { CollectionOutput, Race } from "../../src/contract.js";
import { routeWeather } from "./weather.js";

type RaceFixture = {
  readonly id: string;
  readonly name: string;
  readonly eventDate: string;
  readonly region: string;
  readonly course: "풀" | "하프" | "10K" | "5K";
  readonly status: "open" | "closing-soon" | "closed" | "unknown";
};

const generatedAt = "2026-01-01T00:00:00.000Z";
const fixtureTime = "2026-07-18T09:00:00+09:00";
const currentYear = 2026;
const currentMonth = 7;
const alternateMonth = 3;
const sharedMonth = 2;
const isoDate = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function race(fixture: RaceFixture): Race {
  return {
    name: fixture.name,
    eventDate: fixture.eventDate,
    registrationDeadline: null,
    venue: `${fixture.region} 시민운동장`,
    region: fixture.region,
    courses: [{ name: fixture.course, price: null }],
    applicationUrl: `https://example.com/calendar-race-${fixture.id}`,
    officialSiteUrl: `https://official.example/calendar-race-${fixture.id}`,
    sources: ["e2e-fixture"],
    verified: true,
    lastVerified: generatedAt,
    updatedAt: generatedAt,
    generatedAt,
    registrationStatus: fixture.status,
  };
}

export const officialRaceLinkFixture = {
  normalName: "현재 달 서울 마라톤",
  normalApplicationUrl: "https://example.com/calendar-race-current",
  normalOfficialSiteUrl: "https://official.example/calendar-race-current",
  aggregatorName: "고러닝 발견 전용 대회",
  aggregatorApplicationUrl: "https://gorunning.kr/races/aggregator-only-race",
} as const;

const fixtureRaces = [
  race({
    id: "current",
    name: "현재 달 서울 마라톤",
    eventDate: isoDate(currentYear, currentMonth, 15),
    region: "서울",
    course: "10K",
    status: "open",
  }),
  race({
    id: "alternate",
    name: "봄빛 부산 하프마라톤",
    eventDate: isoDate(currentYear, alternateMonth, 10),
    region: "부산",
    course: "하프",
    status: "closing-soon",
  }),
  race({
    id: "shared-current",
    name: "함께 달리는 대전 마라톤",
    eventDate: isoDate(currentYear, sharedMonth, 20),
    region: "대전",
    course: "하프",
    status: "closed",
  }),
  race({
    id: "shared-next",
    name: "내년 함께 달리는 광주 마라톤",
    eventDate: isoDate(currentYear + 1, sharedMonth, 21),
    region: "광주",
    course: "5K",
    status: "unknown",
  }),
].sort((left, right) => left.eventDate.localeCompare(right.eventDate));

export const e2eCollection: CollectionOutput = {
  generatedAt,
  races: fixtureRaces,
  collectionMetadata: [
    {
      id: "e2e-fixture",
      attempted: true,
      succeeded: true,
      recordCount: fixtureRaces.length,
      message: "deterministic browser fixture",
    },
  ],
};

const allMonths = [...new Set(fixtureRaces.map((item) => item.eventDate.slice(0, 7)))].sort();
const firstYear = String(currentYear);
const secondYear = String(currentYear + 1);

export const fixtureShape = {
  allMonths,
  allYears: [firstYear, secondYear],
  allMonthNumbers: [...new Set(allMonths.map((month) => month.slice(5, 7)))].sort(),
  firstYear,
  firstYearMonths: allMonths.filter((month) => month.startsWith(`${firstYear}-`)),
  secondYear,
  secondYearMonths: allMonths.filter((month) => month.startsWith(`${secondYear}-`)),
  sharedMonth: String(sharedMonth).padStart(2, "0"),
  initialCalendarHeading: "2026년 7월",
} as const;

export const emptyCollection: CollectionOutput = {
  generatedAt,
  races: [],
  collectionMetadata: [],
};

export const aggregatorOnlyCollection: CollectionOutput = {
  generatedAt,
  races: [
    {
      name: officialRaceLinkFixture.aggregatorName,
      eventDate: isoDate(currentYear, currentMonth, 16),
      registrationDeadline: null,
      venue: "서울 시민운동장",
      region: "서울",
      courses: [{ name: "10K", price: null }],
      applicationUrl: officialRaceLinkFixture.aggregatorApplicationUrl,
      sources: ["gorunning"],
      verified: true,
      lastVerified: generatedAt,
      updatedAt: generatedAt,
      generatedAt,
      registrationStatus: "open",
    },
  ],
  collectionMetadata: [
    {
      id: "gorunning",
      attempted: true,
      succeeded: true,
      recordCount: 1,
      message: "deterministic aggregator-only browser fixture",
    },
  ],
};

export async function routeCollection(
  page: Page,
  collection: CollectionOutput = e2eCollection,
): Promise<void> {
  await routeWeather(page);
  await page.route("**/races.json", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(collection) });
  });
}

export async function fixFixtureClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(fixtureTime);
}
