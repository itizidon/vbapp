"use client";
import { useId, useRef, useState } from "react";
import { Star } from "lucide-react";
export function FeedbackStarRating({
  label,
  value,
  onChange,
  descriptionId,
  disabled = false,
}: {
  label: string;
  value: number | null;
  onChange: (rating: number | null) => void;
  descriptionId?: string;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const filled = preview ?? value ?? 0;
  function select(index: number) {
    onChange(index + 1);
    radios.current[index]?.focus();
  }
  return (
    <div className="feedback-rating">
      <div
        role="radiogroup"
        aria-label={`${label} rating`}
        aria-describedby={[descriptionId, `${id}-value`]
          .filter(Boolean)
          .join(" ")}
        className="feedback-stars"
        onMouseLeave={() => setPreview(null)}
      >
        {[1, 2, 3, 4, 5].map((rating, index) => (
          <button
            key={rating}
            ref={(node) => {
              radios.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={value === rating}
            aria-label={`${label}: ${rating} out of 5`}
            tabIndex={
              value === rating || (value === null && rating === 1) ? 0 : -1
            }
            disabled={disabled}
            onMouseEnter={() => setPreview(rating)}
            onBlur={() => setPreview(null)}
            onClick={() => onChange(rating)}
            onKeyDown={(event) => {
              const key = event.key;
              if (
                [
                  "ArrowRight",
                  "ArrowDown",
                  "ArrowLeft",
                  "ArrowUp",
                  "Home",
                  "End",
                ].includes(key)
              ) {
                event.preventDefault();
                select(
                  key === "Home"
                    ? 0
                    : key === "End"
                      ? 4
                      : (index +
                          (["ArrowRight", "ArrowDown"].includes(key) ? 1 : -1) +
                          5) %
                        5,
                );
              }
            }}
            className={rating <= filled ? "is-filled" : ""}
          >
            <Star
              aria-hidden="true"
              fill={rating <= filled ? "currentColor" : "none"}
            />
          </button>
        ))}
      </div>
      <div className="feedback-rating-caption">
        <span id={`${id}-value`}>
          {value === null ? "Not rated yet" : `Rating: ${value}/5`}
        </span>
        {value !== null && (
          <button
            type="button"
            disabled={disabled}
            className="feedback-clear"
            onClick={() => onChange(null)}
          >
            Clear rating
          </button>
        )}
      </div>
    </div>
  );
}
