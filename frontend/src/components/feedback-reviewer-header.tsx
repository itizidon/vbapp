import type { ReactNode } from "react";

export function FeedbackReviewerHeader({
  recipientName,
  children,
  context,
}: {
  recipientName: string;
  children?: ReactNode;
  context?: ReactNode;
}) {
  return (
    <section
      className="feedback-reviewer-header feedback-details"
      aria-label="Feedback Details"
    >
      <header className="feedback-details-heading">
        <p className="feedback-kicker">BEACH VOLLEYBALL · PLAYER FEEDBACK</p>
        <h1>Help their game grow.</h1>
        <p className="feedback-details-recipient">
          Reviewing: <strong>@{recipientName}</strong>
        </p>
      </header>
      {children && <div className="feedback-details-giver">{children}</div>}
      {context && <div className="feedback-details-context">{context}</div>}
    </section>
  );
}
