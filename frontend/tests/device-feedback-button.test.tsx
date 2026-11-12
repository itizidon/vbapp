import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackRequestDialog } from "../src/components/feedback-request-dialog";
const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../src/lib/hooks", () => ({
  useUser: () => ({ data: { me: { id: "owner" } } }),
  useCatalog: () => ({ data: { sports: [{ id: "beach" }] } }),
  useMatches: () => ({
    data: { rows: [] },
    isPending: false,
    hasNextPage: false,
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
    expect(mocks.push).toHaveBeenCalledWith("/f/device-token?mode=device"),
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toEqual({
    recipientId: "owner",
    sportId: "beach",
    matchId: null,
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
  expect(mocks.push).toHaveBeenCalledWith("/f/device-token?mode=device");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
