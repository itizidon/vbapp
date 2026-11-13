import React from "react";
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedbackCard } from "../src/components/feedback-card";
import { feedbackReport, feedbackSummary } from "../src/lib/feedback-history";
import type { Feedback, Skill } from "../src/lib/types";
const skills: Skill[] = [
  "Attack",
  "Defense",
  "Passing",
  "Setting",
  "Serving",
].map((name) => ({
  id: name,
  name,
  slug: name.toLowerCase(),
  sportId: "beach",
  active: true,
  requiredForSelfAssessment: false,
}));
const feedback: Feedback = {
  id: "review",
  recipientId: "me",
  reviewerId: null,
  guestName: "Sam",
  sportId: "beach",
  matchId: "game",
  createdAt: "2026-11-12T12:00:00Z",
  status: "PUBLISHED",
  overallComment: "Great touch.",
  analyticsAllowed: false,
  evidenceAllowed: false,
  ratings: [
    { skillId: "Passing", rating: 4 },
    { skillId: "Setting", rating: 5, comment: "Good placement." },
  ],
};
it("shows only recorded skill scores, their average and guest identity without expansion", () => {
  render(<FeedbackCard feedback={feedback} skills={skills} />);
  expect(screen.getByText("4.50")).toBeVisible();
  expect(screen.getAllByRole("meter")).toHaveLength(2);
  expect(screen.getByRole("meter", { name: "Passing rating" })).toHaveAttribute(
    "aria-valuenow",
    "4",
  );
  expect(screen.queryByText("Defense")).not.toBeInTheDocument();
  expect(screen.getByText("Guest reviewer")).toBeVisible();
  expect(screen.getByText("Great touch.")).toBeVisible();
  expect(screen.queryByText("Category ratings")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View match" })).toHaveAttribute(
    "href",
    "/matches/game",
  );
  expect(
    screen.getByRole("link", { name: "View feedback from Sam" }),
  ).toHaveAttribute("href", "/feedback/review");
  expect(document.querySelector("a a")).toBeNull();
});
it("uses a registered username and a skill comment when the overall comment is blank", () => {
  render(
    <FeedbackCard
      feedback={{
        ...feedback,
        reviewerId: "member",
        reviewerUsername: "Taylor",
        overallComment: "  ",
      }}
      skills={skills}
    />,
  );
  expect(screen.getByRole("heading", { name: "Taylor" })).toBeVisible();
  expect(screen.getByText("Registered player")).toBeVisible();
  expect(screen.getByText("Good placement.")).toBeVisible();
});
it("does not invent a numerical rating for written-only feedback", () => {
  render(
    <FeedbackCard
      feedback={{ ...feedback, ratings: [], matchId: null }}
      skills={skills}
    />,
  );
  expect(screen.getByText("Written feedback")).toBeVisible();
  expect(screen.queryAllByRole("meter")).toHaveLength(0);
  expect(
    screen.queryByRole("link", { name: "View match" }),
  ).not.toBeInTheDocument();
  expect(feedbackReport({ ...feedback, ratings: null }).average).toBeNull();
});
it("weights complete backend aggregates by sample count instead of averaging averages", () => {
  const result = feedbackSummary(
    [
      { skillId: "Passing", average: 1, count: 9 },
      { skillId: "Setting", average: 5, count: 1 },
      { skillId: "other-sport", average: 5, count: 100 },
    ],
    skills,
  );
  expect(result.average).toBe(1.4);
  expect(result.top).toMatchObject({ name: "Setting", average: 5, count: 1 });
  expect(feedbackSummary([], skills)).toEqual({ average: null, top: null });
});
