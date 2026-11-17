import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackSubmissionForm } from "../src/components/feedback-form";
import { FEEDBACK_CATEGORIES } from "../src/lib/feedback-steps";
const navigation = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
const session = vi.hoisted(() => ({
  data: undefined as { me: { id: string; username: string } } | undefined,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => "/f/test-token",
  useSearchParams: () => new URLSearchParams(navigation.search),
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
  requestMatches = [],
  reviewMode = "INDIVIDUAL_MATCHES",
  match = null,
  guestOnly = false,
  assigned = false,
  fail = false,
  handoffFail = false,
}: {
  categories?: typeof skills;
  requestMatches?: {
    id: string;
    playedAt: string;
    teams: { teamNumber: number; score: number; players: string[] }[];
    unassignedPlayers: string[];
  }[];
  reviewMode?: "INDIVIDUAL_MATCHES" | "COMBINED_MATCHES";
  match?: {
    id: string;
    playedAt: string;
    teams: { teamNumber: number; score: number; players: string[] }[];
    unassignedPlayers: string[];
  } | null;
  guestOnly?: boolean;
  assigned?: boolean;
  fail?: boolean;
  handoffFail?: boolean;
} = {}) {
  const fetcher = vi.fn(async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () =>
        query.includes("StartGuestReviewSession")
          ? handoffFail
            ? { errors: [{ message: "Cannot start another review" }] }
            : {
                data: {
                  startGuestReviewSession: {
                    token: "guest-followup",
                    expiresAt: "2026-11-17T12:00:00Z",
                  },
                },
              }
          : query.includes("FeedbackReviewers")
            ? {
                data: {
                  feedbackReviewers: [
                    { id: "selected-reviewer", username: "ChosenPlayer" },
                  ],
                },
              }
            : query.includes("FeedbackInvitation")
              ? {
                  data: {
                    feedbackInvitation: {
                      recipientId: "player",
                      recipientUsername: "TestPlayer",
                      guestSession: variables.token === "guest-followup",
                      assignedReviewer:
                        assigned && variables.token !== "guest-followup"
                          ? { id: "assigned", username: "AssignedPlayer" }
                          : null,
                      approvalRequired:
                        assigned && variables.token !== "guest-followup",
                      matches: requestMatches,
                      reviewMode,
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
    screen.getByRole("button", { name: /^(Next|Next match|Review Feedback)$/ }),
  );
}
function review(from = 0) {
  for (let i = from; i < 5; i++) next();
}
function name(value = "Guest player") {
  fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value } });
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
async function ready(cards = true) {
  await screen.findByText("@TestPlayer");
  await screen.findByRole("radiogroup", { name: "Attacking rating" });
  if (cards)
    fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
}
afterEach(() => {
  session.data = undefined;
  navigation.search = "";
  navigation.push.mockReset();
  window.history.replaceState(null, "", "/");
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
  const consent=screen.getByRole("checkbox",{name:/Allow private performance analytics/});
  expect(consent).not.toBeChecked();
  expect(screen.getByRole("link",{name:/Privacy notice and withdrawal/})).toHaveAttribute("href","/privacy");
  fireEvent.click(consent);
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
  expect(screen.getByText("Feedback giver")).toBeVisible();
  expect(screen.queryByText("Registered player")).not.toBeInTheDocument();
  expect(screen.getByText("@AssignedPlayer")).toBeVisible();
  expect(screen.queryByLabelText(/Guest name/)).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "@AssignedPlayer must sign in and approve this feedback before it is published.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Guest" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Remove" }),
  ).not.toBeInTheDocument();
});
it("shows signed-in identity and preserves assigned Pending approval submission", async () => {
  session.data = { me: { id: "reviewer", username: "SignedInPlayer" } };
  const fetcher = setup({ assigned: true });
  await ready();
  expect(
    screen.getByText("Draft entered by @SignedInPlayer · signed in"),
  ).toBeVisible();
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
  expect(screen.getByLabelText(/Guest name/)).toHaveValue("Guest player");
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
  expect(screen.getByLabelText(/Guest name/)).toHaveValue("");
  expect(screen.getAllByRole("radiogroup")).toHaveLength(5);
  expect(screen.getAllByText("Not rated yet")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
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
  expect(screen.getByLabelText(/Guest name/)).not.toBeRequired();
  rating("Attacking", 4);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)).toHaveLength(1);
  expect(calls(fetcher)[0].variables.input).not.toHaveProperty("guestName");
});

