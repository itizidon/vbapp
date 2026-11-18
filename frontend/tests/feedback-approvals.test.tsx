import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApprovalsPage as PendingFeedbackApprovals } from "../src/components/approvals-page";
import type { ApprovalCard } from "../src/lib/approvals";
import { ReviewerPicker } from "../src/components/reviewer-picker";
import { FeedbackSubmissionForm } from "../src/components/feedback-form";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/f/opaque-token",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/lib/hooks", () => ({
  useUser: () => ({
    data: { me: { id: "reviewer", username: "SignedInPreparer" } },
    isPending: false,
  }),
  useMatches: () => ({ data: { rows: [] } }),
  useMatch: () => ({}),
}));
afterEach(() => vi.unstubAllGlobals());
const card = (id: string): ApprovalCard => ({
  id,
  recipientUsername: `Player ${id}`,
  status: "PENDING",
  createdAt: "2026-11-12T12:00:00Z",
  overallComment: "Great placement",
  guestName: "Guest name",
  match: {
    id: "match",
    description: "Beach match",
    playedAt: "2026-11-11T12:00:00Z",
  },
  ratings: [
    {
      skillId: "passing",
      skillName: "Passing",
      rating: 4,
      comment: "Keep using open space",
    },
  ],
});
function mount(ui: React.ReactElement) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
function setupQueue(initial: ApprovalCard[], fail = false) {
  let cards = [...initial];
  const fetcher = vi.fn(async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes("mutation")) {
      if (fail)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            errors: [{ message: "Approval could not be saved" }],
          }),
        };
      cards = cards.filter((c) => c.id !== variables.id);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            [query.includes("approveFeedback")
              ? "approveFeedback"
              : "rejectFeedback"]: {
              id: variables.id,
              status: query.includes("approveFeedback")
                ? "PUBLISHED"
                : "REJECTED",
            },
          },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          myFeedbackApprovals: {
            totalCount: cards.length,
            items: cards,
            nextCursor: null,
          },
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetcher);
  mount(<PendingFeedbackApprovals />);
  return fetcher;
}
function expand(id: string) {
  const article = screen.getByRole("article", {
    name: `Feedback for @Player ${id}`,
  });
  fireEvent.click(article.querySelector("summary")!);
  return within(article);
}
function acknowledge(scope: ReturnType<typeof within>) {
  fireEvent.click(scope.getByRole("checkbox", { name: /I’ve reviewed every/ }));
}
it("shows compact pending cards, then exposes every comment only when expanded", async () => {
  setupQueue([card("one"), card("two")]);
  await screen.findByRole("article", { name: "Feedback for @Player one" });
  expect(
    screen.getByRole("article", { name: "Feedback for @Player two" }),
  ).toBeVisible();
  expect(screen.getByText("2 pending reviews · Newest first")).toBeVisible();
  const scope = expand("one");
  expect(scope.getByText("Keep using open space")).toBeVisible();
  expect(scope.getByText("Beach match")).toBeVisible();
  expect(
    scope.getByRole("button", { name: "Approve" }),
  ).toBeDisabled();
  acknowledge(scope);
  expect(
    scope.getByRole("button", { name: "Approve" }),
  ).toBeEnabled();
});
it("removes only the confirmed item, confirms rejection, and then shows the empty state", async () => {
  const fetcher = setupQueue([card("one"), card("two")]);
  await screen.findByRole("article", { name: "Feedback for @Player one" });
  let scope = expand("one");
  acknowledge(scope);
  fireEvent.click(scope.getByRole("button", { name: "Approve" }));
  await screen.findByText("1 pending review · Newest first");
  scope = expand("two");
  fireEvent.click(scope.getByRole("button", { name: "Reject" }));
  fireEvent.click(scope.getByRole("button", { name: "Confirm rejection" }));
  await screen.findByText("You’re all caught up!");
  const actions = fetcher.mock.calls
    .map((c) => JSON.parse(c[1].body))
    .filter((c) => c.query.includes("mutation"));
  expect(actions[0].query).toContain("approveFeedback");
  expect(actions[1].query).toContain("rejectFeedback");
});
it("keeps a failed approval available with a retryable error", async () => {
  setupQueue([card("one")], true);
  await screen.findByRole("article", { name: "Feedback for @Player one" });
  const scope = expand("one");
  acknowledge(scope);
  fireEvent.click(scope.getByRole("button", { name: "Approve" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("article")).toBeVisible();
  expect(
    scope.getByRole("button", { name: "Approve" }),
  ).toBeEnabled();
});
it("disables actions and sends only one mutation during repeated taps", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let processed = false;
  const fetcher = vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes("mutation")) {
      await pending;
      processed = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { approveFeedback: { id: "one", status: "PUBLISHED" } },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          myFeedbackApprovals: {
            items: processed ? [] : [card("one")],
            totalCount: processed ? 0 : 1,
            nextCursor: null,
          },
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetcher);
  mount(<PendingFeedbackApprovals />);
  await screen.findByRole("article", { name: "Feedback for @Player one" });
  const scope = expand("one");
  acknowledge(scope);
  const approve = scope.getByRole("button", { name: "Approve" });
  fireEvent.click(approve);
  fireEvent.click(approve);
  await screen.findByText("Approving…");
  expect(
    scope.getByRole("button", { name: "Reject" }),
  ).toBeDisabled();
  expect(
    fetcher.mock.calls.filter((c) =>
      JSON.parse(c[1].body).query.includes("mutation"),
    ),
  ).toHaveLength(1);
  finish();
  await screen.findByText("You’re all caught up!");
});
it("shows an empty queue without decision controls", async () => {
  setupQueue([]);
  await screen.findByText("You’re all caught up!");
  expect(
    screen.queryByRole("button", { name: "Approve" }),
  ).not.toBeInTheDocument();
});
it("searches usernames, excludes the recipient and selects an immutable reviewer ID", async () => {
  const select = vi.fn();
  const fetcher = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        members: [
          { id: "recipient", username: "Alex" },
          { id: "member-id", username: "Alexandra" },
        ],
      },
    }),
  }));
  vi.stubGlobal("fetch", fetcher);
  mount(
    <ReviewerPicker recipientId="recipient" value={null} onChange={select} />,
  );
  fireEvent.change(screen.getByLabelText(/Assign feedback giver/), {
    target: { value: "Alex" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Alexandra" }));
  expect(select).toHaveBeenCalledWith({
    id: "member-id",
    username: "Alexandra",
  });
  expect(
    screen.queryByRole("button", { name: /^Alex$/ }),
  ).not.toBeInTheDocument();
});
it("shows assigned reviewer read-only and submits a pending draft through the invitation even when logged in", async () => {
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
                  recipientId: "recipient",
                  recipientUsername: "Recipient",
                  assignedReviewer: {
                    id: "reviewer",
                    username: "DesignatedReviewer",
                  },
                  approvalRequired: true,
                  sport: {
                    id: "sport",
                    name: "Beach Volleyball",
                    slug: "beach-volleyball",
                    skills: [
                      {
                        id: "passing",
                        name: "Passing",
                        slug: "passing",
                        active: true,
                      },
                    ],
                  },
                  match: null,
                },
              },
            }
          : { data: { submitGuestFeedback: { id: "pending" } } },
    };
  });
  vi.stubGlobal("fetch", fetcher);
  mount(
    <FeedbackSubmissionForm recipientId="" sportId="" token="opaque-token" />,
  );
  await screen.findByText("@DesignatedReviewer");
  expect(
    screen.getByText(/@DesignatedReviewer must sign in and approve/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Card Review" }));
  for (let i = 0; i < 2; i++)
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByRole("slider",{name:"Passing rating"}),{target:{value:"4"}});
  for (let i = 2; i < 5; i++)
    fireEvent.click(
      screen.getByRole("button", { name: /^(Next|Review Feedback)$/ }),
    );
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  await screen.findByText(/Your draft is awaiting DesignatedReviewer/);
  const sent = fetcher.mock.calls
    .map((c) => JSON.parse(c[1].body))
    .find((c) => c.query.includes("mutation"));
  expect(sent.query).toContain("submitGuestFeedback");
  expect(sent.variables.input).toMatchObject({
    recipientId: "recipient",
    sportId: "sport",
    token: "opaque-token",
    guestName: "SignedInPreparer",
  });
  expect(sent.variables.input).not.toHaveProperty("reviewerId");
  expect(sent.variables.input).not.toHaveProperty("status");
});
