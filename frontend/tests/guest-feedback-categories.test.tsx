import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackSubmissionForm } from "../src/components/feedback-form";
const session = vi.hoisted(() => ({
  data: undefined as { me: { id: string; username: string } } | undefined,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/f/test-token",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/lib/hooks", () => ({
  useUser: () => ({ isPending: false, data: session.data, error: null }),
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
  guestOnly = false,
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
                  recipientUsername: "TestPlayer",
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
    ["feedback-categories", "invited-sport", "player", "signed-invite"],
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
        guestOnly={guestOnly}
      />
    </QueryClientProvider>,
  );
  return fetcher;
}
afterEach(() => {
  session.data = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("refreshes stale categories and renders every backend skill with descriptions for guests", async () => {
  const fetcher = setup([
    ...skills,
    { ...skills[0], id: "retired", name: "Retired category", active: false },
  ]);
  await screen.findByRole("group", { name: "Defense" });
  expect(screen.getByText("TestPlayer", { exact: true })).toBeVisible();
  expect(
    screen.queryByText("Player player", { exact: true }),
  ).not.toBeInTheDocument();
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

it("uses guest names on a signed-in player's device and clears the form between reviewers", async () => {
  session.data = { me: { id: "player", username: "AccountOwner" } };
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const fetcher = setup(skills, null, true);
  await screen.findByRole("group", { name: "Serving" });
  expect(
    screen.queryByRole("link", { name: "Log in" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Sign up" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("AccountOwner")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "First reviewer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Serving: 4 out of 5" }));
  fireEvent.change(screen.getByLabelText("Serving comment (optional)"), {
    target: { value: "Good serve" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  fireEvent.click(screen.getByRole("button", { name: "Next reviewer" }));
  expect(screen.getByLabelText("Your name")).toHaveValue("");
  expect(screen.getByLabelText("Serving comment (optional)")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Serving: 4 out of 5" }),
  ).toHaveAttribute("aria-pressed", "false");
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Second reviewer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Setting: 5 out of 5" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  const submissions = fetcher.mock.calls
    .map((call) => JSON.parse(call[1].body))
    .filter((call) => call.query.includes("mutation GuestFeedback"));
  expect(submissions.map((call) => call.variables.input.guestName)).toEqual([
    "First reviewer",
    "Second reviewer",
  ]);
  expect(submissions[1].variables.input.ratings).toEqual([
    { skillId: "setting", rating: 5 },
  ]);
  expect(session.data.me.username).toBe("AccountOwner");
});
