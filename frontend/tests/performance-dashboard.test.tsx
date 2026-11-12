import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PerformanceSummaryCards } from "../src/components/performance-summary-cards";
import { SkillRatingCard } from "../src/components/skill-rating-card";
import { PlayerSkillRadarChart } from "../src/components/player-skill-radar-chart";
afterEach(() => vi.unstubAllGlobals());
it("renders the four career cards from actual API fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          myPerformanceSummary: {
            winRate: 66.666,
            currentStreak: 2,
            streakKind: "WIN",
            gamesPlayed: 9,
            averagePlayerRating: 3.7523,
            ratedSkillCount: 5,
          },
        },
      }),
    })),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PerformanceSummaryCards />
    </QueryClientProvider>,
  );
  await screen.findByText("66.7%");
  expect(screen.getByText("2W")).toBeVisible();
  expect(screen.getByText("9", { exact: true })).toBeVisible();
  expect(screen.getByText("3.75")).toBeVisible();
  expect(document.querySelectorAll(".performance-stat")).toHaveLength(4);
});
it("shows an unavailable gauge instead of zero for a missing skill", () => {
  const select = vi.fn();
  render(
    <SkillRatingCard
      name="Serving"
      axis="serving"
      rating={null}
      selfRating={null}
      selected={false}
      onSelect={select}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Serving: Not rated" }));
  expect(select).toHaveBeenCalledTimes(1);
  expect(screen.getByText("—")).toBeVisible();
  expect(screen.getByText("N/A")).toBeInTheDocument();
  expect(screen.getByText("No comparison yet")).toBeVisible();
});
it("keeps immersive skill gauges in sync with the source switch without comparison", () => {
  const data = ["Passing", "Setting", "Attack", "Serving", "Defense"].map(
    (name) => ({
      skillId: name,
      skillName: name,
      skillSlug: name.toLowerCase(),
      selfRating: 4,
      internalRating: 3.5,
      averageFeedbackRating: 4.25,
    }),
  );
  render(<PlayerSkillRadarChart data={data} immersive allowCompare={false} />);
  expect(
    screen.getByRole("button", { name: "Passing: 3.5 out of 5" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("switch"));
  expect(
    screen.getByRole("button", { name: "Passing: 4 out of 5" }),
  ).toBeVisible();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch"));
  expect(
    screen.getByRole("button", { name: "Passing: 3.5 out of 5" }),
  ).toBeVisible();
  expect(screen.queryByLabelText("Radar legend")).not.toBeInTheDocument();
});
