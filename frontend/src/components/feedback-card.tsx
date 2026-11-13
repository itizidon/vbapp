"use client";
import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import type { Feedback, Skill } from "@/lib/types";
import { feedbackReport, feedbackSkillColor } from "@/lib/feedback-history";
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
  const { ratings, average, comment } = feedbackReport(feedback);
  const name = feedback.reviewerId
    ? (feedback.reviewerUsername ?? "Registered player")
    : feedback.guestName?.trim() || "Guest reviewer";
  return (
    <article className="feedback-history-card min-w-0">
      <Link
        href={`/feedback/${feedback.id}`}
        className="feedback-history-card__content"
        aria-label={`View feedback from ${name}`}
      >
        <header className="feedback-history-card__header">
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar name={name} />
            <div className="min-w-0">
              <h2 className="break-anywhere text-base">{name}</h2>
              <p className="subtle text-xs">
                {feedback.reviewerId ? "Registered player" : "Guest reviewer"}
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="shrink-0" aria-hidden="true" />
        </header>
        <div className="feedback-history-card__meta">
          <time dateTime={feedback.createdAt}>
            {new Date(feedback.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </time>
          <span className="feedback-kind-badge">
            {feedback.matchId ? "Match feedback" : "General feedback"}
          </span>
          {feedback.status !== "PUBLISHED" && (
            <span className="feedback-kind-badge">
              {feedback.status.toLowerCase()}
            </span>
          )}
        </div>
        <div className="feedback-history-card__overall">
          <div>
            <p className="feedback-history-card__eyebrow">
              {average === null ? "PLAYER NOTES" : "FEEDBACK SCORE"}
            </p>
            <p className="feedback-history-card__score">
              {average === null ? (
                "Written feedback"
              ) : (
                <>
                  {average.toFixed(2)} <small>/ 5</small>
                </>
              )}
            </p>
          </div>
          {average !== null && <RatingStars value={average} />}
        </div>
        <div
          className="feedback-skill-bars"
          aria-label="Submitted skill ratings"
        >
          {ratings.map((rating) => {
            const skill = skills.find((s) => s.id === rating.skillId);
            const label = skill?.name ?? "Rated category";
            return (
              <div className="feedback-skill-bar" key={rating.skillId}>
                <span className="break-anywhere">{label}</span>
                <span
                  className="feedback-skill-bar__track"
                  role="meter"
                  aria-label={`${label} rating`}
                  aria-valuemin={1}
                  aria-valuemax={5}
                  aria-valuenow={rating.rating}
                >
                  <span
                    style={{
                      width: `${(rating.rating / 5) * 100}%`,
                      backgroundColor: feedbackSkillColor(skill),
                    }}
                  />
                </span>
                <span className="feedback-skill-bar__value">
                  {rating.rating}/5
                </span>
              </div>
            );
          })}
        </div>
        <p
          className={`feedback-history-card__comment break-anywhere ${comment ? "" : "subtle"}`}
        >
          {comment ?? "No written comment"}
        </p>
      </Link>
      <footer className="feedback-history-card__footer">
        {feedback.matchId ? (
          <Link
            href={`/matches/${feedback.matchId}`}
            className="feedback-history-card__match"
          >
            <CalendarDays size={14} aria-hidden="true" />
            View match
          </Link>
        ) : (
          <span className="subtle text-xs">General feedback</span>
        )}
        <Link
          href={`/feedback/${feedback.id}`}
          className="feedback-history-card__detail"
          aria-label={`View full feedback from ${name}`}
        >
          View feedback <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </footer>
    </article>
  );
}
