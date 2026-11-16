"use client";
import { useState } from "react";
import type { Match } from "@/lib/types";
import { matchDate, matchTitle, participantName } from "@/lib/matches";
import { Button } from "./ui/button";
export type FeedbackReviewMode = "INDIVIDUAL_MATCHES" | "COMBINED_MATCHES";
export function FeedbackMatchPicker({
  matches,
  selected,
  onChange,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  matches: Match[];
  selected: string[];
  onChange: (ids: string[]) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
}) {
  const [search, setSearch] = useState("");
  const visible = matches.filter((m) =>
    `${matchTitle(m)} ${matchDate(m)} ${(m.participants ?? []).map((p) => participantName(p)).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <fieldset className="space-y-3 min-w-0">
      <legend className="font-semibold">
        Select matches · {selected.length} selected
      </legend>
      <label className="field">
        Search loaded matches
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, date or player"
        />
      </label>
      <div className="feedback-match-picker">
        {visible.map((match) => (
          <label key={match.id} className="feedback-match-choice">
            <input
              type="checkbox"
              checked={selected.includes(match.id)}
              disabled={!selected.includes(match.id) && selected.length >= 20}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, match.id]
                    : selected.filter((id) => id !== match.id),
                )
              }
            />
            <span className="min-w-0">
              <strong className="block break-anywhere">
                {matchTitle(match)}
              </strong>
              <span className="subtle block text-xs">{matchDate(match)}</span>
              {(match.teams ?? []).map((t) => (
                <span key={t.id} className="block text-xs break-anywhere">
                  Team {t.teamNumber}:{" "}
                  {(match.participants ?? [])
                    .filter((p) => p.teamId === t.id)
                    .map((p) => participantName(p))
                    .join(", ") || "No players"}{" "}
                  · {t.score ?? "—"}
                </span>
              ))}
              <span className="subtle block text-xs">
                {match.participants?.length ?? 0} participants
              </span>
            </span>
          </label>
        ))}
        {!visible.length && (
          <p className="subtle text-sm">No matching loaded matches.</p>
        )}
      </div>
      {hasMore && (
        <Button
          type="button"
          variant="outline"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Loading matches…" : "Load more matches"}
        </Button>
      )}
      <p className="subtle text-xs">
        Up to 20 matches. Reviews follow your selection order. Load more matches
        to search further back.
      </p>
    </fieldset>
  );
}
