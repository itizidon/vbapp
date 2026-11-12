import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SelfSkillRatings,
  InternalRatingCard,
} from "../src/components/profile-skill-ratings";
const sport = {
  id: "beach",
  name: "Beach Volleyball",
  slug: "beach-volleyball",
  skills: [
    {
      id: "passing",
      sportId: "beach",
      name: "Passing",
      slug: "passing",
      active: true,
      requiredForSelfAssessment: true,
    },
    {
      id: "defense",
      sportId: "beach",
      name: "Defense",
      slug: "defense",
      active: true,
      requiredForSelfAssessment: true,
    },
  ],
};
const assessment = {
  id: "assessment",
  sportId: "beach",
  overallLevel: "B",
  ratings: [{ skillId: "passing", rating: 2 }],
};
function setup(
  rows: { skillId: string; currentRating: number; feedbackCount: number }[],
  failure = false,
) {
  const fetcher = vi.fn(async (_url, options) => ({
    ok: !failure,
    status: failure ? 500 : 200,
    json: async () =>
      failure
        ? { errors: [{ message: "Ratings unavailable" }] }
        : {
            data: {
              internalRatingSummary: {
                overallRating: rows.length ? 4.1235 : null,
                ratedSkillCount: rows.length,
                totalSkillCount: 2,
                ratings: rows,
              },
            },
          },
  }));
  vi.stubGlobal("fetch", fetcher);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <section aria-label="Self-assessment">
        <SelfSkillRatings sport={sport} assessment={assessment} />
      </section>
      <InternalRatingCard userId="owner" sport={sport} />
    </QueryClientProvider>,
  );
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

it("shows separate self and internal cards with the backend overall rating", async () => {
  const fetcher = setup([
    { skillId: "passing", currentRating: 4.12345678, feedbackCount: 3 },
  ]);
  const internal = within(
    screen.getByRole("region", { name: /^Internal rating$/ }),
  );
  await within(
    await internal.findByRole("row", { name: /Passing/ }),
  ).findByText("4.1235 / 5");
  const self = within(screen.getByRole("region", { name: "Self-assessment" }));
  expect(within(self.getByRole("table")).getByText("2 / 5")).toBeVisible();
  expect(
    within(self.getByRole("table")).queryByText("4.1235 / 5"),
  ).not.toBeInTheDocument();
  expect(
    within(internal.getByLabelText("Overall internal rating")).getByText(
      "4.1235 / 5",
    ),
  ).toBeVisible();
  expect(internal.getByText("1 of 2 skills rated")).toBeVisible();
  expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toEqual({
    userId: "owner",
    sportId: "beach",
  });
  expect(assessment.ratings[0].rating).toBe(2);
});
it("shows unrated for uninitialized internal skills and overall score", async () => {
  setup([]);
  const internal = within(
    screen.getByRole("region", { name: /^Internal rating$/ }),
  );
  await internal.findByLabelText("Overall internal rating");
  expect(
    within(internal.getByLabelText("Overall internal rating")).getByText(
      "Unrated",
    ),
  ).toBeVisible();
  expect(internal.getByText("0 of 2 skills rated")).toBeVisible();
  expect(
    within(internal.getByRole("row", { name: /Passing/ })).getByText("Unrated"),
  ).toBeVisible();
  expect(
    within(
      screen.getByRole("table", { name: "Beach Volleyball self ratings" }),
    ).getByText("2 / 5"),
  ).toBeVisible();
});
it("keeps the self-assessment card available when the internal card cannot load", async () => {
  setup([], true);
  await screen.findByText("Ratings unavailable");
  expect(
    within(
      screen.getByRole("table", { name: "Beach Volleyball self ratings" }),
    ).getByText("2 / 5"),
  ).toBeVisible();
  expect(
    screen.queryByLabelText("Overall internal rating"),
  ).not.toBeInTheDocument();
});
