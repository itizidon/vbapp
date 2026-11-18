"use client";
import { useId, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import type {
  FeedbackAnswers,
  FeedbackStep,
  SkillFeedbackAnswer,
} from "@/lib/feedback-steps";
import { FeedbackRatingSlider } from "./feedback-rating-slider";

export function FeedbackQuickRatings({
  steps,
  answers,
  onChange,
}: {
  steps: FeedbackStep[];
  answers: FeedbackAnswers;
  onChange: (skillId: string, patch: Partial<SkillFeedbackAnswer>) => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <section className="feedback-quick" aria-label="Quick category ratings">
      <h2>Quick review</h2>
      <p className="feedback-quick-intro">
        Rate any of the five skills. Open a category for its description and an
        optional comment.
      </p>
      {steps.map((step) => {
        const answer = step.skill ? answers[step.skill.id] : undefined;
        const open = !!expanded[step.key];
        const panelId = `${id}-${step.key}`;
        return (
          <div className="feedback-quick-row" key={step.key}>
            <FeedbackRatingSlider
              heading={
                <button
                  type="button"
                  className="feedback-quick-toggle"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() =>
                    setExpanded((previous) => ({
                      ...previous,
                      [step.key]: !open,
                    }))
                  }
                >
                  {step.title}
                  <span className="feedback-quick-indicators">
                    {answer?.comment.trim() && (
                      <MessageSquare size={14} aria-label="Comment added" />
                    )}
                    <ChevronDown size={15} aria-hidden="true" />
                  </span>
                </button>
              }
              skillName={step.title}
              disabled={!step.skill}
              value={answer?.rating ?? null}
              skipped={answer?.skipped ?? false}
              onChange={(rating) => {
                if (step.skill)
                  onChange(step.skill.id, { rating, skipped: false });
              }}
            />
            <div
              id={panelId}
              hidden={!open}
              className="feedback-quick-description"
            >
              <p>
                {step.skill?.description ||
                  (step.skill
                    ? "Share your perspective on this skill."
                    : "This category is currently unavailable.")}
              </p>
              {step.skill && (
                <label className="field" htmlFor={`${panelId}-comment`}>
                  {step.title} comment <span>(optional)</span>
                  <textarea
                    id={`${panelId}-comment`}
                    rows={2}
                    maxLength={5000}
                    value={answer?.comment ?? ""}
                    placeholder={step.placeholder}
                    onChange={(event) =>
                      onChange(step.skill!.id, {
                        comment: event.target.value,
                        skipped: false,
                      })
                    }
                  />
                </label>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
