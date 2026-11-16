import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackRequestDialog } from "../src/components/feedback-request-dialog";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  matches: [] as {
    id: string;
    description: string;
    playedAt: string;
    participants: { id: string; userId: string; guestName: null }[];
    teams: never[];
  }[],
  path: "/account",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/lib/hooks", () => ({
  useUser: () => ({ data: { me: { id: "owner" } } }),
  useCatalog: () => ({ data: { sports: [{ id: "beach" }] } }),
  useMatches: () => ({
    data: { rows: mocks.matches },
    isPending: false,
    hasNextPage: false,
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.matches = [];
  mocks.path = "/account";
  window.history.replaceState(null, "", "/");
});
function setup() {
  const fetcher = vi.fn(async (_url: unknown, _options: { body: string }) => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        createGuestFeedbackInvite: {
          token: "device-token",
          expiresAt: "2026-11-13T12:00:00Z",
        },
      },
    }),
  }));
  vi.stubGlobal("fetch", fetcher);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FeedbackRequestDialog />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Request feedback" }));
  return fetcher;
}
it("offers separate link creation and direct device review actions", async () => {
  const fetcher = setup();
  expect(
    screen.getByRole("button", { name: "Create feedback link" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Review on this device" }),
  );
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/f/device-token?mode=device&returnTo=%2Faccount",
    ),
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toEqual({
    recipientId: "owner",
    sportId: "beach",
    matchIds: [],
    reviewMode: "INDIVIDUAL_MATCHES",
    assignedReviewerId: null,
  });
});
it("retains the QR/copy-link flow and can reuse that link for a device review", async () => {
  const fetcher = setup();
  fireEvent.click(screen.getByRole("button", { name: "Create feedback link" }));
  await screen.findByLabelText("Feedback link");
  expect(screen.getByRole("button", { name: "Copy link" })).toBeVisible();
  expect(
    screen.getByRole("img", { name: "Feedback link QR code" }),
  ).toBeVisible();
  expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review on this device" }),
  );
  expect(mocks.push).toHaveBeenCalledWith(
    "/f/device-token?mode=device&returnTo=%2Faccount",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("defaults to individual review, permits multi-selection and stores an explicit combined mode when chosen", async () => {
  mocks.matches = ["m1", "m2"].map((id) => ({
    id,
    description: id,
    playedAt: "2026-11-12T12:00:00Z",
    participants: [{ id: id + "-p", userId: "owner", guestName: null }],
    teams: [],
  }));
  const fetcher = setup();
  fireEvent.click(screen.getByRole("button", { name: "Selected matches" }));
  expect(
    screen.getByRole("button", { name: "Review each match separately" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", { name: "Create feedback link" }),
  ).toBeDisabled();
  for (const checkbox of screen.getAllByRole("checkbox"))
    fireEvent.click(checkbox);
  expect(screen.getByText("2 selected · 10 skill steps")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "One review for all matches" }),
  );
  expect(screen.getByText("2 selected · 5 skill steps")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Create feedback link" }));
  await screen.findByLabelText("Feedback link");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toMatchObject({
    matchIds: ["m1", "m2"],
    reviewMode: "COMBINED_MATCHES",
  });
});

it.each([
  "/feedback",
  "/matches",
  "/matches/44444444-4444-4444-8444-444444444444",
])(
  "carries the originating %s route and filters into device review",
  async (path) => {
    mocks.path = path;
    window.history.replaceState(null, "", "/?from=2026-11-01");
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Review on this device" }),
    );
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    const url = new URL(mocks.push.mock.calls[0][0], "https://example.test");
    expect(url.searchParams.get("returnTo")).toBe(`${path}?from=2026-11-01`);
  },
);
