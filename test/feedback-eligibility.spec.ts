import { Feedback } from "@prisma/client";
import {
  feedbackTrust,
  isEligibleForAiAnalysis,
  isEligibleForInternalRating,
} from "../src/feedback/eligibility";
const base = {
  status: "PUBLISHED",
  submittedAt: new Date(),
  rejectedAt: null,
  recipientId: "recipient",
  reviewerId: "reviewer",
  submittedById: "reviewer",
  approvalRequired: false,
  approvedAt: new Date(),
  approvedById: "reviewer",
  privateAnalyticsAllowed: true,
  privateAnalyticsConsentAt: new Date(),
  privateCoachingAllowed: true,
  privateCoachingConsentAt: new Date(),
  privacyNoticeVersion: "feedback-privacy-v1",
  pendingAiAllowed: false,
  pendingAiConsentAt: null,
  pendingAiNoticeVersion: null,
} as Feedback;
const context = {
  recipientCoachingEnabled: true,
  sportSlug: "beach-volleyball",
  moderation: "ALLOW",
};
describe("independent feedback eligibility policies", () => {
  it("accepts authenticated self-approval and authorized assigned approval", () => {
    expect(isEligibleForInternalRating(base)).toBe(true);
    expect(isEligibleForAiAnalysis(base, context)).toBe(true);
    expect(feedbackTrust(base)).toBe("VERIFIED_APPROVED");
    expect(
      isEligibleForInternalRating({
        ...base,
        approvalRequired: true,
        submittedById: "someone-else",
      }),
    ).toBe(true);
  });
  it("uses a guest submission for AI only, regardless of typed name", () => {
    const guest = {
      ...base,
      reviewerId: null,
      approvedAt: null,
      approvedById: null,
      submittedById: null,
      guestName: "reviewer",
    };
    expect(isEligibleForAiAnalysis(guest, context)).toBe(true);
    expect(isEligibleForInternalRating(guest)).toBe(false);
    expect(feedbackTrust(guest)).toBe("UNVERIFIED_GUEST");
  });
  it("requires a separate pending disclosure and never rates pending reviews", () => {
    const pending = {
      ...base,
      status: "PENDING" as const,
      approvalRequired: true,
      approvedAt: null,
      approvedById: null,
    };
    expect(isEligibleForAiAnalysis(pending, context)).toBe(false);
    const disclosed = {
      ...pending,
      pendingAiAllowed: true,
      pendingAiConsentAt: new Date(),
      pendingAiNoticeVersion: "pending-ai-disclosure-v1",
    };
    expect(isEligibleForAiAnalysis(disclosed, context)).toBe(true);
    expect(isEligibleForInternalRating(disclosed)).toBe(false);
    expect(feedbackTrust(disclosed)).toBe("AWAITING_REVIEWER_APPROVAL");
  });
  it.each(["HIDDEN", "DELETED", "REJECTED"] as const)(
    "excludes %s from both policies",
    (status) => {
      expect(isEligibleForAiAnalysis({ ...base, status }, context)).toBe(false);
      expect(isEligibleForInternalRating({ ...base, status })).toBe(false);
    },
  );
  it("excludes drafts, forged assignment approval and self-feedback", () => {
    expect(
      isEligibleForAiAnalysis({ ...base, submittedAt: null }, context),
    ).toBe(false);
    expect(isEligibleForInternalRating({ ...base, submittedAt: null })).toBe(
      false,
    );
    expect(
      isEligibleForInternalRating({
        ...base,
        approvalRequired: true,
        approvedById: "wrong",
      }),
    ).toBe(false);
    expect(
      isEligibleForInternalRating({ ...base, recipientId: "reviewer" }),
    ).toBe(false);
  });
  it.each(["ABUSE", "INJECTION", "PII", "UNCERTAIN"])(
    "excludes %s moderation",
    (moderation) =>
      expect(isEligibleForAiAnalysis(base, { ...context, moderation })).toBe(
        false,
      ),
  );
  it.each([
    { privateCoachingAllowed: false },
    { privateAnalyticsAllowed: false },
    { privateAnalyticsConsentAt: null },
    { privateCoachingConsentAt: null },
    { privacyNoticeVersion: null },
  ])("retains historic privacy restriction %j", (change) =>
    expect(isEligibleForAiAnalysis({ ...base, ...change }, context)).toBe(
      false,
    ),
  );
  it("honors recipient opt-out", () =>
    expect(
      isEligibleForAiAnalysis(base, {
        ...context,
        recipientCoachingEnabled: false,
      }),
    ).toBe(false));
});
