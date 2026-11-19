"use client";
import { useId, useState } from "react";
import { ChevronDown, Check, X, CalendarDays, Star } from "lucide-react";
import { useUser } from "@/lib/hooks";
import {
  approvalDate,
  approvalMatches,
  approvalSkill,
  useApprovalDecision,
  type ApprovalCard,
} from "@/lib/approvals";
import { FeedbackPermissionControls } from "./feedback-privacy-controls";
import { Button } from "./ui/button";
import { Pending } from "./common";
export function FeedbackApprovalCard({
  feedback,
  initialOpen = false,
  onNotice,
}: {
  feedback: ApprovalCard;
  initialOpen?: boolean;
  onNotice?: (message: string) => void;
}) {
  const id = useId(),
    user = useUser(),
    decision = useApprovalDecision(user.data?.me.id, onNotice);
  const [open, setOpen] = useState(initialOpen),
    [acknowledged, setAcknowledged] = useState(false),
    [rejecting, setRejecting] = useState(false),
    [reason, setReason] = useState("");
  const matches = approvalMatches(feedback),
    status = decision.data?.status ?? feedback.status,
    pending = status === "PENDING";
  const handled =
    !!decision.error &&
    /already|not pending|processed|page changed/i.test(decision.error.message);
  return (
    <article
      className="approval-review-card"
      aria-label={`Feedback for @${feedback.recipientUsername}`}
      id={`approval-${feedback.id}`}
    >
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary
          aria-controls={`${id}-details`}
          aria-expanded={open}
          className="approval-review-card__summary"
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          <div className="approval-review-card__heading">
            <div>
              <p className="approval-eyebrow">Feedback approval</p>
              <h2>For @{feedback.recipientUsername}</h2>
            </div>
            <span
              className={`approval-status approval-status--${status.toLowerCase()}`}
            >
              {status === "PUBLISHED"
                ? "Approved"
                : status === "REJECTED"
                  ? "Rejected"
                  : "Pending"}
            </span>
          </div>
          <div className="approval-review-card__meta">
            <span>
              <CalendarDays size={15} />
              {matches.length > 1
                ? `Combined feedback · ${matches.length} matches`
                : matches.length
                  ? `Match · ${approvalDate(matches[0].playedAt)}`
                  : "General feedback"}
            </span>
            <span>
              <Star size={15} />
              {feedback.ratings.length}{" "}
              {feedback.ratings.length === 1 ? "skill" : "skills"} rated
            </span>
          </div>
          <p className="approval-subtle">
            Submitted {approvalDate(feedback.createdAt)}
          </p>
          <span className="approval-review-card__expand">
            {open ? "Hide details" : "Review details"}
            <ChevronDown size={17} aria-hidden="true" />
          </span>
        </summary>
        <div id={`${id}-details`} className="approval-review-card__details">
          <p className="approval-subtle">
            Assigned to you as the registered reviewer. Review every score and
            comment before confirming. Approving publishes the feedback under
            your account and applies the existing player-rating rules.
          </p>
          {feedback.guestName && (
            <p className="approval-subtle">
              Submitted name: {feedback.guestName} (unverified; not proof of
              reviewer identity).
            </p>
          )}
          {!!matches.length && (
            <section
              aria-label="Associated matches"
              className="approval-match-list"
            >
              <h3>
                {matches.length > 1
                  ? `Combined feedback · ${matches.length} matches`
                  : "Associated match"}
              </h3>
              <ul>
                {matches.map((match) => (
                  <li key={match.id}>
                    <span>{match.description || "Beach volleyball match"}</span>
                    <time dateTime={match.playedAt ?? undefined}>
                      {approvalDate(match.playedAt)}
                    </time>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section
            aria-label="Submitted skill ratings"
            className="approval-ratings"
          >
            {feedback.ratings.map((r) => (
              <div key={r.skillId} className="approval-rating">
                <div>
                  <h3>{approvalSkill(r.skillName)}</h3>
                  <span
                    aria-label={`${approvalSkill(r.skillName)}: ${r.rating.toFixed(1)} out of 5`}
                  >
                    {r.rating.toFixed(1)} / 5
                  </span>
                </div>
                {r.comment && <p>{r.comment}</p>}
              </div>
            ))}
          </section>
          {feedback.overallComment && (
            <section className="approval-comment">
              <h3>Overall feedback</h3>
              <p>{feedback.overallComment}</p>
            </section>
          )}
          {!feedback.ratings.length && (
            <p className="approval-subtle">No skill ratings were submitted.</p>
          )}
          {pending && (
            <FeedbackPermissionControls
              key={feedback.id}
              feedback={feedback}
              pending
            />
          )}
          {feedback.rejectionReason && (
            <section className="approval-comment">
              <h3>Rejection reason</h3>
              <p>{feedback.rejectionReason}</p>
            </section>
          )}
          {!pending && (
            <p className="approval-subtle" role="status">
              {status === "PUBLISHED" ? "Approved" : "Rejected"}
              {feedback.approvedAt || feedback.rejectedAt
                ? ` · ${approvalDate(status === "PUBLISHED" ? feedback.approvedAt : feedback.rejectedAt)}`
                : ""}
              . This history is read-only.
            </p>
          )}
          {decision.error && (
            <p className="error" role="alert">
              {handled
                ? "This feedback has already been approved or rejected. Refreshing your approvals…"
                : decision.error.message}
            </p>
          )}
          {pending && (
            <div className="approval-actions">
              <label className="approval-acknowledgement">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={decision.isPending}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  I’ve reviewed every rating and comment and confirm this
                  feedback is mine.
                </span>
              </label>
              {rejecting ? (
                <div className="approval-rejection">
                  <p>
                    Reject this feedback? This decision cannot be undone here.
                  </p>
                  <label htmlFor={`${id}-reason`}>Reason (optional)</label>
                  <textarea
                    id={`${id}-reason`}
                    maxLength={1000}
                    rows={3}
                    value={reason}
                    disabled={decision.isPending}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div>
                    <Button
                      variant="outline"
                      disabled={decision.isPending}
                      onClick={() => setRejecting(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="approval-reject"
                      disabled={decision.isPending || !open}
                      onClick={() =>
                        decision.decide({
                          id: feedback.id,
                          approve: false,
                          reason,
                        })
                      }
                    >
                      {decision.isPending ? (
                        <Pending label="Rejecting…" />
                      ) : (
                        "Confirm rejection"
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="approval-action-buttons">
                  <Button
                    variant="outline"
                    className="approval-reject"
                    disabled={decision.isPending || !open}
                    onClick={() => setRejecting(true)}
                  >
                    <X size={17} />
                    Reject
                  </Button>
                  <Button
                    className="approval-approve"
                    disabled={
                      decision.isPending ||
                      !open ||
                      !acknowledged ||
                      !feedback.ratings.length
                    }
                    onClick={() =>
                      decision.decide({ id: feedback.id, approve: true })
                    }
                  >
                    {decision.isPending ? (
                      <Pending label="Approving…" />
                    ) : (
                      <>
                        <Check size={17} />
                        Approve
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </article>
  );
}
