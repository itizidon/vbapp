"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, UserRound } from "lucide-react";
import { gql } from "@/lib/api";
import type {
  DraftGuest,
  DraftTeam,
  TeamAssignments,
} from "@/lib/match-roster";
import type { Member } from "@/lib/types";
import { Button } from "./ui/button";
type PickerProps = {
  organizer?: Member;
  members: Member[];
  guests: DraftGuest[];
  onMembersChange: (members: Member[]) => void;
  onGuestsChange: (guests: DraftGuest[]) => void;
  teams: DraftTeam[];
  assignments: TeamAssignments;
  onTeamChange: (playerKey: string, teamKey: string) => void;
  onScoreChange: (teamKey: string, score: string) => void;
  disabled?: boolean;
};
export function ParticipantPicker(props: PickerProps) {
  return (
    <div className="space-y-4">
      <p className="subtle text-xs">
        Add members or guests directly to each team. You start on Team 1.
      </p>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {props.teams.map((team) => (
          <TeamPicker key={team.key} {...props} team={team} />
        ))}
      </div>
    </div>
  );
}
function TeamPicker({
  organizer,
  members,
  guests,
  onMembersChange,
  onGuestsChange,
  teams,
  team,
  assignments,
  onTeamChange,
  onScoreChange,
  disabled = false,
}: PickerProps & { team: DraftTeam }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useQuery({
    queryKey: ["member-search", debounced],
    queryFn: () =>
      gql<{ members: Member[] }>(
        `query MemberSearch($search:String!){members(search:$search){id username}}`,
        { search: debounced },
      ),
    enabled: !disabled && debounced.length >= 2 && debounced === search.trim(),
    staleTime: 30000,
  });
  const full = members.length + guests.length + (organizer ? 1 : 0) >= 50;
  const available =
    results.data?.members.filter(
      (member) =>
        member.id !== organizer?.id &&
        !members.some((selected) => selected.id === member.id),
    ) ?? [];
  function addGuest() {
    const name = guestName.trim();
    if (!name) {
      setError("Enter a guest name.");
      return;
    }
    if (full) {
      setError("A match can include up to 50 players.");
      return;
    }
    const key = crypto.randomUUID();
    onGuestsChange([...guests, { key, name }]);
    onTeamChange(`guest:${key}`, team.key);
    setGuestName("");
    setError("");
  }
  const otherTeam = teams.find((item) => item.key !== team.key);
  const selected = [
    ...(organizer
      ? [
          {
            key: `member:${organizer.id}`,
            name: `${organizer.username} (you)`,
            kind: "organizer",
            id: organizer.id,
          },
        ]
      : []),
    ...members.map((member) => ({
      key: `member:${member.id}`,
      name: member.username,
      kind: "member",
      id: member.id,
    })),
    ...guests.map((guest) => ({
      key: `guest:${guest.key}`,
      name: guest.name,
      kind: "guest",
      id: guest.key,
    })),
  ].filter((player) => assignments[player.key] === team.key);
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-4 rounded-xl border border-border p-4"
    >
      <legend className="px-1 text-base font-semibold">{team.name}</legend>
      <label className="field">
        {team.name} score
        <input
          type="number"
          min={0}
          max={2147483647}
          step={1}
          placeholder="No score"
          value={team.score ?? ""}
          onChange={(event) => onScoreChange(team.key, event.target.value)}
        />
      </label>
      <ul aria-label={`${team.name} players`} className="space-y-2">
        {selected.map((player) => (
          <li key={player.key} className="space-y-2 rounded-lg bg-muted p-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <UserRound size={15} className="shrink-0" />
              <span className="break-anywhere min-w-0 font-semibold">
                {player.name}
              </span>
              {player.kind !== "organizer" && (
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto size-11 shrink-0 px-0"
                  aria-label={`Remove ${player.kind} ${player.name}`}
                  onClick={() =>
                    player.kind === "member"
                      ? onMembersChange(
                          members.filter((item) => item.id !== player.id),
                        )
                      : onGuestsChange(
                          guests.filter((item) => item.key !== player.id),
                        )
                  }
                >
                  <X size={16} />
                </Button>
              )}
            </div>
            {otherTeam && (
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 whitespace-normal text-xs"
                aria-label={`Move ${player.name} to ${otherTeam.name}`}
                onClick={() => onTeamChange(player.key, otherTeam.key)}
              >
                Move to {otherTeam.name}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!selected.length && <p className="subtle text-sm">No players yet.</p>}
      <div className="space-y-2">
        <label className="field">
          Find an existing member
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            autoComplete="off"
            placeholder="Search usernames…"
            maxLength={40}
            disabled={full || disabled}
          />
        </label>
        <p className="subtle text-xs">Type at least two characters.</p>
        {search.trim().length >= 2 && !full && (
          <div className="rounded-lg border border-border p-2">
            {search.trim() !== debounced ||
            results.isPending ||
            results.isFetching ? (
              <p role="status" className="subtle p-2 text-sm">
                Searching members…
              </p>
            ) : results.error ? (
              <div role="alert" className="error p-2">
                {results.error.message}
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2"
                  onClick={() => results.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : available.length ? (
              <ul aria-label="Member search results">
                {available.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
                      aria-label={`Add member ${member.username}`}
                      onClick={() => {
                        onMembersChange([...members, member]);
                        onTeamChange(`member:${member.id}`, team.key);
                        setSearch("");
                      }}
                    >
                      <span className="break-anywhere">{member.username}</span>
                      <Plus size={16} className="shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="subtle p-2 text-sm">No matching members to add.</p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="field min-w-0 flex-1">
          Guest name
          <input
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addGuest();
              }
            }}
            autoComplete="off"
            placeholder="Enter a guest’s name"
            maxLength={100}
            disabled={full || disabled}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={full || disabled || !guestName.trim()}
          onClick={addGuest}
        >
          <Plus size={16} />
          Add guest
        </Button>
      </div>
      {full && (
        <p role="status" className="subtle text-xs">
          This match has reached the 50-player limit.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
