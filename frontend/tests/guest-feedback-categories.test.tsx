import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackSubmissionForm } from "../src/components/feedback-form";
import { FEEDBACK_CATEGORIES } from "../src/lib/feedback-steps";
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
    throw new Error("Must fetch invitation skills");
  },
}));
const skills = [
  "Serving",
  "Attack",
  "Passing",
  "Defense",
  "Setting",
  "Communication",
].map((name) => ({
  id: `backend-${name.toLowerCase()}`,
  name,
  slug: name.toLowerCase(),
  sportId: "sport",
  active: true,
  requiredForSelfAssessment: false,
  description: `${name} from the backend.`,
}));
function setup({
  categories = skills,
  match = null,
  guestOnly = false,
  assigned = false,
  fail = false,
}: {
  categories?: typeof skills;
  match?: {
    id: string;
    playedAt: string;
    teams: { teamNumber: number; score: number; players: string[] }[];
    unassignedPlayers: string[];
  } | null;
  guestOnly?: boolean;
  assigned?: boolean;
  fail?: boolean;
} = {}) {
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
                  assignedReviewer: assigned
                    ? { id: "assigned", username: "AssignedPlayer" }
                    : null,
                  approvalRequired: assigned,
                  sport: {
                    id: "sport",
                    name: "Beach Volleyball",
                    slug: "beach-volleyball",
                    skills: categories,
                  },
                  match,
                },
              },
            }
          : fail
            ? { errors: [{ message: "Please retry your submission" }] }
            : { data: { submitGuestFeedback: { id: "saved" } } },
    };
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(
    ["feedback-categories", "sport", "player", "signed-invite"],
    {
      sport: {
        id: "sport",
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
        sportId="sport"
        token="signed-invite"
        guestOnly={guestOnly}
      />
    </QueryClientProvider>,
  );
  return fetcher;
}
function next() {
  fireEvent.click(
    screen.getByRole("button", { name: /^(Next|Review Feedback)$/ }),
  );
}
function review(from = 0) {
  for (let i = from; i < 5; i++) next();
}
function name(value = "Guest player") {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value } });
}
function rating(category: string, value: number) {
  fireEvent.click(
    screen.getByRole("radio", { name: `${category}: ${value} out of 5` }),
  );
}
function calls(fetcher: ReturnType<typeof setup>) {
  return fetcher.mock.calls
    .map((c) => JSON.parse(c[1].body))
    .filter((c) => c.query.includes("mutation"));
}
async function ready() {
  await screen.findByText("@TestPlayer");
  await screen.findByRole("radiogroup", { name: "Attacking rating" });
}
afterEach(() => {
  session.data = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("loads backend definitions and shows exactly five cards in order with the correct art and descriptions", async () => {
  const fetcher = setup({
    categories: [
      ...skills,
      { ...skills[0], id: "retired", name: "Retired", active: false },
    ],
  });
  await ready();
  expect(screen.getByText("@TestPlayer")).toBeVisible();
  for (let i = 0; i < 5; i++) {
    const meta = FEEDBACK_CATEGORIES[i];
    expect(screen.getAllByRole("article")).toHaveLength(1);
    const card = screen.getByRole("article", {
      name: `${meta.title} feedback card`,
    });
    expect(card.querySelector("img")?.getAttribute("src")).toContain(
      `feedback_bg_${meta.title.toLowerCase()}`,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      String(i + 1),
    );
    expect(
      screen.getByRole("radiogroup", { name: `${meta.title} rating` }),
    ).toHaveAccessibleDescription(
      expect.stringContaining(
        `${meta.title === "Attacking" ? "Attack" : meta.title} from the backend.`,
      ),
    );
    expect(screen.getByLabelText("Add a comment (optional)")).toHaveAttribute(
      "maxLength",
      "5000",
    );
    next();
  }
  expect(
    screen.getByRole("heading", { name: "Review feedback" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Communication" }),
  ).not.toBeInTheDocument();
  expect(calls(fetcher)).toHaveLength(0);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toEqual({
    token: "signed-invite",
  });
});
it("starts unrated and preserves answers through Previous and editing from review", async () => {
  setup();
  await ready();
  expect(screen.getByText("Not rated yet")).toBeVisible();
  expect(
    screen
      .getAllByRole("radio")
      .every((r) => r.getAttribute("aria-checked") === "false"),
  ).toBe(true);
  rating("Attacking", 4);
  fireEvent.change(screen.getByLabelText("Add a comment (optional)"), {
    target: { value: "Smart shots" },
  });
  next();
  fireEvent.click(screen.getByRole("button", { name: "Previous category" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 4 out of 5" }),
  ).toBeChecked();
  expect(screen.getByLabelText("Add a comment (optional)")).toHaveValue(
    "Smart shots",
  );
  review();
  fireEvent.click(screen.getByRole("button", { name: "Edit Attacking" }));
  rating("Attacking", 2);
  review();
  expect(
    within(
      screen.getByRole("article", { name: "Attacking summary" }),
    ).getByText("2 / 5"),
  ).toBeVisible();
});
it("Skip clears previous rating and comment and omits that skill from submission", async () => {
  const fetcher = setup();
  await ready();
  name();
  rating("Attacking", 5);
  fireEvent.change(screen.getByLabelText("Add a comment (optional)"), {
    target: { value: "Remove this" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous category" }));
  expect(screen.getByLabelText("Add a comment (optional)")).toHaveValue("");
  expect(screen.getByText("Not rated yet")).toBeVisible();
  next();
  rating("Defense", 4);
  next();
  review(2);
  expect(
    within(
      screen.getByRole("article", { name: "Attacking summary" }),
    ).getByText("Skipped"),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)[0].variables.input.ratings).toEqual([
    { skillId: "backend-defense", rating: 4 },
  ]);
});
it("requires a rating for a comment and lets Skip explicitly clear an unrated comment", async () => {
  const fetcher = setup();
  await ready();
  fireEvent.change(screen.getByLabelText("Add a comment (optional)"), {
    target: { value: "An observation" },
  });
  next();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Choose a rating for Attacking",
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  expect(calls(fetcher)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous category" }));
  expect(screen.getByLabelText("Add a comment (optional)")).toHaveValue("");
});
it("submits real skill IDs and separate comments in a single final GraphQL mutation", async () => {
  const fetcher = setup();
  await ready();
  name();
  next();
  rating("Defense", 4);
  fireEvent.change(screen.getByLabelText("Add a comment (optional)"), {
    target: { value: "Good coverage" },
  });
  next();
  next();
  next();
  rating("Serving", 5);
  fireEvent.change(screen.getByLabelText("Add a comment (optional)"), {
    target: { value: "Accurate serves" },
  });
  next();
  expect(calls(fetcher)).toHaveLength(0);
  expect(screen.getByText("Good coverage")).toBeVisible();
  expect(screen.getByText("Accurate serves")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Written feedback (optional)"), {
    target: { value: "Great game" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)[0].variables.input).toMatchObject({
    guestName: "Guest player",
    token: "signed-invite",
    sportId: "sport",
    overallComment: "Great game",
    ratings: [
      { skillId: "backend-defense", rating: 4, comment: "Good coverage" },
      { skillId: "backend-serving", rating: 5, comment: "Accurate serves" },
    ],
  });
});
it("allows reviewing five skips but requires at least one rating to submit", async () => {
  const fetcher = setup();
  await ready();
  name();
  for (let i = 0; i < 5; i++)
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(
    screen.getByRole("button", { name: "Submit Feedback" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Rate at least one category before submitting feedback."),
  ).toBeVisible();
  expect(calls(fetcher)).toHaveLength(0);
});
it("shows unavailable skills without inventing IDs", async () => {
  setup({ categories: [] });
  await screen.findByRole("heading", { name: "No categories available" });
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Submit Feedback" }),
  ).not.toBeInTheDocument();
});
it("keeps invitation match context read-only and submits its server-provided ID", async () => {
  const fetcher = setup({
    match: {
      id: "linked-match",
      playedAt: "2026-11-11T18:00:00Z",
      teams: [
        { teamNumber: 1, score: 21, players: ["Alex", "Guest Sam"] },
        { teamNumber: 2, score: 18, players: ["Blair"] },
      ],
      unassignedPlayers: [],
    },
  });
  await ready();
  fireEvent.click(screen.getByText(/View teams/));
  expect(screen.getByText("Guest Sam")).toBeVisible();
  expect(screen.getByText("21 points")).toBeVisible();
  expect(
    screen.queryByRole("radio", { name: /No match/ }),
  ).not.toBeInTheDocument();
  name();
  rating("Attacking", 3);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)[0].variables.input.matchId).toBe("linked-match");
});
it("does not label a guest as the authenticated assigned reviewer", async () => {
  setup({ assigned: true });
  await ready();
  expect(screen.getByText("Submitted by")).toBeVisible();
  expect(screen.queryByText("Registered player")).not.toBeInTheDocument();
  expect(screen.getByText("@AssignedPlayer")).toBeVisible();
  name("Taylor");
  expect(screen.getByText("Taylor", { exact: true })).toBeVisible();
  expect(screen.getByText(/does not confirm/)).toBeVisible();
});
it("shows signed-in identity and preserves assigned Pending approval submission", async () => {
  session.data = { me: { id: "reviewer", username: "SignedInPlayer" } };
  const fetcher = setup({ assigned: true });
  await ready();
  expect(screen.getByText("@SignedInPlayer")).toBeVisible();
  expect(screen.getByText("Registered player")).toBeVisible();
  rating("Attacking", 4);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByText(/Your draft is awaiting AssignedPlayer/);
  expect(calls(fetcher)[0].query).toContain("submitGuestFeedback");
  expect(calls(fetcher)[0].variables.input).toMatchObject({
    guestName: "SignedInPlayer",
    token: "signed-invite",
  });
  expect(calls(fetcher)[0].variables.input).not.toHaveProperty("reviewerId");
});
it("retains answers on errors and prevents duplicate submissions", async () => {
  const fetcher = setup({ fail: true });
  await ready();
  name();
  rating("Attacking", 4);
  review();
  const submit = screen.getByRole("button", { name: "Submit Feedback" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await screen.findByRole("alert");
  expect(calls(fetcher)).toHaveLength(1);
  expect(screen.getByText("4 / 5")).toBeVisible();
  expect(screen.getByLabelText("Your name")).toHaveValue("Guest player");
});
it("resets all five cards between reviewers without using the signed-in device account", async () => {
  session.data = { me: { id: "player", username: "AccountOwner" } };
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const fetcher = setup({ guestOnly: true });
  await ready();
  expect(screen.queryByText("Registered player")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Log in" }),
  ).not.toBeInTheDocument();
  name("First reviewer");
  rating("Attacking", 4);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  fireEvent.click(screen.getByRole("button", { name: "Next reviewer" }));
  expect(screen.getByLabelText("Your name")).toHaveValue("");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  expect(screen.getByText("Not rated yet")).toBeVisible();
  name("Second reviewer");
  next();
  next();
  next();
  rating("Setting", 5);
  review(3);
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher).map((c) => c.variables.input.guestName)).toEqual([
    "First reviewer",
    "Second reviewer",
  ]);
  expect(calls(fetcher)[1].variables.input.ratings).toEqual([
    { skillId: "backend-setting", rating: 5 },
  ]);
  expect(session.data.me.username).toBe("AccountOwner");
});

it("submits guest feedback without a name and leaves guest identity to the backend default", async () => {
  const fetcher = setup();
  await ready();
  expect(screen.getByLabelText("Your name")).not.toBeRequired();
  rating("Attacking", 4);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)).toHaveLength(1);
  expect(calls(fetcher)[0].variables.input).not.toHaveProperty("guestName");
});
