import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/notification-bell";
import { ApprovalsPage } from "@/components/approvals-page";
import { FeedbackApprovalCard } from "@/components/feedback-approval-card";
import { AppShell } from "@/components/app-shell";
import { AccountPage } from "@/components/account-page";
import type { ApprovalCard } from "@/lib/approvals";
vi.mock("@/lib/hooks", () => ({
  useUser: () => ({
    isPending: false,
    data: {
      me: {
        id: "reviewer",
        username: "Reviewer",
        email: "r@example.test",
        createdAt: "2026-01-01",
        isPublic: false,
      },
    },
    refetch: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/approvals",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/top-player-search", () => ({
  TopPlayerSearch: () => null,
}));
vi.mock("@/components/feedback-request-dialog", () => ({
  FeedbackRequestDialog: () => null,
}));
vi.mock("@/components/account-visibility-switch", () => ({
  AccountVisibilitySwitch: () => null,
}));
vi.mock("@/components/feedback-privacy-controls", () => ({
  FeedbackPermissionControls: () => null,
  AccountProcessingPrivacy: () => null,
}));
const card: ApprovalCard = {
  id: "one",
  status: "PENDING",
  recipientUsername: "Player",
  createdAt: "2026-11-16",
  match: null,
  matches: [],
  guestName: null,
  overallComment: "Review all of this comment",
  ratings: [
    {
      skillId: "passing",
      skillName: "Passing",
      rating: 4,
      comment: "Keep a steady platform",
    },
  ],
};
function mount(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  return client;
}
function api({
  count = 3,
  previewError = false,
}: { count?: number; previewError?: boolean } = {}) {
  let total = count;
  const calls = vi.fn(async (_url, options) => {
    const b = JSON.parse(String(options.body));
    let data: object;
    if (b.query.includes("mutation Approve")) {
      total--;
      data = { approveFeedback: { id: b.variables.id, status: "PUBLISHED" } };
    } else if (b.query.includes("PendingApprovalCount"))
      data = { myPendingApprovalCount: total };
    else if (b.query.includes("RecentPendingApprovals")) {
      if (previewError)
        return {
          ok: true,
          json: async () => ({ errors: [{ message: "Network unavailable" }] }),
        };
      data = {
        myRecentPendingApprovals: Array.from(
          { length: Math.min(5, total) },
          (_, i) => ({
            id: String(i),
            recipientUsername: `Preview${i}`,
            status: "PENDING",
            createdAt: "2026-11-16",
            matchCount: i === 0 ? 3 : 0,
            ratedSkillCount: 5,
            match: null,
          }),
        ),
      };
    } else
      data = {
        myFeedbackApprovals: {
          totalCount: b.variables.status === "PENDING" ? total : 1,
          items:
            b.variables.status === "PENDING"
              ? total
                ? [card]
                : []
              : [{ ...card, status: b.variables.status }],
          nextCursor: null,
        },
      };
    return { ok: true, json: async () => ({ data }) };
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
it("uses backend counts, caps the badge at 99+, and fetches at most three previews only on open", async () => {
  const fetch = api({ count: 102 });
  mount(<NotificationBell />);
  const bell = await screen.findByRole("button", {
    name: "Notifications, 102 pending feedback approvals",
  });
  expect(screen.getByText("99+")).toBeInTheDocument();
  expect(
    fetch.mock.calls.some((c) =>
      JSON.parse(c[1].body).query.includes("RecentPendingApprovals"),
    ),
  ).toBe(false);
  bell.focus();
  fireEvent.click(bell);
  const dialog = await screen.findByRole("dialog", { name: "Notifications" });
  await within(dialog).findByText("For @Preview0");
  expect(within(dialog).getAllByRole("article")).toHaveLength(3);
  expect(
    within(dialog).getByText("Combined feedback · 3 matches"),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("link", { name: "View all approvals" }),
  ).toHaveAttribute("href", "/approvals");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(bell).toHaveFocus();
});
it("shows no badge for zero and the accessible empty state", async () => {
  api({ count: 0 });
  mount(<NotificationBell />);
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  await screen.findByText("You’re all caught up!");
  expect(screen.queryByText("99+")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("allows retry after a preview error", async () => {
  api({ previewError: true });
  mount(<NotificationBell />);
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  await screen.findByText("Couldn’t load approvals.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});
it("synchronizes the bell after a confirmed approval, without optimistic removal", async () => {
  api({ count: 1 });
  mount(
    <>
      <NotificationBell />
      <FeedbackApprovalCard feedback={card} />
    </>,
  );
  await screen.findByRole("button", {
    name: "Notifications, 1 pending feedback approvals",
  });
  fireEvent.click(screen.getByText("Review details"));
  fireEvent.click(screen.getByRole("checkbox", { name: /I’ve reviewed/ }));
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await screen.findByText(/This history is read-only/);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument(),
  );
});
it("shows read-only Approved and Rejected tabs with no decision or privacy controls", async () => {
  api();
  mount(<ApprovalsPage />);
  await screen.findByRole("article");
  fireEvent.click(screen.getByRole("tab", { name: "Approved" }));
  await screen.findByText("1 approved review · Newest first");
  fireEvent.click(screen.getByText("Review details"));
  expect(
    screen.queryByRole("button", { name: "Approve" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Rejected" }));
  await screen.findByText("1 rejected review · Newest first");
  expect(
    screen.queryByRole("button", { name: "Reject" }),
  ).not.toBeInTheDocument();
});
it("keeps the bell in the app header and replaces Account management with a link", async () => {
  api({ count: 2 });
  mount(
    <AppShell>
      <AccountPage />
    </AppShell>,
  );
  await screen.findByRole("button", {
    name: "Notifications, 2 pending feedback approvals",
  });
  expect(
    screen.getByRole("link", { name: "Manage approvals" }),
  ).toHaveAttribute("href", "/approvals");
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it("does not treat skipped skills as zero ratings", () => {
  api();
  mount(<FeedbackApprovalCard feedback={card} initialOpen />);
  expect(screen.getByLabelText("Passing: 4.0 out of 5")).toBeVisible();
  expect(
    screen.queryByLabelText(/: 0(?:\.0)? out of 5/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Serving" }),
  ).not.toBeInTheDocument();
});
it("shows an assigned reviewer the exact decimal before approval", () => {
  mount(
    <FeedbackApprovalCard
      initialOpen
      feedback={{
        ...card,
        ratings: [
          {
            skillId: "passing",
            skillName: "Passing",
            rating: 4.7,
            comment: "Exact score",
          },
        ],
      }}
    />,
  );
  expect(screen.getByLabelText("Passing: 4.7 out of 5")).toBeVisible();
  expect(screen.getByText("4.7 / 5")).toBeVisible();
});
