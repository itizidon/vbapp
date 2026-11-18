"use client";
import { useId, type CSSProperties, type ReactNode } from "react";
import { isFeedbackRating } from "@/lib/feedback-rating";
export type FeedbackRatingSliderProps = {
  value: number | null;
  onChange: (value: number | null) => void;
  skillName: string;
  disabled?: boolean;
  descriptionId?: string;
  skipped?: boolean;
  heading?: ReactNode;
};
export function FeedbackRatingSlider({
  value,
  onChange,
  skillName,
  disabled = false,
  descriptionId,
  skipped = false,
  heading,
}: FeedbackRatingSliderProps) {
  const id = useId(),
    position = value ?? 3;
  const commit = (next: number) => {
    if (!disabled && isFeedbackRating(next)) onChange(next);
  };
  return (
    <div
      className="feedback-slider"
      data-rated={value !== null}
      role="group"
      aria-label={`${skillName} rating control`}
    >
      <div className="feedback-slider__heading">
        {heading}
        <output htmlFor={`${id}-range`} aria-live="polite">
          {value === null
            ? skipped
              ? "Skipped"
              : "Not rated"
            : `${value.toFixed(1)} / 5.0`}
        </output>
        {value !== null && (
          <button
            className="feedback-clear"
            type="button"
            disabled={disabled}
            aria-label={`Clear ${skillName} rating`}
            onClick={() => onChange(null)}
          >
            Clear rating
          </button>
        )}
      </div>
      <label className="sr-only" htmlFor={`${id}-range`}>
        {skillName} rating
      </label>
      <input
        id={`${id}-range`}
        type="range"
        min="1"
        max="5"
        step="0.1"
        value={position}
        disabled={disabled}
        aria-valuetext={
          value === null
            ? `${skipped ? "Skipped" : "Not rated"}. Move the slider or press Enter to rate.`
            : `${value.toFixed(1)} out of 5.0`
        }
        aria-describedby={[descriptionId, `${id}-hint`]
          .filter(Boolean)
          .join(" ")}
        style={
          {
            "--rating-fill": `${value === null ? 0 : ((value - 1) / 4) * 100}%`,
          } as CSSProperties
        }
        onChange={(event) => commit(Number(event.currentTarget.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onKeyDown={(event) => {
          const current = Math.round(position * 10);
          const next =
            event.key === "Home"
              ? 10
              : event.key === "End"
                ? 50
                : event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? current + 1
                  : event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? current - 1
                    : event.key === "PageUp"
                      ? current + 10
                      : event.key === "PageDown"
                        ? current - 10
                        : event.key === "Enter" || event.key === " "
                          ? current
                          : null;
          if (next !== null) {
            event.preventDefault();
            commit(Math.max(10, Math.min(50, next)) / 10);
          }
        }}
      />
      <div className="feedback-slider__scale" id={`${id}-hint`}>
        <span>1.0 Needs work</span>
        <span>5.0 Excellent</span>
      </div>
    </div>
  );
}
