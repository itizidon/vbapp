"use client";
import Link from "next/link";
import { useState } from "react";
import {
  useCatalog,
  useFeedback,
  useFeedbackDetails,
  useUser,
} from "@/lib/hooks";
import { FeedbackCard, CategoryRatingDetails } from "./feedback-card";
import { FeedbackRequestDialog } from "./feedback-request-dialog";
import { PageHeader } from "./page-header";
import { Button } from "./ui/button";
import { LoadingSkeleton, ErrorState, EmptyState, UserAvatar } from "./common";
export function FeedbackList() {
  const catalog = useCatalog();
  const feedback = useFeedback();
  const [filter, setFilter] = useState("all");
  if (catalog.isPending || feedback.isPending) return <LoadingSkeleton />;
  const error = catalog.error ?? feedback.error;
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          catalog.refetch();
          feedback.refetch();
        }}
      />
    );
  const skills = catalog.data?.sports.flatMap((s) => s.skills) ?? [];
  const rows = (feedback.data?.rows ?? []).filter(
    (f) => filter === "all" || (filter === "match" ? !!f.matchId : !f.matchId),
  );
  return (
    <>
      <PageHeader
        title="Your feedback"
        description="See what other players notice. Ask for a fresh perspective."
        action={<FeedbackRequestDialog />}
      />
      <div
        role="group"
        aria-label="Feedback filter"
        className="mb-6 flex flex-wrap gap-2"
      >
        {[
          { value: "all", label: "All feedback" },
          { value: "match", label: "Match feedback" },
          { value: "general", label: "General feedback" },
        ].map((option) => (
          <Button
            key={option.value}
            variant={filter === option.value ? "default" : "outline"}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className="subtle mb-4 text-xs">
        Newest first · filters apply to loaded feedback.
      </p>
      <div className="grid gap-4">
        {rows.length ? (
          rows.map((f) => (
            <FeedbackCard key={f.id} feedback={f} skills={skills} />
          ))
        ) : (
          <section className="panel">
            <EmptyState title="No feedback here yet">
              Request feedback from someone you play with, or try another
              filter.
            </EmptyState>
          </section>
        )}
      </div>
      {feedback.hasNextPage && (
        <Button
          className="mt-6 w-full"
          variant="outline"
          disabled={feedback.isFetchingNextPage}
          onClick={() => feedback.fetchNextPage()}
        >
          {feedback.isFetchingNextPage ? "Loading…" : "Load older feedback"}
        </Button>
      )}
    </>
  );
}
export function FeedbackDetails({ id }: { id: string }) {
  const detail = useFeedbackDetails(id);
  const catalog = useCatalog();
  const user = useUser();
  if (detail.isPending || catalog.isPending) return <LoadingSkeleton />;
  const error = detail.error ?? catalog.error;
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          detail.refetch();
          catalog.refetch();
        }}
      />
    );
  const feedback = detail.data!.feedback;
  if (!catalog.data?.sports.some((s) => s.id === feedback.sportId))
    return (
      <EmptyState title="Feedback unavailable">
        Only Beach Volleyball feedback is available here.
      </EmptyState>
    );
  const name =
    feedback.guestName ?? (feedback.reviewerId ? "Registered player" : "Guest");
  return (
    <>
      <Link
        href="/feedback"
        className="mb-5 inline-flex min-h-11 items-center text-sm text-primary"
      >
        ← Back to feedback
      </Link>
      <PageHeader
        title="Feedback details"
        description={
          feedback.matchId ? "A perspective from a match." : "General Feedback"
        }
      />
      <article className="panel space-y-6">
        <div className="flex items-center gap-3">
          <UserAvatar name={name} />
          <div>
            <h2 className="break-anywhere">{name}</h2>
            <p className="subtle text-xs">
              {new Date(feedback.createdAt).toLocaleString()} ·{" "}
              {feedback.status.toLowerCase()}
            </p>
          </div>
        </div>
        <div>
          <p className="subtle text-xs">Feedback for</p>
          <p className="break-anywhere font-semibold">
            {user.data?.me.id === feedback.recipientId
              ? user.data.me.username
              : `Player ${feedback.recipientId}`}
          </p>
        </div>
        <div>
          {feedback.matchId ? (
            <Link
              className="inline-flex min-h-11 items-center text-primary"
              href={`/matches/${feedback.matchId}`}
            >
              View associated match →
            </Link>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              General Feedback
            </p>
          )}
        </div>
        {feedback.overallComment && (
          <p className="break-anywhere whitespace-pre-wrap leading-7">
            {feedback.overallComment}
          </p>
        )}
        <CategoryRatingDetails
          feedback={feedback}
          skills={catalog.data!.sports.flatMap((s) => s.skills)}
        />
        <p className="subtle text-xs">
          Analytics sharing:{" "}
          {feedback.analyticsAllowed ? "allowed" : "not allowed"} · Supporting
          evidence: {feedback.evidenceAllowed ? "allowed" : "not allowed"}
        </p>
      </article>
    </>
  );
}
