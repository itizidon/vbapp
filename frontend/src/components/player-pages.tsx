"use client";
import Link from "next/link";
import { EMPTY_DATE_RANGE, matchDateVariables } from "@/lib/match-date-range";
import { nextPageCursor, pageRows } from "@/lib/pagination";
import { InfiniteResults } from "./infinite-results";
import { MatchDateFilter } from "./match-date-filter";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { LockKeyhole, Search } from "lucide-react";
import { gql } from "@/lib/api";
import { MATCH_FIELDS } from "@/lib/matches";
import { useUser } from "@/lib/hooks";
import type { Match, PlayerProfile } from "@/lib/types";
import { Brand, ThemeToggle } from "./app-shell";
import { Button } from "./ui/button";
import { PageHeader } from "./page-header";
import { EmptyState, ErrorState, LoadingSkeleton, UserAvatar } from "./common";
import { TopPlayerSearch } from "./top-player-search";
import { MatchCard } from "./match-pages";
export function PlayerHeader() {
  const user = useUser();
  return (
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6">
      <Brand />
      {user.data && (
        <div className="order-last w-full min-w-0 lg:order-none lg:w-80">
          <TopPlayerSearch />
        </div>
      )}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button asChild variant="outline">
          <Link href={user.data ? "/matches" : "/login"}>
            {user.data ? "Your matches" : "Sign in"}
          </Link>
        </Button>
      </div>
    </header>
  );
}
export function PlayerSearch() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const players = useInfiniteQuery({
    queryKey: ["player-search", search],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      gql<{ searchPlayers: PlayerProfile[] }>(
        `query PlayerSearch($search:String!,$cursor:String){searchPlayers(search:$search,cursor:$cursor){id username isPublic}}`,
        { search, cursor: pageParam },
      ),
    getNextPageParam: (page) =>
      page.searchPlayers.length === 51 ? page.searchPlayers[49].id : undefined,
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const rows =
    players.data?.pages.flatMap((page) => page.searchPlayers.slice(0, 50)) ??
    [];
  return (
    <>
      <PageHeader
        title="Search players"
        description="Find any player by username. Public accounts share their match history; private accounts keep it hidden."
      />
      <form
        className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (search === input.trim()) void players.refetch();
          else setSearch(input.trim());
        }}
      >
        <label className="field min-w-0 flex-1">
          Player username
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search all players…"
            maxLength={40}
            autoComplete="off"
          />
        </label>
        <Button type="submit">
          <Search size={17} />
          Search
        </Button>
      </form>
      {players.isPending ? (
        <LoadingSkeleton />
      ) : players.error ? (
        <ErrorState error={players.error} retry={() => players.refetch()} />
      ) : rows.length ? (
        <ul aria-label="Players" className="grid gap-3 sm:grid-cols-2">
          {rows.map((player) => (
            <li key={player.id} className="panel">
              <Link
                href={`/players/${player.id}`}
                className="flex min-w-0 items-center gap-3"
              >
                <UserAvatar name={player.username} />
                <div className="min-w-0">
                  <h2 className="break-anywhere">{player.username}</h2>
                  <p className="subtle mt-1 flex items-center gap-1 text-sm">
                    {!player.isPublic && <LockKeyhole size={14} />}
                    {player.isPublic
                      ? "Public · View match history"
                      : "Private account"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No players found">
          Try a different username, or clear your search to browse everyone.
        </EmptyState>
      )}
      {players.hasNextPage && (
        <Button
          className="mt-6 w-full"
          variant="outline"
          disabled={players.isFetchingNextPage}
          onClick={() => players.fetchNextPage()}
        >
          {players.isFetchingNextPage ? "Loading…" : "Load more players"}
        </Button>
      )}
    </>
  );
}
export function PlayerHistory({ id }: { id: string }) {
  const [range, setRange] = useState(EMPTY_DATE_RANGE);
  const dates = matchDateVariables(range);
  const user = useUser();
  const profile = useQuery({
    queryKey: ["player-profile", id],
    queryFn: () =>
      gql<{ playerProfile: PlayerProfile }>(
        `query PlayerProfile($id:ID!){playerProfile(id:$id){id username isPublic}}`,
        { id },
      ),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const player = profile.data?.playerProfile;
  const history = useInfiniteQuery({
    queryKey: ["player-matches", id, dates.playedFrom, dates.playedBefore],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      gql<{ playerMatches: Match[] }>(
        `query PlayerMatches($userId:ID!,$cursor:String,$playedFrom:DateTime,$playedBefore:DateTime){playerMatches(userId:$userId,cursor:$cursor,playedFrom:$playedFrom,playedBefore:$playedBefore){${MATCH_FIELDS}}}`,
        { userId: id, cursor: pageParam, ...dates },
      ),
    enabled: !!player?.isPublic,
    getNextPageParam: (page) => nextPageCursor(page.playerMatches),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const rows =
    history.data?.pages.flatMap((page) => pageRows(page.playerMatches)) ?? [];
  if (profile.isPending) return <LoadingSkeleton />;
  if (profile.error)
    return <ErrorState error={profile.error} retry={() => profile.refetch()} />;
  if (!player) return null;
  return (
    <>
      <Link
        href="/players"
        className="mb-4 inline-flex min-h-11 items-center text-sm text-primary"
      >
        ← Back to player search
      </Link>
      <PageHeader
        title={`${player.username}’s match history`}
        description={
          player.isPublic
            ? "Public account · Match history is read-only."
            : "Private account"
        }
      />
      {user.data?.me.id === id && (
        <Button asChild variant="outline" className="mb-5">
          <Link href="/matches">Go to your matches</Link>
        </Button>
      )}
      {player.isPublic && <MatchDateFilter value={range} onApply={setRange} />}
      {!player.isPublic ? (
        <section className="panel space-y-3">
          <LockKeyhole className="text-muted-foreground" />
          <h2>This account is private</h2>
          <p className="subtle">This player’s match history is hidden.</p>
        </section>
      ) : history.error ? (
        <ErrorState
          error={history.error}
          retry={() => {
            void profile.refetch();
            void history.refetch();
          }}
        />
      ) : history.isPending ? (
        <LoadingSkeleton />
      ) : rows.length ? (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {rows.map((match) => (
            <MatchCard key={match.id} match={match} readOnly playerId={id} />
          ))}
        </div>
      ) : (
        <section className="panel">
          <EmptyState
            title={
              range.from || range.to
                ? "No matches in this date range"
                : "No matches yet"
            }
          >
            {range.from || range.to
              ? "Try different dates or clear the date filter."
              : "This player has no recorded matches."}
          </EmptyState>
        </section>
      )}
      {player.isPublic && !history.error && (
        <InfiniteResults
          hasNextPage={!!history.hasNextPage}
          isFetchingNextPage={history.isFetchingNextPage}
          onLoadMore={() => history.fetchNextPage()}
        />
      )}
    </>
  );
}
