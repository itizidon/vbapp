"use client";
import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import type { Feedback, Skill } from "@/lib/types";
import { RatingStars, UserAvatar } from "./common";
export function CategoryRatingDetails({
  feedback,
  skills,
}: {
  feedback: Feedback;
  skills: Skill[];
}) {
  return (
    <div className="space-y-3">
      {feedback.ratings?.map((rating) => (
        <div key={rating.skillId} className="rounded-xl bg-muted p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm">
              {skills.find((s) => s.id === rating.skillId)?.name ??
                "Rated category"}
            </h3>
            <div className="flex items-center gap-2">
              <RatingStars value={rating.rating} />
              <span className="subtle text-xs">{rating.rating}/5</span>
            </div>
          </div>
          {rating.comment && (
            <p className="break-anywhere mt-2 text-sm">{rating.comment}</p>
          )}
        </div>
      ))}
    </div>
  );
}
export function FeedbackCard({
  feedback,
  skills,
}: {
  feedback: Feedback;
  skills: Skill[];
}) {
  const ratings = feedback.ratings ?? [];
  const average = ratings.length
    ? ratings.reduce((n, r) => n + r.rating, 0) / ratings.length
    : null;
  const name = feedback.reviewerId
    ? (feedback.reviewerUsername ?? "Registered player")
    : (feedback.guestName ?? "Guest");
  return (
    <article className="panel min-w-0">
      <Link href={`/feedback/${feedback.id}`} className="block rounded-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar name={name} />
            <div className="min-w-0">
              <h2 className="break-anywhere text-base">{name}</h2>
              <p className="subtle text-xs">
                {new Date(feedback.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
          <ChevronRight className="shrink-0 text-muted-foreground" size={18} />
        </div>
        {average !== null && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <RatingStars value={average} />
            <span className="subtle text-xs">
              {average.toFixed(1)}/5 · average of {ratings.length}{" "}
              {ratings.length === 1 ? "category" : "categories"}
            </span>
          </div>
        )}
        {feedback.overallComment && (
          <p className="break-anywhere mt-4 whitespace-pre-wrap leading-7">
            {feedback.overallComment}
          </p>
        )}
      </Link>
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-primary">
          Category ratings ({ratings.length})
        </summary>
        <CategoryRatingDetails feedback={feedback} skills={skills} />
      </details>
      <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
        {feedback.matchId ? (
          <Link
            href={`/matches/${feedback.matchId}`}
            className="inline-flex min-h-11 items-center gap-2 text-primary"
          >
            <CalendarDays size={15} />
            Match feedback · View match
          </Link>
        ) : (
          <span className="inline-flex min-h-11 items-center">
            General Feedback
          </span>
        )}
      </div>
    </article>
  );
}
