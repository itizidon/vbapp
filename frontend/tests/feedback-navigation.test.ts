import { expect, it } from "vitest";
import { feedbackReturnDestination } from "../src/lib/navigation";
it.each([
  "/feedback",
  "/matches",
  "/matches/a-match",
  "/feedback?kind=match",
  "/account",
])("preserves authenticated app context: %s", (path) => {
  expect(feedbackReturnDestination(path, true)).toBe(path);
});
it.each([
  undefined,
  "https://evil.example",
  "//evil.example",
  "/\\evil.example",
  "/\tevil.example",
  "/f/another-token",
  "/login?next=//evil.example",
  "/unknown",
])("rejects untrusted context: %s", (path) => {
  expect(feedbackReturnDestination(path, true)).toBe("/matches");
  expect(feedbackReturnDestination(path, false)).toBe("/");
});
it("keeps guests on public destinations", () => {
  expect(feedbackReturnDestination("/matches/a-match", false)).toBe("/");
  expect(feedbackReturnDestination("/feedback", false)).toBe("/");
  expect(feedbackReturnDestination("/players/public-player", false)).toBe(
    "/players/public-player",
  );
});
