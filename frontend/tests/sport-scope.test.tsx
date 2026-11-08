import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCatalog, useFeedback, useSummary } from "../src/lib/hooks";

const beach = {
  id: "beach",
  name: "Beach Volleyball",
  slug: "beach-volleyball",
  skills: [{ id: "passing", sportId: "beach", name: "Passing", active: true }],
};
const tennis = {
  id: "tennis",
  name: "Tennis",
  slug: "tennis",
  skills: [
    { id: "forehand", sportId: "tennis", name: "Forehand", active: true },
  ],
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const { query } = JSON.parse(options.body);
      const data = query.includes("Catalog")
        ? { sports: [tennis, beach] }
        : query.includes("Summary")
          ? {
              userSkillRatings: [
                { skillId: "passing", average: 4, count: 3 },
                { skillId: "forehand", average: 1, count: 100 },
              ],
              userSportFeedbackSummary: [
                { sportId: "beach", feedbackCount: 3 },
                { sportId: "tennis", feedbackCount: 100 },
              ],
              mySelfAssessments: [
                { id: "beach-assessment", sportId: "beach" },
                { id: "tennis-assessment", sportId: "tennis" },
              ],
            }
          : {
              receivedFeedback: [
                { id: "tennis-feedback", sportId: "tennis" },
                { id: "beach-feedback", sportId: "beach" },
              ],
            };
      return { ok: true, status: 200, json: async () => ({ data }) };
    }),
  );
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
afterEach(() => vi.unstubAllGlobals());
it("exposes only Beach Volleyball when the backend offers multiple sports", async () => {
  const { result } = renderHook(() => useCatalog(), { wrapper: setup() });
  await waitFor(() =>
    expect(result.current.data?.sports.map((s) => s.slug)).toEqual([
      "beach-volleyball",
    ]),
  );
});
it("excludes other sports from received feedback", async () => {
  const { result } = renderHook(() => useFeedback(), { wrapper: setup() });
  await waitFor(() =>
    expect(result.current.data?.rows.map((f) => f.id)).toEqual([
      "beach-feedback",
    ]),
  );
});
it("uses Beach Volleyball totals, ratings, and assessments even with other sport history", async () => {
  const { result } = renderHook(() => useSummary("user"), { wrapper: setup() });
  await waitFor(() => expect(result.current.data?.feedbackCount.count).toBe(3));
  expect(result.current.data?.userSkillRatings).toEqual([
    { skillId: "passing", average: 4, count: 3 },
  ]);
  expect(result.current.data?.mySelfAssessments.map((a) => a.id)).toEqual([
    "beach-assessment",
  ]);
});
