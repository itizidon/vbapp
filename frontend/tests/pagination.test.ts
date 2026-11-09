import { expect, it } from "vitest";
import { nextPageCursor, pageRows } from "../src/lib/pagination";
import {
  matchDateVariables,
  feedbackDateVariables,
} from "../src/lib/match-date-range";
it("uses a hidden lookahead row and starts the next page without skipping it", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
  }));
  const pages: { id: string }[] = [];
  let cursor: string | undefined;
  do {
    const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
    const response = rows.slice(start, start + 11);
    pages.push(...pageRows(response));
    cursor = nextPageCursor(response);
  } while (cursor);
  expect(pages).toEqual(rows);
  expect(nextPageCursor(rows.slice(0, 10))).toBeUndefined();
  expect(nextPageCursor([])).toBeUndefined();
});
it("includes the full selected end date using local calendar boundaries", () => {
  expect(matchDateVariables({ from: "2026-11-01", to: "2026-11-01" })).toEqual({
    playedFrom: new Date(2026, 10, 1).toISOString(),
    playedBefore: new Date(2026, 10, 2).toISOString(),
  });
  expect(matchDateVariables({ from: "", to: "" })).toEqual({
    playedFrom: null,
    playedBefore: null,
  });
});
it("validates ranges and allows either boundary on its own", () => {
  expect(() =>
    matchDateVariables({ from: "2026-11-09", to: "2026-11-01" }),
  ).toThrow("From date");
  expect(() => matchDateVariables({ from: "2026-02-30", to: "" })).toThrow(
    "valid date",
  );
  expect(
    matchDateVariables({ from: "2026-11-01", to: "" }).playedBefore,
  ).toBeNull();
  expect(
    matchDateVariables({ from: "", to: "2026-11-01" }).playedFrom,
  ).toBeNull();
});

it("maps feedback date ranges to submission timestamps with inclusive local days", () => {
  expect(
    feedbackDateVariables({ from: "2026-11-01", to: "2026-11-01" }),
  ).toEqual({
    createdFrom: new Date(2026, 10, 1).toISOString(),
    createdBefore: new Date(2026, 10, 2).toISOString(),
  });
});
