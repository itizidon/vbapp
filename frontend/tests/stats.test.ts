import { it, expect } from "vitest";
import { summarize, filterFeedback, formatTrendPeriod } from "../src/lib/stats";
import type { Feedback } from "../src/lib/types";
const row = (id: string, date: string, ratings: number[]): Feedback => ({
  id,
  createdAt: date,
  sportId: "s",
  recipientId: "u",
  reviewerId: null,
  guestName: "Guest",
  overallComment: null,
  status: "PUBLISHED",
  ratings: ratings.map((rating, i) => ({ skillId: String(i), rating })),
  analyticsAllowed: false,
  evidenceAllowed: false,
});
it("weights the average by individual ratings and represents no data honestly", () => {
  expect(summarize([]).average).toBe(null);
  expect(
    summarize([row("a", "2026-10-01", [5, 5]), row("b", "2026-11-01", [2])])
      .average,
  ).toBe(4);
});
it("filters inclusive dates and skills without mutating cached rows", () => {
  const rows = [
    row("b", "2026-11-02T10:00:00Z", [2]),
    row("a", "2026-11-01T10:00:00Z", [5, 4]),
  ];
  expect(
    filterFeedback(rows, "1", "2026-11-01", "2026-11-01", "oldest").map(
      (r) => r.id,
    ),
  ).toEqual(["a"]);
  expect(filterFeedback(rows, "", "", "", "oldest")[0].id).toBe("a");
  expect(rows[0].id).toBe("b");
});

it("keeps UTC month buckets in the correct displayed month", () => {
  expect(formatTrendPeriod("2026-11-01T00:00:00.000Z", "en-US")).toBe("Nov 26");
});
