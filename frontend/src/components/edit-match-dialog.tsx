"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Pencil, Plus, X } from "lucide-react";
import { gql } from "@/lib/api";
import { localDateTimeValue } from "@/lib/date-time";
import { parseTeamScore } from "@/lib/match-edit";
import { participantName } from "@/lib/matches";
import { useUser } from "@/lib/hooks";
import type { Match, MatchTeam, MatchParticipant, Member } from "@/lib/types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Pending } from "./common";

type Refresh = () => Promise<unknown>;
export function EditMatchDialog({ match }: { match: Match }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const user = useUser();
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["match", match.id] }),
      client.invalidateQueries({ queryKey: ["matches"] }),
    ]);
  if (user.data?.me.id !== match.createdById) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil size={16} />
        Edit match
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="lg:max-w-4xl lg:p-8">
          <DialogTitle className="pr-9 text-xl font-bold">
            Edit match
          </DialogTitle>
          <DialogDescription className="subtle mb-6 mt-2 text-sm">
            Update the game, teams, and players. Save each section to apply its
            changes.
          </DialogDescription>
          <div className="space-y-7">
            <MatchDetailsForm match={match} refresh={refresh} />
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {(match.teams ?? []).map((team) => (
                <section
                  key={team.id}
                  aria-label={`Edit ${team.name ?? `Team ${team.teamNumber}`}`}
                  className="min-w-0 space-y-4 rounded-xl border border-border p-4"
                >
                  <TeamForm team={team} refresh={refresh} />
                  <h3 className="text-sm font-semibold">Players</h3>
                  {(match.participants ?? [])
                    .filter((player) => player.teamId === team.id)
                    .map((player) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        teams={match.teams ?? []}
                        me={user.data!.me}
                        refresh={refresh}
                      />
                    ))}
                  {!(match.participants ?? []).some(
                    (player) => player.teamId === team.id,
                  ) && <p className="subtle text-sm">No players yet.</p>}
                  <AddPlayerForm
                    match={match}
                    me={user.data!.me}
                    teamId={team.id}
                    refresh={refresh}
                  />
                </section>
              ))}
            </div>
            {(match.teams ?? []).length < 2 && (
              <AddTeamForm matchId={match.id} refresh={refresh} />
            )}
            {(!(match.teams ?? []).length ||
              (match.participants ?? []).some(
                (player) =>
                  !(match.teams ?? []).some(
                    (team) => team.id === player.teamId,
                  ),
              )) && (
              <section
                aria-label="Unassigned players"
                className="space-y-4 rounded-xl border border-border p-4"
              >
                <h2>Unassigned players</h2>
                {(match.participants ?? [])
                  .filter(
                    (player) =>
                      !(match.teams ?? []).some(
                        (team) => team.id === player.teamId,
                      ),
                  )
                  .map((player) => (
                    <PlayerRow
                      key={player.id}
                      player={player}
                      teams={match.teams ?? []}
                      me={user.data!.me}
                      refresh={refresh}
                    />
                  ))}
                {!(match.teams ?? []).length && (
                  <AddPlayerForm
                    match={match}
                    me={user.data!.me}
                    teamId={null}
                    refresh={refresh}
                  />
                )}
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function MatchDetailsForm({
  match,
  refresh,
}: {
  match: Match;
  refresh: Refresh;
}) {
  const form = useForm<{
    description: string;
    playedAt: string;
    status: Match["status"];
  }>({
    defaultValues: {
      description: match.description ?? "",
      playedAt: match.playedAt
        ? localDateTimeValue(new Date(match.playedAt))
        : "",
      status: match.status,
    },
  });
  const mutation = useMutation({
    mutationFn: (values: {
      description: string;
      playedAt: string;
      status: Match["status"];
    }) =>
      gql(
        `mutation EditMatch($input:UpdateMatchInput!){updateMatch(input:$input){id}}`,
        {
          input: {
            id: match.id,
            description: values.description.trim(),
            playedAt: values.playedAt
              ? new Date(values.playedAt).toISOString()
              : null,
            status: values.status,
          },
        },
      ),
    onSuccess: refresh,
  });
  return (
    <form
      aria-label="Edit match details"
      onSubmit={form.handleSubmit((input) => mutation.mutate(input))}
      className="space-y-4"
    >
      <h2>Match details</h2>
      <fieldset disabled={mutation.isPending} className="space-y-4">
        <label className="field">
          Match name or description
          <input maxLength={500} {...form.register("description")} />
        </label>
        <label className="field">
          Date and time
          <input
            type="datetime-local"
            max={localDateTimeValue()}
            {...form.register("playedAt")}
          />
        </label>
        <label className="field">
          Match status
          <select {...form.register("status")}>
            {[
              "DRAFT",
              "SCHEDULED",
              "IN_PROGRESS",
              "COMPLETED",
              "CANCELLED",
            ].map((status) => (
              <option key={status} value={status}>
                {status.toLowerCase().replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">
          {mutation.isPending ? <Pending /> : "Save match details"}
        </Button>
      </fieldset>
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error.message}
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-xs text-primary">
          Match details saved.
        </p>
      )}
    </form>
  );
}
function TeamForm({ team, refresh }: { team: MatchTeam; refresh: Refresh }) {
  const displayName = team.name ?? `Team ${team.teamNumber}`;
  const [score, setScore] = useState(
    team.score === null ? "" : String(team.score),
  );
  const mutation = useMutation({
    mutationFn: () =>
      gql(
        `mutation EditTeam($input:UpdateTeamInput!){updateMatchTeam(input:$input){id name score}}`,
        {
          input: {
            id: team.id,
            score: parseTeamScore(score),
          },
        },
      ),
    onSuccess: refresh,
  });
  return (
    <form
      aria-label={`Edit team ${displayName}`}
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="space-y-3"
    >
      <h3 className="break-anywhere">{displayName}</h3>
      <fieldset disabled={mutation.isPending} className="space-y-3">
        <label className="field">
          Score for {displayName}
          <input
            type="number"
            min={0}
            max={2147483647}
            step={1}
            value={score}
            placeholder="No score"
            onChange={(event) => setScore(event.target.value)}
          />
        </label>
        <p className="subtle text-xs">
          Leave blank when the score isn’t known. Zero is a recorded score.
        </p>
        <Button variant="outline" type="submit">
          {mutation.isPending ? <Pending /> : "Save team"}
        </Button>
      </fieldset>
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error.message}
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-xs text-primary">
          Team saved.
        </p>
      )}
    </form>
  );
}
function AddTeamForm({
  matchId,
  refresh,
}: {
  matchId: string;
  refresh: Refresh;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      gql(
        `mutation AddTeam($input:CreateTeamInput!){createMatchTeam(input:$input){id}}`,
        { input: { matchId } },
      ),
    onSuccess: refresh,
  });
  return (
    <form
      aria-label="Add a team"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="space-y-3"
    >
      <Button variant="outline" type="submit" disabled={mutation.isPending}>
        <Plus size={16} />
        {mutation.isPending ? "Adding…" : "Add team"}
      </Button>
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error.message}
        </p>
      )}
    </form>
  );
}
function PlayerRow({
  player,
  teams,
  me,
  refresh,
}: {
  player: MatchParticipant;
  teams: MatchTeam[];
  me: Member;
  refresh: Refresh;
}) {
  const name = participantName(player, me);
  const assign = useMutation({
    mutationFn: (teamId: string | null) =>
      gql(
        `mutation EditPlayerTeam($participantId:ID!,$teamId:ID){assignParticipantToTeam(participantId:$participantId,teamId:$teamId){id teamId}}`,
        { participantId: player.id, teamId: teamId || null },
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () =>
      gql(
        `mutation RemovePlayer($id:ID!){removeMatchParticipant(id:$id){id}}`,
        { id: player.id },
      ),
    onSuccess: refresh,
  });
  const busy = assign.isPending || remove.isPending;
  return (
    <section
      aria-label={`Player ${name}`}
      className="space-y-3 rounded-xl border border-border p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="break-anywhere text-sm">{name}</h3>
        <Button
          variant="ghost"
          type="button"
          className="size-11 shrink-0 px-0"
          aria-label={`Remove player ${name}`}
          disabled={busy}
          onClick={() => remove.mutate()}
        >
          <X size={16} />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {teams
          .filter((team) => team.id !== player.teamId)
          .map((team) => (
            <Button
              key={team.id}
              type="button"
              variant="outline"
              className="h-auto min-h-11 whitespace-normal text-xs"
              disabled={busy}
              onClick={() => assign.mutate(team.id)}
            >
              Move to {team.name ?? `Team ${team.teamNumber}`}
            </Button>
          ))}
        {player.teamId && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => assign.mutate(null)}
          >
            Unassign
          </Button>
        )}
      </div>
      {(assign.error ?? remove.error) && (
        <p role="alert" className="error">
          {(assign.error ?? remove.error)!.message}
        </p>
      )}
    </section>
  );
}
function AddPlayerForm({
  match,
  me,
  teamId,
  refresh,
}: {
  match: Match;
  me: Member;
  teamId: string | null;
  refresh: Refresh;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [guestName, setGuestName] = useState("");
  const [validation, setValidation] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const players = match.participants ?? [];
  const full = players.length >= 50;
  const add = useMutation({
    mutationFn: (identity: { userId: string } | { guestName: string }) =>
      gql(
        "userId" in identity
          ? `mutation AddExistingPlayer($input:AddParticipantInput!){addMatchParticipant(input:$input){id}}`
          : `mutation AddGuestPlayer($input:AddGuestParticipantInput!){addGuestMatchParticipant(input:$input){id}}`,
        { input: { matchId: match.id, ...identity, teamId: teamId || null } },
      ),
    onSuccess: async (_data, identity) => {
      if ("guestName" in identity) setGuestName("");
      else setSearch("");
      setValidation("");
      await refresh();
    },
  });
  const results = useQuery({
    queryKey: ["member-search", debounced],
    queryFn: () =>
      gql<{ members: Member[] }>(
        `query MemberSearch($search:String!){members(search:$search){id username}}`,
        { search: debounced },
      ),
    enabled:
      debounced.length >= 2 &&
      debounced === search.trim() &&
      !add.isPending &&
      !full,
    staleTime: 30000,
  });
  const available =
    results.data?.members.filter(
      (member) => !players.some((player) => player.userId === member.id),
    ) ?? [];
  return (
    <section className="space-y-4 rounded-xl bg-muted p-4">
      <h3>Add a player</h3>
      {!players.some((player) => player.userId === me.id) && (
        <Button
          variant="outline"
          type="button"
          disabled={add.isPending || full}
          onClick={() => add.mutate({ userId: me.id })}
        >
          Add yourself
        </Button>
      )}
      <label className="field">
        Find an existing member
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
          maxLength={40}
          placeholder="Search usernames…"
          disabled={add.isPending || full}
        />
      </label>
      <p className="subtle text-xs">Type at least two characters.</p>
      {search.trim().length >= 2 &&
        !full &&
        (debounced !== search.trim() || results.isPending ? (
          <p className="subtle text-sm">Searching…</p>
        ) : results.error ? (
          <p role="alert" className="error">
            {results.error.message}
          </p>
        ) : available.length ? (
          <ul>
            {available.map((member) => (
              <li key={member.id}>
                <Button
                  variant="outline"
                  type="button"
                  className="my-1 w-full justify-between"
                  disabled={add.isPending}
                  aria-label={`Add member ${member.username}`}
                  onClick={() => add.mutate({ userId: member.id })}
                >
                  {member.username}
                  <Plus size={16} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle text-sm">No matching members to add.</p>
        ))}
      <form
        aria-label="Add a guest player"
        onSubmit={(event) => {
          event.preventDefault();
          const name = guestName.trim();
          if (!name) {
            setValidation("Enter a guest name.");
            return;
          }
          add.mutate({ guestName: name });
        }}
        className="space-y-3"
      >
        <label className="field">
          Guest name
          <input
            value={guestName}
            maxLength={100}
            required
            disabled={add.isPending || full}
            onChange={(event) => setGuestName(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          variant="outline"
          disabled={add.isPending || full}
        >
          <Plus size={16} />
          {add.isPending ? "Adding…" : "Add guest"}
        </Button>
      </form>
      {full && (
        <p className="subtle text-xs">
          The match has reached the 50-player limit.
        </p>
      )}
      {(validation || add.error) && (
        <p role="alert" className="error">
          {validation || add.error?.message}
        </p>
      )}
    </section>
  );
}
