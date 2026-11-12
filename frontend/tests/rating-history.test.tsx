import { expect, it } from "vitest";
import {
  historyChartPoints,
  type HistoryPage,
  type HistoryPoint,
} from "../src/components/rating-history-chart";
const point = (
  id: string,
  sequence: string,
  timestamp: string,
  rating: number,
): HistoryPoint => ({
  id,
  sequence,
  timestamp,
  recordedAt: timestamp,
  previousRating: 3,
  newRating: rating,
  delta: rating - 3,
  type: "FEEDBACK_APPLIED",
});
it("carries a real opening baseline forward to the selected range", () => {
  const page: HistoryPage = {
    items: [point("next", "2", "2026-11-05T13:00:00Z", 3.1)],
    baseline: point("old", "1", "2026-10-01T12:00:00Z", 3),
    hasMore: false,
    nextCursor: null,
    revision: 1,
  };
  const points = historyChartPoints([page], "2026-11-01T00:00:00Z");
  expect(points.map((p) => [p.type, p.value])).toEqual([
    ["OPENING_BASELINE", 3],
    ["FEEDBACK_APPLIED", 3.1],
  ]);
  expect(points[0].time).toBe(Date.parse("2026-11-01T00:00:00Z"));
  expect(points[0].recordedAt).toBe("2026-10-01T12:00:00Z");
});
it("keeps equal-timestamp events in backend sequence order across pages", () => {
  const pages: HistoryPage[] = [
    {
      items: [point("a", "1", "2026-11-05T13:00:00Z", 3)],
      baseline: null,
      hasMore: true,
      nextCursor: "1",
      revision: 1,
    },
    {
      items: [point("b", "2", "2026-11-05T13:00:00Z", 2.9)],
      baseline: null,
      hasMore: false,
      nextCursor: null,
      revision: 1,
    },
  ];
  expect(historyChartPoints(pages).map((p) => p.id)).toEqual(["a", "b"]);
});
it("does not invent a baseline when no earlier rating is known", () => {
  expect(
    historyChartPoints(
      [
        {
          items: [],
          baseline: null,
          hasMore: false,
          nextCursor: null,
          revision: 1,
        },
      ],
      "2026-11-01T00:00:00Z",
    ),
  ).toEqual([]);
});
