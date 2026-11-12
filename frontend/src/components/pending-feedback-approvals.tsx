"use client";
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import { Button } from "./ui/button";
import { ErrorState, Pending } from "./common";
export interface ApprovalCard {
  id: string;
  recipientUsername: string;
  status: string;
  createdAt: string;
  overallComment: string | null;
  guestName: string | null;
  match: {
    id: string;
    description: string | null;
    playedAt: string | null;
  } | null;
  ratings: {
    skillId: string;
    skillName: string;
    rating: number;
    comment: string | null;
  }[];
}
export interface ApprovalQueue {
  totalCount: number;
  items: ApprovalCard[];
  nextCursor: string | null;
}
export function PendingFeedbackApprovals() {
  const user = useUser();
  const client = useQueryClient();
  const lock = useRef(false);
  const key = ["pending-feedback-approvals", user.data?.me.id];
  const queue = useQuery({
    queryKey: key,
    enabled: !!user.data,
    queryFn: () =>
      gql<{ myPendingFeedbackApprovals: ApprovalQueue }>(
        `query PendingApprovals{myPendingFeedbackApprovals{totalCount nextCursor items{id recipientUsername status createdAt overallComment guestName match{id description playedAt} ratings{skillId skillName rating comment}}}}`,
      ),
    refetchOnWindowFocus: "always",
  });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      gql(
        approve
          ? `mutation Approve($id:ID!){approveFeedback(feedbackId:$id){id status}}`
          : `mutation Reject($id:ID!){rejectFeedback(feedbackId:$id){id status}}`,
        { id },
      ),
    onSuccess: (_data, action) => {
      client.setQueryData<{ myPendingFeedbackApprovals: ApprovalQueue }>(
        key,
        (old) =>
          old
            ? {
                myPendingFeedbackApprovals: {
                  ...old.myPendingFeedbackApprovals,
                  totalCount: Math.max(
                    0,
                    old.myPendingFeedbackApprovals.totalCount - 1,
                  ),
                  items: old.myPendingFeedbackApprovals.items.filter(
                    (card) => card.id !== action.id,
                  ),
                },
              }
            : old,
      );
      void client.invalidateQueries({ queryKey: key });
      for (const prefix of [
        "feedback",
        "submitted-feedback",
        "summary",
        "internal-ratings",
        "skill-radar",
        "performance-summary",
      ])
        void client.invalidateQueries({ queryKey: [prefix] });
    },
    onSettled: () => {
      lock.current = false;
    },
  });
  const data = queue.data?.myPendingFeedbackApprovals;
  const card = data?.items[0];
  function process(approve: boolean) {
    if (lock.current || decide.isPending || !card) return;
    lock.current = true;
    decide.mutate({ id: card.id, approve });
  }
  return (
    <section
      className="panel mt-5 space-y-4"
      aria-labelledby="pending-approvals-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pending-approvals-title">Pending Feedback Approvals</h2>
        {data && (
          <span
            className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary"
            aria-live="polite"
          >
            {data.totalCount} pending
          </span>
        )}
      </div>
      <p className="subtle text-sm">
        Review drafts assigned to you. Approving publishes the feedback under
        your name and allows it to affect the player’s ratings.
      </p>
      {queue.isPending ? (
        <Pending label="Loading pending approvals…" />
      ) : queue.error ? (
        <ErrorState error={queue.error} retry={() => queue.refetch()} />
      ) : !card ? (
        data?.totalCount ? (
          <Pending label="Loading next approval…" />
        ) : (
          <div role="status">
            <h3>You&apos;re all caught up!</h3>
            <p className="subtle mt-1 text-sm">
              No feedback is waiting for your approval.
            </p>
          </div>
        )
      ) : (
        <article
          key={card.id}
          className="approval-card space-y-4 rounded-xl border border-border p-4 sm:p-5"
          aria-label={`Feedback for ${card.recipientUsername}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="subtle text-xs">Card 1 of {data!.totalCount}</p>
              <h3 className="mt-1 break-anywhere text-lg font-semibold">
                Feedback for {card.recipientUsername}
              </h3>
              <p className="subtle text-xs">
                Submitted {new Date(card.createdAt).toLocaleString()}
              </p>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs">
              Pending approval
            </span>
          </div>
          {card.guestName && (
            <p className="subtle break-anywhere text-sm">
              Prepared as: {card.guestName}{" "}
              <span className="text-xs">(submitted name)</span>
            </p>
          )}
          {card.match && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="break-anywhere font-semibold">
                {card.match.description || "Match feedback"}
              </p>
              {card.match.playedAt && (
                <p>{new Date(card.match.playedAt).toLocaleString()}</p>
              )}
            </div>
          )}
          {card.overallComment && (
            <p className="break-anywhere whitespace-pre-wrap text-sm">
              {card.overallComment}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {card.ratings.map((rating) => (
              <div
                key={rating.skillId}
                className="min-w-0 rounded-lg bg-muted p-3"
              >
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-semibold">{rating.skillName}</span>
                  <span className="shrink-0">{rating.rating} / 5</span>
                </div>
                {rating.comment && (
                  <p className="mt-2 break-anywhere whitespace-pre-wrap text-sm">
                    {rating.comment}
                  </p>
                )}
              </div>
            ))}
          </div>
          {decide.error && (
            <p role="alert" className="error text-sm">
              {decide.error.message}
            </p>
          )}
          <div className="flex flex-wrap justify-between gap-4 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => process(false)}
            >
              {decide.isPending && !decide.variables?.approve ? (
                <Pending label="Rejecting…" />
              ) : (
                "Reject"
              )}
            </Button>
            <Button
              type="button"
              disabled={decide.isPending}
              onClick={() => process(true)}
            >
              {decide.isPending && decide.variables?.approve ? (
                <Pending label="Approving…" />
              ) : (
                "Approve Feedback"
              )}
            </Button>
          </div>
        </article>
      )}
    </section>
  );
}
