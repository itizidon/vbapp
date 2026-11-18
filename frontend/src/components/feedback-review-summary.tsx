import { Pencil } from "lucide-react";
import type { FeedbackAnswers, FeedbackStep } from "@/lib/feedback-steps";
import { Button } from "./ui/button";
export function FeedbackReviewSummary({
  steps,
  answers,
  onEdit,
  disabled,
}: {
  steps: FeedbackStep[];
  answers: FeedbackAnswers;
  onEdit: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="feedback-review-list">
      {steps.map((step, index) => {
        const answer = step.skill ? answers[step.skill.id] : null;
        const rating = !answer?.skipped ? answer?.rating : null;
        return (
          <article
            key={step.key}
            className="feedback-review-row"
            aria-label={`${step.title} summary`}
          >
            <div className="feedback-review-row-heading">
              <h3>{step.title}</h3>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || !step.skill}
                onClick={() => onEdit(index)}
                aria-label={`Edit ${step.title}`}
              >
                <Pencil size={13} />
                Edit
              </Button>
            </div>
            {rating != null ? (
              <>
                <div className="feedback-review-score">
                  <strong>{rating.toFixed(1)} / 5.0</strong>
                </div>
              </>
            ) : (
              <p className="feedback-skipped">
                {step.skill ? "Skipped" : "Unavailable"}
              </p>
            )}
            {answer?.comment.trim() && !answer.skipped && (
              <p className="break-anywhere whitespace-pre-wrap">
                {answer.comment}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
