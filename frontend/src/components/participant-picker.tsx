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
export function ParticipantPicker({
  organizer,
  members,
  guests,
  onMembersChange,
  onGuestsChange,
  disabled = false,
  teams,
  assignments,
  onTeamChange,
}: {
  organizer?: Member;
  members: Member[];
  guests: DraftGuest[];
  onMembersChange: (members: Member[]) => void;
  onGuestsChange: (guests: DraftGuest[]) => void;
  teams: DraftTeam[];
  assignments: TeamAssignments;
  onTeamChange: (playerKey: string, teamKey: string) => void;
  disabled?: boolean;
}) {
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
    onGuestsChange([...guests, { key: crypto.randomUUID(), name }]);
    setGuestName("");
    setError("");
  }
  return (
    <fieldset
      disabled={disabled}
      className="space-y-4 rounded-xl border border-border p-4"
    >
      <legend className="px-1 text-base font-semibold">Players</legend>
      <p className="subtle text-xs">
        Add members by username or guests by name. You’re included
        automatically.
      </p>
      <ul aria-label="Selected players" className="space-y-3">
        {organizer && (
          <li className="space-y-2 rounded-lg bg-muted p-3">
            <div className="flex items-center gap-2 text-sm">
              <UserRound size={15} />
              <span className="break-anywhere font-semibold">
                {organizer.username} (you)
              </span>
            </div>
            <PlayerTeamSelect
              name={organizer.username}
              playerKey={`member:${organizer.id}`}
              teams={teams}
              assignments={assignments}
              onTeamChange={onTeamChange}
            />
          </li>
        )}
        {members.map((member) => (
          <li key={member.id} className="space-y-2 rounded-lg bg-accent p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="break-anywhere">
                {member.username}{" "}
                <span className="subtle text-xs">· member</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                className="size-11 shrink-0 px-0"
                aria-label={`Remove member ${member.username}`}
                onClick={() =>
                  onMembersChange(
                    members.filter((item) => item.id !== member.id),
                  )
                }
              >
                <X size={16} />
              </Button>
            </div>
            <PlayerTeamSelect
              name={member.username}
              playerKey={`member:${member.id}`}
              teams={teams}
              assignments={assignments}
              onTeamChange={onTeamChange}
            />
          </li>
        ))}
        {guests.map((guest) => (
          <li key={guest.key} className="space-y-2 rounded-lg bg-muted p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="break-anywhere">
                {guest.name} <span className="subtle text-xs">· guest</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                className="size-11 shrink-0 px-0"
                aria-label={`Remove guest ${guest.name}`}
                onClick={() =>
                  onGuestsChange(
                    guests.filter((item) => item.key !== guest.key),
                  )
                }
              >
                <X size={16} />
              </Button>
            </div>
            <PlayerTeamSelect
              name={guest.name}
              playerKey={`guest:${guest.key}`}
              teams={teams}
              assignments={assignments}
              onTeamChange={onTeamChange}
            />
          </li>
        ))}
      </ul>
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

function PlayerTeamSelect({
  name,
  playerKey,
  teams,
  assignments,
  onTeamChange,
}: {
  name: string;
  playerKey: string;
  teams: DraftTeam[];
  assignments: TeamAssignments;
  onTeamChange: (playerKey: string, teamKey: string) => void;
}) {
  return (
    <label className="field">
      Team for {name}
      <select
        value={assignments[playerKey] ?? ""}
        onChange={(event) => onTeamChange(playerKey, event.target.value)}
      >
        <option value="">Unassigned</option>
        {teams.map((team, index) => (
          <option key={team.key} value={team.key}>
            {team.name.trim() || `Team ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
