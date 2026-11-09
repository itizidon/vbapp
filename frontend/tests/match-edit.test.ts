import { expect, it } from "vitest";
import { parseTeamScore } from "../src/lib/match-edit";
it("distinguishes unrecorded scores from zero", () => {
  expect(parseTeamScore("")).toBeNull();
  expect(parseTeamScore(" ")).toBeNull();
  expect(parseTeamScore("0")).toBe(0);
  expect(parseTeamScore("21")).toBe(21);
});
it.each(["-1", "1.5", "NaN", "Infinity", "2147483648"])(
  "rejects an invalid score: %s",
  (value) => expect(() => parseTeamScore(value)).toThrow("whole number"),
);
