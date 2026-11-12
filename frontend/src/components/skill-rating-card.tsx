"use client";
import type { CSSProperties } from "react";
import { ChevronRight, ArrowUpRight, ArrowDownRight } from "lucide-react";
export const SKILL_ACCENTS: Record<string, string> = {
  passing: "#e4e66a",
  setting: "#ffb063",
  attack: "#f37cb8",
  serving: "#62d9ef",
  defense: "#74e4aa",
};
export function SkillRatingCard({
  name,
  axis,
  rating,
  selfRating,
  selected,
  onSelect,
}: {
  name: string;
  axis: string;
  rating: number | null;
  selfRating: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const difference =
    rating !== null && selfRating !== null ? rating - selfRating : null;
  const color = SKILL_ACCENTS[axis] ?? "#f2ba74";
  return (
    <button
      type="button"
      className={`skill-rating-card skill-rating-card--${axis} ${selected ? "is-selected" : ""}`}
      style={{ "--skill-accent": color } as CSSProperties}
      aria-pressed={selected}
      onClick={onSelect}
      aria-label={`${name}: ${rating === null ? "Not rated" : `${rating} out of 5`}`}
    >
      <div className="skill-rating-card__heading">
        <span>{name}</span>
        <ChevronRight size={16} />
      </div>
      <div className="skill-rating-card__body">
        <div>
          <p className="skill-rating-card__value">
            {rating === null ? "—" : rating.toFixed(2)}
            <small>/ 5</small>
          </p>
          <p className="skill-rating-card__comparison">
            {selfRating === null
              ? "Self: unavailable"
              : `Self: ${selfRating.toFixed(1)}`}
          </p>
        </div>
        <svg width="80" height="54" viewBox="0 0 100 64" aria-hidden="true">
          <path
            d="M12 52 A38 38 0 0 1 88 52"
            fill="none"
            stroke="rgba(255,255,255,.12)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M12 52 A38 38 0 0 1 88 52"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${rating === null ? 0 : (rating / 5) * 100} 100`}
          />
          <text
            x="50"
            y="51"
            textAnchor="middle"
            fill="currentColor"
            fontSize="12"
          >
            {rating === null ? "N/A" : `${Math.round((rating / 5) * 100)}%`}
          </text>
        </svg>
      </div>
      <div
        className={`skill-rating-card__delta ${difference !== null && difference > 0 ? "positive" : difference !== null && difference < 0 ? "negative" : ""}`}
      >
        {difference === null ? (
          <span>No comparison yet</span>
        ) : (
          <>
            {difference >= 0 ? (
              <ArrowUpRight size={12} />
            ) : (
              <ArrowDownRight size={12} />
            )}
            <span>
              {difference > 0 ? "+" : ""}
              {difference.toFixed(2)} vs self
            </span>
          </>
        )}
      </div>
    </button>
  );
}
