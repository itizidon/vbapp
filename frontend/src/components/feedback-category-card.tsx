"use client";
import Image from "next/image";
import { useId } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { FeedbackStep, SkillFeedbackAnswer } from "@/lib/feedback-steps";
import { FeedbackStarRating } from "./feedback-star-rating";
import { Button } from "./ui/button";
export function FeedbackCategoryCard({
  step,
  index,
  answer,
  onChange,
  onPrevious,
  onNext,
  onSkip,
  error,
}: {
  step: FeedbackStep;
  index: number;
  answer: SkillFeedbackAnswer | null;
  onChange: (patch: Partial<SkillFeedbackAnswer>) => void;
  onPrevious: () => void;
  onNext: () => void;
  onSkip: () => void;
  error: string;
}) {
  const id = useId();
  return (
    <article
      className="feedback-skill-card feedback-card-enter"
      aria-label={`${step.title} feedback card`}
    >
      <div className="feedback-art">
        <Image
          src={step.image}
          alt=""
          loading="eager"
          sizes="(max-width: 640px) 100vw, 620px"
          className="feedback-art-image"
        />
        <div className="feedback-art-fade" />
      </div>
      <div className="feedback-card-controls">
        <div className="feedback-category-heading">
          <p className="feedback-kicker">YOUR PERSPECTIVE · {index + 1} / 5</p>
          <h2>{step.title}</h2>
        </div>
        {step.skill ? (
          <>
            {step.skill.description && (
              <p
                className="feedback-skill-description"
                id={`${id}-description`}
              >
                {step.skill.description}
              </p>
            )}
            <FeedbackStarRating
              label={step.title}
              value={answer?.rating ?? null}
              onChange={(rating) => onChange({ rating, skipped: false })}
              descriptionId={
                step.skill.description ? `${id}-description` : undefined
              }
            />
            <label className="feedback-comment" htmlFor={`${id}-comment`}>
              Add a comment <span>(optional)</span>
            </label>
            <textarea
              id={`${id}-comment`}
              rows={3}
              maxLength={5000}
              value={answer?.comment ?? ""}
              onChange={(event) =>
                onChange({ comment: event.target.value, skipped: false })
              }
              placeholder={step.placeholder}
            />
            <p className="feedback-comment-limit">
              {answer?.comment.length ?? 0} / 5,000
            </p>
          </>
        ) : (
          <p className="feedback-skill-description">
            This category is unavailable in the current skill catalog. Skip to
            continue.
          </p>
        )}
        {error && (
          <p role="alert" className="feedback-inline-error">
            {error}
          </p>
        )}
        <div className="feedback-step-actions">
          <Button
            type="button"
            variant="outline"
            className="feedback-secondary feedback-previous"
            disabled={index === 0}
            onClick={onPrevious}
            aria-label="Previous category"
          >
            <ArrowLeft size={17} />
            <span>Previous</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="feedback-secondary"
            onClick={onSkip}
          >
            Skip
          </Button>
          <Button type="button" className="feedback-primary" onClick={onNext}>
            {index === 4 ? "Review Feedback" : "Next"}
            <ArrowRight size={17} />
          </Button>
        </div>
      </div>
    </article>
  );
}
