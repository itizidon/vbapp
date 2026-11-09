"use client";
import Link from "next/link";
import { useState } from "react";
import { EMPTY_DATE_RANGE } from "@/lib/match-date-range";
import { MatchDateFilter } from "./match-date-filter";
import { InfiniteResults } from "./infinite-results";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Users, ChevronRight } from "lucide-react";
import {
  useCatalog,
  useMatches,
  useMatch,
  useUser,
  useFeedback,
  useSubmittedFeedback,
} from "@/lib/hooks";
import { gql } from "@/lib/api";
import {
  matchTitle,
  matchDate,
  participantName,
  teamResult,
  playerMatchResult,
} from "@/lib/matches";
import type { Match } from "@/lib/types";
import { Button } from "./ui/button";

import { EditMatchDialog } from "./edit-match-dialog";
import { CreateMatchDialog } from "./create-match-dialog";
import { PageHeader } from "./page-header";
import { ErrorState, LoadingSkeleton, EmptyState, Pending } from "./common";
import { FeedbackCard } from "./feedback-card";
import { FeedbackRequestDialog } from "./feedback-request-dialog";
export function MatchCard({
  match,
  readOnly = false,
  playerId,
}: {
  match: Match;
  readOnly?: boolean;
  playerId?: string;
}) {
  const user = useUser();
  const result = playerMatchResult(
    match,
    readOnly ? playerId : user.data?.me.id,
  );
  const cardStyle =
    result === "Win"
      ? "bg-green-50 border-green-300 dark:bg-green-950/40 dark:border-green-800"
      : result === "Loss"
        ? "bg-red-50 border-red-300 dark:bg-red-950/40 dark:border-red-800"
        : "";
  const players = match.participants ?? [];
  const teams = match.teams ?? [];
  const unassigned = players.filter(
    (player) => !teams.some((team) => team.id === player.teamId),
  );
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {match.status !== "SCHEDULED" && (
            <span className="mb-3 inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary">
              {match.status.toLowerCase().replaceAll("_", " ")}
            </span>
          )}
          <h2 className="break-anywhere text-lg">{matchTitle(match)}</h2>
        </div>
        {!readOnly && (
          <ChevronRight
            size={19}
            className="mt-1 shrink-0 text-muted-foreground"
          />
        )}
      </div>
      <p className="subtle mt-4 flex items-center gap-2 text-sm">
        <CalendarDays size={16} className="shrink-0" />
        {matchDate(match)}
      </p>
      <p className="subtle mt-2 flex items-center gap-2 text-sm">
        <Users size={16} className="shrink-0" />
        {match.participants?.length ?? 0}{" "}
        {(match.participants?.length ?? 0) === 1
          ? "participant"
          : "participants"}
      </p>
      {teams.length > 0 && (
        <div className="mt-5 grid gap-3 border-t border-border pt-4">
          {teams.map((team) => {
            const result = teamResult(team, teams);
            const resultStyle =
              result === "Win"
                ? "text-green-800 dark:text-green-300"
                : result === "Loss"
                  ? "text-red-800 dark:text-red-300"
                  : "";
            return (
              <div
                key={team.id}
                className={`flex items-start justify-between gap-3 rounded-lg p-3 text-sm ${resultStyle}`}
              >
                <div className="min-w-0">
                  <p className="break-anywhere font-semibold">
                    {team.name ?? `Team ${team.teamNumber}`}
                  </p>
                  <p className="subtle break-anywhere mt-1 text-xs">
                    {players
                      .filter((player) => player.teamId === team.id)
                      .map((player) => participantName(player))
                      .join(", ") || "No assigned players"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <strong
                    className="block text-xl tabular-nums"
                    aria-label={`Score: ${team.score ?? "not recorded"}`}
                  >
                    {team.score ?? "—"}
                  </strong>
                  {result && (
                    <span className="text-xs font-semibold">{result}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {unassigned.length > 0 && (
        <div className="mt-3">
          <p className="subtle text-xs font-semibold">
            {teams.length ? "Unassigned players" : "Players"}
          </p>
          <p className="subtle break-anywhere mt-1 text-xs">
            {unassigned.map((player) => participantName(player)).join(", ")}
          </p>
        </div>
      )}
      {readOnly && (
        <p className="subtle mt-4 text-xs">
          Status: {match.status.toLowerCase().replaceAll("_", " ")} · Recorded{" "}
          {new Date(match.createdAt).toLocaleDateString()}
        </p>
      )}
    </>
  );
  return (
    <article className={`panel min-w-0 ${cardStyle}`}>
      {readOnly ? (
        <div>{content}</div>
      ) : (
        <Link href={`/matches/${match.id}`} className="block rounded-lg">
          {content}
        </Link>
      )}
    </article>
  );
}
export function MatchList() {
  const [range, setRange] = useState(EMPTY_DATE_RANGE);
  const matches = useMatches(true, range);
  const catalog = useCatalog();
  if (matches.isPending || catalog.isPending) return <LoadingSkeleton />;
  const error =
    catalog.error ?? (matches.isFetchNextPageError ? null : matches.error);
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          matches.refetch();
          catalog.refetch();
        }}
      />
    );
  return (
    <>
      <PageHeader
        title="Your matches"
        description="The games you’re part of. The people you play with."
        action={<CreateMatchDialog />}
      />
      <MatchDateFilter value={range} onApply={setRange} />
      {matches.data?.rows.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {matches.data.rows.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      ) : (
        <section className="panel">
          <EmptyState
            title={
              range.from || range.to
                ? "No matches in this date range"
                : "Your next match starts here"
            }
          >
            {range.from || range.to
              ? "No matches in this date range. Try different dates or clear the filter."
              : "Create a match to keep your games and feedback together."}
          </EmptyState>
        </section>
      )}
      <InfiniteResults
        hasNextPage={!!matches.hasNextPage}
        isFetchingNextPage={matches.isFetchingNextPage}
        error={matches.isFetchNextPageError ? matches.error : null}
        onLoadMore={() => matches.fetchNextPage()}
      />
    </>
  );
}
export function MatchDetails({ id }: { id: string }) {
  const detail = useMatch(id);
  const user = useUser();
  const catalog = useCatalog();
  const received = useFeedback();
  const submitted = useSubmittedFeedback();
  const client = useQueryClient();
  const join = useMutation({
    mutationFn: () =>
      gql(
        `mutation JoinMatch($input:AddParticipantInput!){addMatchParticipant(input:$input){id}}`,
        { input: { matchId: id, userId: user.data?.me.id } },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["match", id] });
      client.invalidateQueries({ queryKey: ["matches"] });
    },
  });
  if (detail.isPending || catalog.isPending) return <LoadingSkeleton />;
  const error = detail.error ?? catalog.error;
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          detail.refetch();
          catalog.refetch();
        }}
      />
    );
  const match = detail.data?.match;
  if (
    !match ||
    (match.sportId && !catalog.data?.sports.some((s) => s.id === match.sportId))
  )
    return (
      <EmptyState title="Match unavailable">
        This match may have been removed or is not available in Beach
        Volleyball.
      </EmptyState>
    );
  const me = user.data!.me;
  const participants = match.participants ?? [];
  const teams = match.teams ?? [];
  const participating = participants.some((p) => p.userId === me.id);
  const visible = [
    ...new Map(
      [...(received.data?.rows ?? []), ...(submitted.data?.rows ?? [])]
        .filter((f) => f.matchId === id)
        .map((f) => [f.id, f]),
    ).values(),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <Link
        href="/matches"
        className="mb-4 inline-flex min-h-11 items-center text-sm text-primary"
      >
        ← Back to matches
      </Link>
      <PageHeader
        title={matchTitle(match)}
        description={matchDate(match)}
        action={
          <div className="flex flex-wrap gap-2">
            {match.createdById === me.id && <EditMatchDialog match={match} />}
            {participating && <FeedbackRequestDialog initialMatch={match} />}
          </div>
        }
      />
      <div className="grid gap-5">
        <section className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2>Match information</h2>
            {match.status !== "SCHEDULED" && (
              <span className="rounded-full bg-accent px-3 py-1 text-xs text-primary">
                {match.status.toLowerCase().replaceAll("_", " ")}
              </span>
            )}
          </div>
          <p className="subtle mt-3">
            {match.sportId ? "Beach Volleyball" : "Sport not specified"} ·{" "}
            {participants.length}{" "}
            {participants.length === 1 ? "participant" : "participants"}
          </p>
          {teams.length > 0 && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="rounded-xl border border-border p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="break-anywhere">
                      {team.name ?? `Team ${team.teamNumber}`}
                    </h3>
                    <strong className="text-xl">{team.score ?? "—"}</strong>
                  </div>
                  <p className="subtle break-anywhere mt-2 text-xs">
                    {participants
                      .filter((p) => p.teamId === team.id)
                      .map((p) => participantName(p, me))
                      .join(", ") || "No assigned players"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2 className="mb-4">Players</h2>
          {participants.length ? (
            <ul className="divide-y divide-border">
              {participants.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="break-anywhere font-semibold">
                      {participantName(p, me)}
                    </p>
                    {p.teamId && (
                      <p className="subtle text-xs">
                        {teams.find((t) => t.id === p.teamId)?.name ??
                          `Team ${teams.find((t) => t.id === p.teamId)?.teamNumber ?? ""}`}
                      </p>
                    )}
                  </div>
                  {p.userId && p.userId !== me.id && (
                    <Button variant="outline" asChild>
                      <Link href={`/give-feedback/${p.userId}?match=${id}`}>
                        Give feedback
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle">No participants have been added yet.</p>
          )}
          {!participating && match.createdById === me.id && (
            <div className="mt-4">
              <Button
                variant="outline"
                onClick={() => join.mutate()}
                disabled={join.isPending}
              >
                {join.isPending ? "Joining…" : "Join this match"}
              </Button>
              <p className="subtle mt-2 text-xs">
                Join as a participant before requesting match feedback.
              </p>
              {join.error && (
                <p role="alert" className="error">
                  {join.error.message}
                </p>
              )}
            </div>
          )}
        </section>
        <section>
          <div className="mb-4">
            <h2>Match feedback</h2>
            <p className="subtle mt-1 text-xs">
              Your received and submitted feedback for this match. Load older
              feedback to see more.
            </p>
          </div>
          {received.error && (
            <ErrorState
              error={received.error}
              retry={() => received.refetch()}
            />
          )}{" "}
          {submitted.error && (
            <ErrorState
              error={submitted.error}
              retry={() => submitted.refetch()}
            />
          )}{" "}
          {received.isPending || submitted.isPending ? (
            <LoadingSkeleton />
          ) : visible.length ? (
            <div className="grid gap-4">
              {visible.map((f) => (
                <FeedbackCard
                  key={f.id}
                  feedback={f}
                  skills={catalog.data!.sports.flatMap((s) => s.skills)}
                />
              ))}
            </div>
          ) : (
            <div className="panel">
              <EmptyState title="No visible feedback for this match">
                Ask someone you played with for their perspective.
              </EmptyState>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {received.hasNextPage && (
              <Button
                variant="outline"
                onClick={() => received.fetchNextPage()}
                disabled={received.isFetchingNextPage}
              >
                {received.isFetchingNextPage ? (
                  <Pending label="Loading received feedback…" />
                ) : (
                  "Load older received feedback"
                )}
              </Button>
            )}
            {submitted.hasNextPage && (
              <Button
                variant="outline"
                onClick={() => submitted.fetchNextPage()}
                disabled={submitted.isFetchingNextPage}
              >
                {submitted.isFetchingNextPage ? (
                  <Pending label="Loading submitted feedback…" />
                ) : (
                  "Load older submitted feedback"
                )}
              </Button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
