import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  FeedbackPrivacyNotice,
  GuestPrivacyReceipts,
} from "@/components/feedback-privacy";
import {
  FeedbackPermissionControls,
  FeedbackPrivacySettings,
} from "@/components/feedback-privacy-controls";
import PrivacyPage from "@/app/privacy/page";
vi.mock("@/lib/hooks", () => ({
  useUser: () => ({ data: undefined }),
  useSubmittedFeedback: () => ({ data: undefined }),
}));
function wrapper(children: React.ReactNode) {
  return render(
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
      {children}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});
describe("purpose-specific privacy controls", () => {
  it("shows the notice and actual policy link, with private consent unchecked and no public consent on submission", () => {
    wrapper(
      <FeedbackPrivacyNotice>
        <label>
          <input type="checkbox" />
          Allow private processing
        </label>
      </FeedbackPrivacyNotice>,
    );
    expect(
      screen.getByRole("heading", { name: "How your feedback is used" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Privacy notice/ }),
    ).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByText(/Comments and observations may be sent to OpenAI/),
    ).toBeInTheDocument();
  });
  it("keeps public sharing separate and unchecked, and grants only the purpose selected", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { updateFeedbackPrivacy: { id: "review" } },
      }),
    } as Response);
    wrapper(
      <FeedbackPermissionControls feedback={{ id: "review" }} showPublic />,
    );
    for (const c of screen.getAllByRole("checkbox"))
      expect(c).not.toBeChecked();
    fireEvent.click(
      screen.getByLabelText(/Allow this review in the recipient/),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.variables.input).toEqual({
      feedbackId: "review",
      privateAnalyticsAllowed: true,
      privacyNoticeVersion: "feedback-privacy-v1",
    });
    expect(body.variables.input).not.toHaveProperty("publicAnalyticsAllowed");
  });
  it("has a reachable privacy page explaining third parties, historical treatment and withdrawal", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { name: "How BVBTips uses feedback" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Historical feedback is not newly opted in/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "OpenAI data controls" }),
    ).toHaveAttribute(
      "href",
      "https://developers.openai.com/api/docs/guides/your-data",
    );
  });
  it("offers purpose-limited guest receipts and posts withdrawals in JSON, never the URL", async () => {
    const receipt = "guest-withdrawal-receipt";
    wrapper(
      <GuestPrivacyReceipts
        result={{ submitGuestFeedback: { privacyWithdrawalToken: receipt } }}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Manage privacy/ }),
    ).toHaveAttribute("href", `/privacy/feedback#${receipt}`);
    window.history.replaceState(null, "", `/privacy/feedback#${receipt}`);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: { withdrawGuestFeedbackPrivacy: true } }),
    } as Response);
    wrapper(<FeedbackPrivacySettings />);
    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw processing permissions" }),
    );
    await screen.findByText("Processing permissions withdrawn.");
    expect(fetch.mock.calls[0][0]).toBe("/api/graphql");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).variables).toEqual({
      token: receipt,
    });
    expect(window.location.hash).toBe("");
  });
});

it("requires an unchecked separate disclosure choice for recipient AI before approval", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          updateFeedbackPrivacy: { id: "pending", pendingAiAllowed: true },
        },
      }),
    } as Response);
  wrapper(<FeedbackPermissionControls feedback={{ id: "pending" }} pending />);
  const choice = screen.getByRole("checkbox", {
    name: /Allow recipient AI insights and excerpts before I approve/,
  });
  expect(choice).not.toBeChecked();
  expect(
    screen.getByText(/Before approval, this review is private to you/),
  ).toBeVisible();
  fireEvent.click(choice);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(body.variables.input).toEqual({
    feedbackId: "pending",
    pendingAiAllowed: true,
    pendingAiNoticeVersion: "pending-ai-disclosure-v1",
    privacyNoticeVersion: "feedback-privacy-v1",
  });
  expect(body.variables.input).not.toHaveProperty("privateCoachingAllowed");
});
