"use client";
import { useState } from "react";
import {
  EMPTY_DATE_RANGE,
  matchDateVariables,
  type MatchDateRange,
} from "@/lib/match-date-range";
import { Button } from "./ui/button";
export function MatchDateFilter({
  value,
  onApply,
  subject = "matches",
}: {
  subject?: "matches" | "feedback";
  value: MatchDateRange;
  onApply: (range: MatchDateRange) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  return (
    <form
      aria-label={`Filter ${subject} by date`}
      className="mb-6 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          matchDateVariables(draft);
          setError("");
          onApply(draft);
        } catch (error) {
          setError((error as Error).message);
        }
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="field min-w-0 flex-1">
          From date
          <input
            type="date"
            value={draft.from}
            onChange={(event) =>
              setDraft({ ...draft, from: event.target.value })
            }
          />
        </label>
        <label className="field min-w-0 flex-1">
          To date
          <input
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <Button type="submit" variant="outline">
          Apply dates
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft(EMPTY_DATE_RANGE);
            setError("");
            onApply(EMPTY_DATE_RANGE);
          }}
        >
          Clear dates
        </Button>
      </div>
      <p className="subtle text-xs">
        {subject === "feedback"
          ? "Filter by the date feedback was submitted."
          : "Filter by the date played."}{" "}
        Both dates are included, using your local time.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