it("selects a registered approver inside a guest feedback form and submits a Pending assignment request", async () => {
  const fetcher = setup();
  await ready();
  name("Old guest name");
  fireEvent.click(screen.getByRole("button", { name: "Registered User" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Feedback giver" }), {
    target: { value: "Chosen" },
  });
  fireEvent.click(await screen.findByRole("option", { name: /ChosenPlayer/ }));
  expect(screen.getByText("@ChosenPlayer")).toBeVisible();
  expect(screen.queryByLabelText(/Guest name/)).not.toBeInTheDocument();
  expect(
    screen.queryByText("Guest reviewer", { exact: true }),
  ).not.toBeInTheDocument();
  rating("Attacking", 4);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByText(/Your draft is awaiting ChosenPlayer/);
  const submission = calls(fetcher)[0];
  expect(submission.query).toContain("submitGuestFeedback");
  expect(submission.variables.input).not.toHaveProperty("guestName");
  expect(submission.variables.input).toMatchObject({
    assignedReviewerId: "selected-reviewer",
    token: "signed-invite",
  });
  expect(submission.variables.input).not.toHaveProperty("reviewerId");
});
it("does not allow changing an invitation's existing reviewer", async () => {
  setup({ assigned: true });
  await ready();
  expect(
    screen.queryByLabelText(/Assign feedback giver/),
  ).not.toBeInTheDocument();
  expect(screen.getByText("@AssignedPlayer")).toBeVisible();
});

it("defaults to all five quick ratings, keeps descriptions collapsed, and preserves answers across modes", async () => {
  setup();
  await ready(false);
  expect(screen.getAllByRole("radiogroup")).toHaveLength(5);
  expect(
    screen.queryByRole("article", { name: "Attacking feedback card" }),
  ).not.toBeInTheDocument();
  const description = screen.getByText("Attack from the backend.");
  expect(description).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Attacking" }));
  expect(description).toBeVisible();
  rating("Attacking", 4);
  fireEvent.change(screen.getByLabelText(/Attacking comment/), {
    target: { value: "Good placement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 4 out of 5" }),
  ).toBeChecked();
  expect(screen.getByLabelText(/Add a comment/)).toHaveValue("Good placement");
  fireEvent.click(screen.getByRole("button", { name: "Quick Review" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 4 out of 5" }),
  ).toBeChecked();
});
it("reviews quick feedback before submitting without traversing the cards", async () => {
  const fetcher = setup();
  await ready(false);
  rating("Passing", 5);
  expect(calls(fetcher)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  expect(
    screen.getByRole("article", { name: "Passing summary" }),
  ).toHaveTextContent("5 / 5");
  expect(screen.getAllByText("Skipped")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)[0].variables.input.ratings).toEqual([
    { skillId: "backend-passing", rating: 5 },
  ]);
});

it("restores the guest option when a selected assignment is removed", async () => {
  setup();
  await ready(false);
  name("Guest again");
  fireEvent.click(screen.getByRole("button", { name: "Registered User" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Feedback giver" }), {
    target: { value: "Chosen" },
  });
  fireEvent.click(await screen.findByRole("option", { name: /ChosenPlayer/ }));
  expect(screen.queryByLabelText(/Guest name/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(
    screen.getByRole("combobox", { name: "Feedback giver" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Guest" }));
  expect(screen.getByLabelText(/Guest name/)).toHaveValue("Guest again");
  expect(screen.getByRole("button", { name: "Guest" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

const requestedMatches = ["first-match", "second-match"].map((id) => ({
  id,
  playedAt: "2026-11-12T12:00:00Z",
  teams: [
    { teamNumber: 1, score: 21, players: ["TestPlayer"] },
    { teamNumber: 2, score: 15, players: ["Opponent"] },
  ],
  unassignedPlayers: [],
}));
it("reviews individual matches in saved order, retains separate answers and submits the entire request once", async () => {
  const fetcher = setup({ requestMatches: requestedMatches, guestOnly: true });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Registered User" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Feedback giver" }), {
    target: { value: "Chosen" },
  });
  fireEvent.click(await screen.findByRole("option", { name: /ChosenPlayer/ }));
  expect(
    screen.getByRole("heading", { name: "Reviewing Match 1 of 2" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Quick Review" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  rating("Attacking", 4);
  fireEvent.change(screen.getByLabelText(/Written feedback for this match/), {
    target: { value: "First match note" },
  });
  review();
  expect(
    screen.getByRole("heading", { name: "Reviewing Match 2 of 2" }),
  ).toBeVisible();
  expect(
    screen.getByRole("radio", { name: "Attacking: 4 out of 5" }),
  ).not.toBeChecked();
  rating("Attacking", 2);
  fireEvent.click(screen.getByRole("button", { name: "Match 1" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 4 out of 5" }),
  ).toBeChecked();
  expect(screen.getByLabelText(/Written feedback for this match/)).toHaveValue(
    "First match note",
  );
  fireEvent.click(screen.getByRole("button", { name: "Match 2" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 2 out of 5" }),
  ).toBeChecked();
  review();
  expect(calls(fetcher)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)).toHaveLength(1);
  expect(calls(fetcher)[0].query).toContain("submitFeedbackRequest");
  expect(calls(fetcher)[0].variables.input).toMatchObject({
    asGuest: true,
    assignedReviewerId: "selected-reviewer",
  });
  expect(screen.getByText(/2 match reviews submitted/)).toBeVisible();
  expect(
    screen.getByText(/Each match is waiting in ChosenPlayer/),
  ).toBeVisible();
  expect(calls(fetcher)[0].variables.input.reviews).toMatchObject([
    {
      matchId: "first-match",
      ratings: [{ skillId: "backend-attack", rating: 4 }],
      overallComment: "First match note",
    },
    {
      matchId: "second-match",
      ratings: [{ skillId: "backend-attack", rating: 2 }],
    },
  ]);
  expect(calls(fetcher)[0].variables.input.submissionId).toMatch(
    /^[0-9a-f-]{36}$/,
  );
});
it("uses only five category cards for a combined request and sends one logical review", async () => {
  const fetcher = setup({
    requestMatches: requestedMatches,
    reviewMode: "COMBINED_MATCHES",
  });
  await ready();
  expect(
    screen.getByRole("heading", { name: "Reviewing 2 matches together" }),
  ).toBeVisible();
  rating("Attacking", 5);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)[0].variables.input.reviews).toMatchObject([
    { matchId: null, ratings: [{ skillId: "backend-attack", rating: 5 }] },
  ]);
  expect(calls(fetcher)[0].variables.input.reviews).toHaveLength(1);
});

it("keeps one request submission ID across failed attempts and edits", async () => {
  const fetcher = setup({
    requestMatches: requestedMatches,
    reviewMode: "COMBINED_MATCHES",
    fail: true,
  });
  await ready();
  rating("Attacking", 4);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByText("Please retry your submission");
  const firstId = calls(fetcher)[0].variables.input.submissionId;
  fireEvent.change(screen.getByLabelText(/Written feedback/), {
    target: { value: "Edited after the failed attempt" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await vi.waitFor(() => expect(calls(fetcher)).toHaveLength(2));
  expect(calls(fetcher)[1].variables.input.submissionId).toBe(firstId);
});

it("keeps multiple comments expanded independently, preserves collapsed comments and shares card edits", async () => {
  const fetcher = setup();
  await ready(false);
  expect(screen.getByRole("button", { name: "Quick Review" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen
      .getAllByRole("radio")
      .every((r) => r.getAttribute("aria-checked") === "false"),
  ).toBe(true);
  rating("Attacking", 5);
  rating("Defense", 3);
  fireEvent.click(screen.getByRole("button", { name: "Defense" }));
  fireEvent.change(screen.getByLabelText(/Defense comment/), {
    target: { value: "Strong coverage" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Attacking" }));
  expect(screen.getByLabelText(/Defense comment/)).toBeVisible();
  expect(screen.getByLabelText(/Attacking comment/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: /Defense/, expanded: true }),
  );
  expect(screen.getByLabelText(/Defense comment/)).not.toBeVisible();
  expect(screen.getByLabelText(/Defense comment/)).toHaveValue(
    "Strong coverage",
  );
  expect(
    screen.getByRole("radio", { name: "Defense: 3 out of 5" }),
  ).toBeChecked();
  expect(screen.getByLabelText("Comment added")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
  next();
  expect(screen.getByLabelText(/Add a comment/)).toHaveValue("Strong coverage");
  rating("Defense", 4);
  fireEvent.click(screen.getByRole("button", { name: "Quick Review" }));
  expect(
    screen.getByRole("radio", { name: "Defense: 4 out of 5" }),
  ).toBeChecked();
  expect(
    screen.getByRole("radio", { name: "Attacking: 5 out of 5" }),
  ).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  expect(
    screen.getByRole("article", { name: "Defense summary" }),
  ).toHaveTextContent("Strong coverage");
  expect(calls(fetcher)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getAllByRole("radiogroup")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)).toHaveLength(1);
  expect(calls(fetcher)[0].variables.input.ratings).toEqual([
    { skillId: "backend-attack", rating: 5 },
    { skillId: "backend-defense", rating: 4, comment: "Strong coverage" },
  ]);
});

it("defaults multi-match requests to quick review and isolates answers through mode and match changes", async () => {
  const fetcher = setup({
    requestMatches: requestedMatches,
    guestOnly: true,
    assigned: true,
  });
  await ready(false);
  expect(screen.getAllByRole("radiogroup")).toHaveLength(5);
  rating("Attacking", 5);
  fireEvent.click(screen.getByRole("button", { name: "Defense" }));
  rating("Defense", 3);
  fireEvent.change(screen.getByLabelText(/Defense comment/), {
    target: { value: "Match one defense" },
  });
  fireEvent.change(screen.getByLabelText(/Written feedback for this match/), {
    target: { value: "First note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next match" }));
  expect(
    screen.getByRole("heading", { name: "Reviewing Match 2 of 2" }),
  ).toBeVisible();
  expect(
    screen.getByRole("radio", { name: "Attacking: 5 out of 5" }),
  ).not.toBeChecked();
  rating("Attacking", 2);
  fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
  rating("Attacking", 4);
  fireEvent.click(screen.getByRole("button", { name: "Match 1" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 5 out of 5" }),
  ).toBeChecked();
  next();
  expect(screen.getByLabelText(/Add a comment/)).toHaveValue(
    "Match one defense",
  );
  fireEvent.click(screen.getByRole("button", { name: "Quick Review" }));
  fireEvent.click(screen.getByRole("button", { name: "Match 2" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 4 out of 5" }),
  ).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  expect(screen.getByText("First note")).toBeVisible();
  expect(screen.getAllByRole("article")).toHaveLength(10);
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  const input = calls(fetcher)[0].variables.input;
  expect(input).toMatchObject({ asGuest: true });
  expect(input.reviews).toMatchObject([
    {
      matchId: "first-match",
      overallComment: "First note",
      ratings: [
        { skillId: "backend-attack", rating: 5 },
        { skillId: "backend-defense", rating: 3, comment: "Match one defense" },
      ],
    },
    {
      matchId: "second-match",
      ratings: [{ skillId: "backend-attack", rating: 4 }],
    },
  ]);
  expect(calls(fetcher)).toHaveLength(1);
});

it("keeps one combined assessment when switching modes and submits it with all match context", async () => {
  const fetcher = setup({
    requestMatches: requestedMatches,
    reviewMode: "COMBINED_MATCHES",
  });
  await ready(false);
  expect(screen.getAllByRole("radiogroup")).toHaveLength(5);
  rating("Attacking", 3);
  fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 3 out of 5" }),
  ).toBeChecked();
  rating("Attacking", 4);
  fireEvent.click(screen.getByRole("button", { name: "Quick Review" }));
  rating("Serving", 5);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  expect(
    screen.getByRole("heading", { name: "Reviewing 2 matches together" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)).toHaveLength(1);
  expect(calls(fetcher)[0].variables.input.reviews).toEqual([
    expect.objectContaining({
      matchId: null,
      ratings: [
        { skillId: "backend-attack", rating: 4 },
        { skillId: "backend-serving", rating: 5 },
      ],
    }),
  ]);
});

it("uses one compact details panel and preserves guest names, ratings and comments across giver types", async () => {
  setup();
  await ready(false);
  const info = screen.getByRole("complementary", {
    name: "Feedback user information",
  });
  expect(info.children).toHaveLength(1);
  expect(
    within(info).getByRole("region", { name: "Feedback Details" }),
  ).toBeVisible();
  expect(within(info).getByText("@TestPlayer")).toBeVisible();
  expect(screen.getByPlaceholderText("Enter your name")).toBeVisible();
  name("Unverified name");
  rating("Defense", 4);
  fireEvent.click(screen.getByRole("button", { name: "Defense" }));
  fireEvent.change(screen.getByLabelText(/Defense comment/), {
    target: { value: "Keep this comment" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Registered User" }));
  expect(screen.queryByLabelText(/Guest name/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("combobox", { name: "Feedback giver" }),
  ).toHaveAttribute("placeholder", "Search username...");
  fireEvent.change(screen.getByRole("combobox", { name: "Feedback giver" }), {
    target: { value: "Chosen" },
  });
  fireEvent.click(await screen.findByRole("option", { name: /ChosenPlayer/ }));
  expect(
    screen.getAllByText(
      "@ChosenPlayer must sign in and approve this feedback before it is published.",
    ),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Guest" }));
  expect(screen.getByLabelText(/Guest name/)).toHaveValue("Unverified name");
  expect(
    screen.getByRole("radio", { name: "Defense: 4 out of 5" }),
  ).toBeChecked();
  expect(screen.getByLabelText(/Defense comment/)).toHaveValue(
    "Keep this comment",
  );
  fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
  next();
  expect(screen.getByLabelText(/Add a comment/)).toHaveValue(
    "Keep this comment",
  );
});

it("does not submit typed usernames until a backend search result has been selected", async () => {
  const fetcher = setup();
  await ready(false);
  fireEvent.click(screen.getByRole("button", { name: "Registered User" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Feedback giver" }), {
    target: { value: "UnselectedUser" },
  });
  rating("Attacking", 5);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  expect(
    screen.getByRole("button", { name: "Submit Feedback" }),
  ).toBeDisabled();
  fireEvent.submit(
    screen.getByRole("button", { name: "Submit Feedback" }).closest("form")!,
  );
  await screen.findByText(
    "Select a registered feedback giver, or choose Guest.",
  );
  expect(calls(fetcher)).toHaveLength(0);
});

it("supports keyboard selection and Escape in registered giver search and submits the selected ID", async () => {
  const fetcher = setup();
  await ready(false);
  fireEvent.click(screen.getByRole("button", { name: "Registered User" }));
  const search = screen.getByRole("combobox", { name: "Feedback giver" });
  fireEvent.change(search, { target: { value: "Ch" } });
  await screen.findByRole("option", { name: /ChosenPlayer/ });
  expect(search).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(search, { key: "Escape" });
  expect(search).toHaveAttribute("aria-expanded", "false");
  fireEvent.focus(search);
  fireEvent.keyDown(search, { key: "ArrowDown" });
  const option = screen.getByRole("option", { name: /ChosenPlayer/ });
  expect(option).toHaveAttribute("aria-selected", "true");
  expect(search).toHaveAttribute("aria-activedescendant", option.id);
  fireEvent.keyDown(search, { key: "Enter" });
  expect(screen.getByText("@ChosenPlayer")).toBeVisible();
  rating("Serving", 4);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)[0].variables.input).toMatchObject({
    assignedReviewerId: "selected-reviewer",
  });
  expect(calls(fetcher)[0].variables.input).not.toHaveProperty("guestName");
  expect(calls(fetcher)[0].variables.input).not.toHaveProperty("reviewerId");
});

it("retains a locked invitation assignment and never offers guest switching or reassignment", async () => {
  setup({ assigned: true });
  await ready(false);
  expect(
    screen.getByRole("button", { name: "Registered User" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", { name: "Registered User" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Guest" })).toBeDisabled();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("@AssignedPlayer")).toBeVisible();
  expect(screen.queryByText(/signed in/)).not.toBeInTheDocument();
});

it("keeps a verified signed-in submitter separate from a chosen approver", async () => {
  session.data = { me: { id: "preparer", username: "SignedInPreparer" } };
  const fetcher = setup();
  await ready(false);
  expect(screen.getByRole("button", { name: "Guest" })).toBeDisabled();
  expect(screen.getByText("@SignedInPreparer")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Feedback giver" }), {
    target: { value: "Chosen" },
  });
  fireEvent.click(await screen.findByRole("option", { name: /ChosenPlayer/ }));
  expect(
    screen.getByText("Draft entered by @SignedInPreparer · signed in"),
  ).toBeVisible();
  rating("Attacking", 4);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  expect(calls(fetcher)[0].variables.input).toMatchObject({
    assignedReviewerId: "selected-reviewer",
    guestName: "SignedInPreparer",
  });
});

it("protects Back and the logo with one dialog, keeps answers and navigates only after confirming", async () => {
  window.history.replaceState(null, "", "/f/test-token");
  setup();
  await ready(false);
  rating("Defense", 4);
  const back = screen.getByRole("link", { name: "Back from feedback" });
  const home = screen.getByRole("link", { name: "BVBTips home" });
  expect(back).toHaveAttribute("href", "/");
  expect(home).toHaveAttribute("href", "/");
  fireEvent.click(back);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen.getByRole("heading", { name: "Leave feedback?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("radio", { name: "Defense: 4 out of 5" }),
  ).toBeChecked();
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.click(home);
  fireEvent.click(screen.getByRole("button", { name: "Leave without saving" }));
  expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/");
});

it("guards meaningful comments and guest names with beforeunload but ignores clean mode changes", async () => {
  setup();
  await ready(false);
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(unload()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
  fireEvent.click(screen.getByRole("button", { name: "Quick Review" }));
  expect(unload()).toBe(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  name("Just a name");
  expect(unload()).toBe(true);
  name("   ");
  expect(unload()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Defense" }));
  fireEvent.change(screen.getByLabelText(/Defense comment/), {
    target: { value: "Comment only" },
  });
  expect(unload()).toBe(true);
});

it("drops exit warnings after a successful submission and gives guests a public return action", async () => {
  setup();
  await ready(false);
  rating("Passing", 4);
  let event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(
    screen.getByRole("link", { name: "Return to BVBTips" }),
  ).toHaveAttribute("href", "/");
});

it("uses trusted return context for an authenticated reviewer and never changes drafts for match navigation", async () => {
  session.data = { me: { id: "reviewer", username: "Reviewer" } };
  navigation.search = "returnTo=%2Ffeedback%3Fkind%3Dmatch";
  setup({ requestMatches: requestedMatches });
  await ready(false);
  expect(
    screen.getByRole("link", { name: "Back from feedback" }),
  ).toHaveAttribute("href", "/feedback?kind=match");
  expect(screen.getByRole("link", { name: "BVBTips home" })).toHaveAttribute(
    "href",
    "/matches",
  );
  rating("Attacking", 4);
  fireEvent.click(screen.getByRole("button", { name: "Match 2" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Match 1" }));
  expect(
    screen.getByRole("radio", { name: "Attacking: 4 out of 5" }),
  ).toBeChecked();
});

it.each(["INDIVIDUAL_MATCHES", "COMBINED_MATCHES"] as const)(
  "starts an independently identified guest review after a successful %s batch and clears every match",
  async (reviewMode) => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    session.data = {
      me: { id: "signed-in-preparer", username: "SignedInPreparer" },
    };
    const requestMatches = [
      ...requestedMatches,
      { ...requestedMatches[0], id: "third-match" },
    ];
    const fetcher = setup({ requestMatches, reviewMode, assigned: true });
    await ready(false);
    const individual = reviewMode === "INDIVIDUAL_MATCHES";
    for (let index = 0; index < (individual ? 3 : 1); index++) {
      rating("Attacking", index + 2);
      fireEvent.click(screen.getByRole("button", { name: "Attacking" }));
      fireEvent.change(screen.getByLabelText(/Attacking comment/), {
        target: { value: `Old comment ${index}` },
      });
      if (individual)
        fireEvent.change(
          screen.getByLabelText(/Written feedback for this match/),
          { target: { value: `Old match note ${index}` } },
        );
      fireEvent.click(
        screen.getByRole("button", {
          name: individual && index < 2 ? "Next match" : "Review & Submit",
        }),
      );
      if (index < (individual ? 2 : 0))
        expect(
          screen.queryByRole("button", { name: "Leave Another Review" }),
        ).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
    await screen.findByRole("heading", { name: "Thanks for your feedback." });
    const original = calls(fetcher)[0].variables.input;
    expect(original.reviews).toHaveLength(individual ? 3 : 1);
    expect(original.asGuest).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Leave Another Review" }),
    );
    await screen.findByText("New guest review · Your own independent feedback");
    expect(screen.getByRole("button", { name: "Guest" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Registered User" }),
    ).toBeDisabled();
    expect(screen.queryByText("@AssignedPlayer")).not.toBeInTheDocument();
    expect(screen.queryByText(/Draft entered by/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Guest name/)).toHaveValue("");
    expect(screen.getAllByText("Not rated yet")).toHaveLength(5);
    expect(screen.getByLabelText(/Attacking comment/)).toHaveValue("");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    name("Independent guest");
    for (let index = 0; index < (individual ? 3 : 1); index++) {
      if (individual) {
        expect(
          screen.getByRole("heading", {
            name: `Reviewing Match ${index + 1} of 3`,
          }),
        ).toBeVisible();
        expect(
          screen.getByLabelText(/Written feedback for this match/),
        ).toHaveValue("");
      }
      expect(
        screen.getByRole("radio", { name: "Attacking: 2 out of 5" }),
      ).not.toBeChecked();
      rating("Serving", 5);
      fireEvent.click(
        screen.getByRole("button", {
          name: individual && index < 2 ? "Next match" : "Review & Submit",
        }),
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
    await screen.findByRole("heading", { name: "Thanks for your feedback." });
    const submissionCalls = calls(fetcher).filter((c) =>
      c.query.includes("SubmitFeedbackRequest"),
    );
    expect(submissionCalls).toHaveLength(2);
    const guest = submissionCalls[1].variables.input;
    expect(guest).toMatchObject({
      token: "guest-followup",
      asGuest: true,
      guestName: "Independent guest",
    });
    expect(guest).not.toHaveProperty("assignedReviewerId");
    expect(guest.submissionId).not.toBe(original.submissionId);
    expect(
      guest.reviews.every(
        (r: { ratings: unknown[] }) => r.ratings.length === 1,
      ),
    ).toBe(true);
    expect(guest.reviews[0].ratings).toEqual([
      { skillId: "backend-serving", rating: 5 },
    ]);
  },
);

it("keeps Card Review selected while resetting to the first skill of a fresh guest session", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  setup({
    requestMatches: requestedMatches,
    reviewMode: "COMBINED_MATCHES",
    assigned: true,
    guestOnly: true,
  });
  await ready();
  rating("Attacking", 4);
  review();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  fireEvent.click(screen.getByRole("button", { name: "Leave Another Review" }));
  await screen.findByText("New guest review · Your own independent feedback");
  expect(screen.getByRole("button", { name: "Card Review" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("article", { name: "Attacking feedback card" }),
  ).toBeVisible();
  expect(screen.getByText("Not rated yet")).toBeVisible();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
});

it("keeps the completed submission intact when starting another review fails", async () => {
  setup({
    requestMatches: requestedMatches,
    reviewMode: "COMBINED_MATCHES",
    assigned: true,
    handoffFail: true,
  });
  await ready(false);
  rating("Attacking", 4);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  fireEvent.click(screen.getByRole("button", { name: "Leave Another Review" }));
  await screen.findByText("Cannot start another review");
  expect(
    screen.getByRole("heading", { name: "Thanks for your feedback." }),
  ).toBeVisible();
  expect(screen.queryByLabelText(/Guest name/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Leave Another Review" }),
  ).toBeEnabled();
});

it("waits for the guest-session response before resetting the completed review", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const fetcher = setup({
    requestMatches: requestedMatches,
    reviewMode: "COMBINED_MATCHES",
    assigned: true,
  });
  const original = fetcher.getMockImplementation()!;
  let release: (() => void) | undefined;
  fetcher.mockImplementation(async (url, options) => {
    if (JSON.parse(options.body).query.includes("StartGuestReviewSession"))
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return original(url, options);
  });
  await ready(false);
  rating("Passing", 4);
  fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByRole("heading", { name: "Thanks for your feedback." });
  fireEvent.click(screen.getByRole("button", { name: "Leave Another Review" }));
  await screen.findByText("Starting a new review…");
  expect(
    screen.getByRole("heading", { name: "Thanks for your feedback." }),
  ).toBeVisible();
  expect(screen.queryByLabelText(/Guest name/)).not.toBeInTheDocument();
  release!();
  await screen.findByText("New guest review · Your own independent feedback");
  expect(screen.getByLabelText(/Guest name/)).toHaveValue("");
});
