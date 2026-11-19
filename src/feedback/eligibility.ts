import type { Feedback } from "@prisma/client";
import { PRIVACY_NOTICE_VERSION, PENDING_AI_NOTICE_VERSION } from "./privacy";
export type FeedbackTrust =
  "VERIFIED_APPROVED" | "UNVERIFIED_GUEST" | "AWAITING_REVIEWER_APPROVAL";
type Review = Pick<
  Feedback,
  | "status"
  | "reviewerId"
  | "recipientId"
  | "approvalRequired"
  | "approvedAt"
  | "approvedById"
  | "submittedById"
  | "submittedAt"
  | "rejectedAt"
>;
// A direct, authenticated author submission is the existing self-approval workflow.
// Typed names and assignment IDs alone are never proof. New direct submissions also record explicit approval stamps.
export function hasReviewerApproval(f: Review): boolean {
  return (
    !!f.reviewerId &&
    f.reviewerId !== f.recipientId &&
    !f.rejectedAt &&
    ((!!f.approvedAt && f.approvedById === f.reviewerId) ||
      (!f.approvalRequired && f.submittedById === f.reviewerId))
  );
}
export function feedbackTrust(f: Review): FeedbackTrust {
  return hasReviewerApproval(f) && f.status === "PUBLISHED"
    ? "VERIFIED_APPROVED"
    : f.reviewerId
      ? "AWAITING_REVIEWER_APPROVAL"
      : "UNVERIFIED_GUEST";
}
export function isEligibleForInternalRating(f: Review): boolean {
  return !!f.submittedAt && f.status === "PUBLISHED" && hasReviewerApproval(f);
}
type AiReview = Review &
  Pick<
    Feedback,
    | "privateAnalyticsAllowed"
    | "privateAnalyticsConsentAt"
    | "privateCoachingAllowed"
    | "privateCoachingConsentAt"
    | "privacyNoticeVersion"
    | "pendingAiAllowed"
    | "pendingAiConsentAt"
    | "pendingAiNoticeVersion"
  >;
export function isEligibleForAiAnalysis(
  f: AiReview,
  context: {
    recipientCoachingEnabled: boolean;
    sportSlug: string;
    moderation: string;
  },
): boolean {
  const pending = f.status === "PENDING";
  return (
    !!f.submittedAt &&
    !f.rejectedAt &&
    ((f.status === "PUBLISHED" &&
      (!f.approvalRequired || hasReviewerApproval(f))) ||
      (pending &&
        f.approvalRequired &&
        !!f.reviewerId &&
        f.pendingAiAllowed &&
        !!f.pendingAiConsentAt &&
        f.pendingAiNoticeVersion === PENDING_AI_NOTICE_VERSION)) &&
    f.privateAnalyticsAllowed &&
    !!f.privateAnalyticsConsentAt &&
    f.privateCoachingAllowed &&
    !!f.privateCoachingConsentAt &&
    f.privacyNoticeVersion === PRIVACY_NOTICE_VERSION &&
    context.recipientCoachingEnabled &&
    ["volleyball", "beach-volleyball"].includes(context.sportSlug) &&
    ["ALLOW", "UNASSESSED"].includes(context.moderation)
  );
}
