import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackSubmissionForm } from "../src/components/feedback-form";
vi.mock("next/navigation", () => ({
  usePathname: () => "/f/test-token",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/lib/hooks", () => ({
  useUser: () => ({ isPending: false, data: undefined, error: null }),
  useMatches: () => ({ data: { rows: [] } }),
  useMatch: () => ({}),
  useCatalog: () => {
    throw new Error(
      "Guest forms must fetch the invitation's categories directly",
    );
  },
}));
const skills = [
  "Attack",
  "Defense",
  "Passing",
  "Setting",
  "Serving",
  "Communication",
].map((name) => ({
  id: name.toLowerCase(),
  name,
  sportId: "invited-sport",
  slug: name.toLowerCase(),
  active: true,
  requiredForSelfAssessment: false,
  description: `${name} from the backend.`,
}));
function setup(
  categories = skills,
  match: null | {
    id: string;
    playedAt: string;
    teams: { teamNumber: number; score: number; players: string[] }[];
    unassignedPlayers: string[];
  } = null,
) {
  const fetcher = vi.fn(async (_url, options) => {
    const { query } = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () =>
        query.includes("FeedbackInvitation")
          ? {
              data: {
                feedbackInvitation: {
                  recipientId: "player",
                  sport: {
                    id: "invited-sport",
                    name: "Beach Volleyball",
                    slug: "beach-volleyball",
                    skills: categories,
                  },
                  match,
                },
              },
            }
          : { data: { submitGuestFeedback: { id: "saved" } } },
    };
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(
    ["feedback-categories", "invited-sport", "signed-invite"],
    {
      sport: {
        id: "invited-sport",
        skills: skills.filter((s) =>
          ["Attack", "Passing", "Setting"].includes(s.name),
        ),
      },
    },
  );
  render(
    <QueryClientProvider client={client}>
      <FeedbackSubmissionForm
        recipientId="player"
        sportId="invited-sport"
        token="signed-invite"
      />
    </QueryClientProvider>,
  );
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
it("refreshes stale categories and renders every backend skill with descriptions for guests", async () => {
  const fetcher = setup([
    ...skills,
    { ...skills[0], id: "retired", name: "Retired category", active: false },
  ]);
  await screen.findByRole("group", { name: "Defense" });
  for (const skill of skills) {
    expect(
      screen.getByRole("group", { name: skill.name }),
    ).toHaveAccessibleDescription(skill.description);
    expect(
      screen.getByLabelText(`${skill.name} comment (optional)`),
    ).toBeInTheDocument();
  }
  expect(
    screen.queryByRole("heading", { name: "Retired category" }),
  ).not.toBeInTheDocument();
  expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toEqual({
    token: "signed-invite",
  });
});
it("submits guest scores and comments using the fetched skill IDs", async () => {
  const fetcher = setup();
  await screen.findByRole("group", { name: "Serving" });
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Guest player" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Defense: 4 out of 5" }));
  fireEvent.click(screen.getByRole("button", { name: "Serving: 5 out of 5" }));
  fireEvent.change(screen.getByLabelText("Serving comment (optional)"), {
    target: { value: "Accurate serves" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  const submission = fetcher.mock.calls
    .map((call) => JSON.parse(call[1].body))
    .find((call) => call.query.includes("mutation GuestFeedback"));
  expect(submission.variables.input).toMatchObject({
    guestName: "Guest player",
    token: "signed-invite",
    sportId: "invited-sport",
    ratings: [
      { skillId: "defense", rating: 4 },
      { skillId: "serving", rating: 5, comment: "Accurate serves" },
    ],
  });
});
it("disables submission when no active categories are configured", async () => {
  setup([]);
  await screen.findByRole("heading", { name: "No categories available" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Submit feedback" }),
    ).toBeDisabled(),
  );
});

it("shows the linked match, teams and score without editable match controls", async () => {
  const fetcher = setup(skills, {
    id: "linked-match",
    playedAt: "2026-11-11T18:00:00Z",
    teams: [
      { teamNumber: 1, score: 21, players: ["Alex", "Guest Sam"] },
      { teamNumber: 2, score: 18, players: ["Blair", "Taylor"] },
    ],
    unassignedPlayers: [],
  });
  await screen.findByRole("region", { name: "Invited match" });
  expect(screen.getByText("Guest Sam")).toBeVisible();
  expect(screen.getByText("21 points")).toBeVisible();
  expect(screen.getByText("18 points")).toBeVisible();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Guest" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Serving: 4 out of 5" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  const call = fetcher.mock.calls
    .map((call) => JSON.parse(call[1].body))
    .find((call) => call.query.includes("mutation GuestFeedback"));
  expect(call.variables.input.matchId).toBe("linked-match");
});
it("shows general feedback as read-only for an invitation without a match", async () => {
  setup();
  await screen.findByRole("heading", { name: "General feedback" });
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});
