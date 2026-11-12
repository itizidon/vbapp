import type { Member } from "@/lib/types";
import { UserAvatar } from "./common";
export function FeedbackReviewerHeader({
  reviewer,
  guestName,
  recipientName,
  assignedReviewer,
  approvalRequired,
}: {
  reviewer: Member | null;
  guestName: string;
  recipientName: string;
  assignedReviewer: Member | null | undefined;
  approvalRequired: boolean;
}) {
  const name = reviewer?.username || guestName.trim() || "Guest reviewer";
  return (
    <header className="feedback-reviewer-header">
      <p className="feedback-kicker">BEACH VOLLEYBALL · PLAYER FEEDBACK</p>
      <h1>Help their game grow.</h1>
      <div className="feedback-identity-row">
        <div className="feedback-from">
          <UserAvatar name={name} />
          <div className="min-w-0">
            <p className="feedback-meta-label">
              {approvalRequired ? "Submitted by" : "Feedback from"}
            </p>
            <p className="feedback-person-name">
              {reviewer ? `@${name}` : name}
            </p>
            <span className="feedback-identity-badge">
              {reviewer ? "Registered player" : "Guest reviewer"}
            </span>
          </div>
        </div>
        <div className="feedback-recipient">
          <p className="feedback-meta-label">Reviewing</p>
          <p className="feedback-person-name">@{recipientName}</p>
          <p className="feedback-header-note">
            Five skills. Your honest perspective.
          </p>
        </div>
      </div>
      {assignedReviewer && (
        <div className="feedback-approval-notice">
          <p>
            Awaiting approval from <strong>@{assignedReviewer.username}</strong>
          </p>
          <p>
            Only the assigned player can approve this draft while signed in.
            Submitting it does not confirm their identity or publish their
            feedback.
          </p>
        </div>
      )}
    </header>
  );
}
