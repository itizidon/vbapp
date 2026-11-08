"use client";
import type { Match } from "@/lib/types";
import { matchTitle, matchDate } from "@/lib/matches";
import { Button } from "./ui/button";
export function GeneralFeedbackOption({
  selected,
  onSelect,
  disabled = false,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-4 ${selected ? "border-primary bg-accent" : "border-border"}`}
    >
      <input
        type="radio"
        name="match-association"
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1 shrink-0"
      />
      <span>
        <span className="block font-semibold">No match — General Feedback</span>
        <span className="subtle block text-xs">
          Feedback about their game, without a specific match.
        </span>
      </span>
    </label>
  );
}
export function MatchSelector({
  matches,
  value,
  onChange,
  locked = false,
  scopedMatchId,
  guest = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  matches: Match[];
  value: string;
  onChange: (value: string) => void;
  locked?: boolean;
  scopedMatchId?: string;
  guest?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-3 text-base font-semibold">
        Match{" "}
        <span className="subtle text-sm font-normal">
          {locked ? "(set by this invitation)" : "(optional)"}
        </span>
      </legend>
      {!scopedMatchId && (
        <GeneralFeedbackOption
          selected={!value}
          onSelect={() => onChange("")}
        />
      )}{" "}
      {(scopedMatchId
        ? matches.filter((match) => match.id === scopedMatchId)
        : matches
      ).map((match) => (
        <label
          key={match.id}
          className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-4 ${value === match.id ? "border-primary bg-accent" : "border-border"}`}
        >
          <input
            type="radio"
            name="match-association"
            checked={value === match.id}
            onChange={() => onChange(match.id)}
            disabled={locked}
            className="mt-1 shrink-0"
          />
          <span className="min-w-0">
            <span className="break-anywhere block font-semibold">
              {matchTitle(match)}
            </span>
            <span className="subtle block text-xs">
              {matchDate(match)} · {match.participants?.length ?? 0}{" "}
              {(match.participants?.length ?? 0) === 1 ? "player" : "players"}
            </span>
            {!!match.teams?.length && (
              <span className="subtle block text-xs">
                {match.teams
                  .map(
                    (t) =>
                      `${t.name ?? `Team ${t.teamNumber}`}${t.score !== null ? `: ${t.score}` : ""}`,
                  )
                  .join(" · ")}
              </span>
            )}
          </span>
        </label>
      ))}
      {scopedMatchId && !matches.some((m) => m.id === scopedMatchId) && (
        <div className="rounded-xl border border-primary bg-accent p-4">
          <p className="font-semibold">Feedback for the invited match</p>
          <p className="subtle break-anywhere mt-1 font-mono text-xs">
            {scopedMatchId}
          </p>
          <p className="subtle mt-2 text-xs">
            Match details are private. This invitation is restricted to this
            match.
          </p>
        </div>
      )}
      {guest && !scopedMatchId && (
        <p className="subtle text-xs">
          This guest invitation is for general feedback. To request feedback
          about a match, ask the player for a match-specific link.
        </p>
      )}
      {hasMore && onLoadMore && (
        <Button
          variant="outline"
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading matches…" : "Load more matches"}
        </Button>
      )}
    </fieldset>
  );
}
