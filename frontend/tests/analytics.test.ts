import { expect, it } from "vitest";
import {
  analyticsBounds,
  categoryAverage,
  calendarDay,
} from "../src/lib/analytics";
it("clamps calendar month and year ranges instead of overflowing short months", () => {
  const now = new Date(2026, 2, 31, 12);
  const start = new Date(analyticsBounds("1M", now).from!);
  expect(start.getMonth()).toBe(1);
  expect(start.getDate()).toBe(28);
  const leap = new Date(analyticsBounds("1Y", new Date(2024, 1, 29, 12)).from!);
  expect(leap.getFullYear()).toBe(2023);
  expect(leap.getDate()).toBe(28);
});
it("supports one week, YTD, and all time with a shared ending timestamp", () => {
  const now = new Date(2026, 10, 8, 12);
  expect(new Date(analyticsBounds("1W", now).from!).getDate()).toBe(2);
  expect(new Date(analyticsBounds("YTD", now).from!).getMonth()).toBe(0);
  expect(new Date(analyticsBounds("YTD", now).from!).getDate()).toBe(1);
  expect(analyticsBounds("ALL", now)).toEqual({
    from: null,
    before: now.toISOString(),
  });
});
it("keeps averages weighted by the number of ratings for any backend category", () => {
  const points = [
    {
      date: "2026-11-01",
      winRate: null,
      wins: 0,
      losses: 0,
      ratings: [{ skillId: "custom", average: 1, count: 1 }],
    },
    {
      date: "2026-11-02",
      winRate: null,
      wins: 0,
      losses: 0,
      ratings: [{ skillId: "custom", average: 5, count: 3 }],
    },
  ];
  expect(categoryAverage(points, "custom")).toBe(4);
  expect(categoryAverage(points, "missing")).toBeNull();
  expect(
    calendarDay(new Date("2026-11-08T02:00:00Z"), "America/New_York"),
  ).toBe("2026-11-07");
});
