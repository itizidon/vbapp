"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Plus, X } from "lucide-react";
import { useCatalog, useUser } from "@/lib/hooks";
import { gql } from "@/lib/api";
import { MATCH_FIELDS } from "@/lib/matches";
import {
  buildMatchRoster,
  initialMatchTeams,
  nextTeamName,
  type DraftGuest,
  type DraftTeam,
  type TeamAssignments,
} from "@/lib/match-roster";
import { localDateTimeValue } from "@/lib/date-time";
import type { Member, Match } from "@/lib/types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { ErrorState, Pending } from "./common";
import { ParticipantPicker } from "./participant-picker";
export function CreateMatchDialog() {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [guests, setGuests] = useState<DraftGuest[]>([]);
  const [teams, setTeams] = useState<DraftTeam[]>(initialMatchTeams);
  const [assignments, setAssignments] = useState<TeamAssignments>({});
  const locked = useRef(false);
  const catalog = useCatalog();
  const user = useUser();
  const router = useRouter();
  const client = useQueryClient();
  const form = useForm<{ description: string; playedAt: string }>({
    defaultValues: { description: "", playedAt: "" },
  });
  const mutation = useMutation({
    mutationFn: async (input: { description: string; playedAt: string }) => {
      const sport = catalog.data?.sports[0];
      if (!sport || !user.data)
        throw new Error("Beach Volleyball is unavailable. Try again.");
      const response = await gql<{ createMatch: Match }>(
        `mutation CreateMatch($input:CreateMatchInput){createMatch(input:$input){${MATCH_FIELDS}}}`,
        {
          input: {
            sportId: sport.id,
            description: input.description.trim() || undefined,
            playedAt: input.playedAt
              ? new Date(input.playedAt).toISOString()
              : undefined,
            status: input.playedAt ? "SCHEDULED" : "DRAFT",
            ...buildMatchRoster({
              organizerId: user.data.me.id,
              members,
              guests,
              teams,
              assignments,
            }),
          },
        },
      );
      return response.createMatch;
    },
    onSuccess: (match) => {
      client.invalidateQueries({ queryKey: ["matches"] });
      client.invalidateQueries({ queryKey: ["match", match.id] });
      setOpen(false);
      router.push(`/matches/${match.id}`);
    },
    onError: () => {
      locked.current = false;
    },
  });
  return (
    <>
      <Button
        onClick={() => {
          locked.current = false;
          mutation.reset();
          form.reset({ description: "", playedAt: localDateTimeValue() });
          setMembers([]);
          setGuests([]);
          setTeams(initialMatchTeams());
          setAssignments(
            user.data ? { [`member:${user.data.me.id}`]: "team-1" } : {},
          );
          setOpen(true);
        }}
      >
        <Plus size={17} />
        Create match
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle className="pr-9 text-xl font-bold">
            Create a match
          </DialogTitle>
          <DialogDescription className="subtle mb-6 mt-2 text-sm">
            Choose when you’re playing and who’s joining. You’ll be the
            organizer and a player.
          </DialogDescription>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              void form.handleSubmit((input) => {
                if (locked.current) return;
                locked.current = true;
                mutation.mutate(input);
              })(event);
            }}
          >
            <label className="field">
              Match name or description{" "}
              <span className="subtle font-normal">(optional)</span>
              <input
                placeholder="Sunday beach session"
                maxLength={500}
                disabled={mutation.isPending}
                {...form.register("description")}
              />
            </label>
            <label className="field">
              Date and time{" "}
              <span className="subtle font-normal">(optional)</span>
              <input
                type="datetime-local"
                disabled={mutation.isPending}
                {...form.register("playedAt")}
              />
            </label>
            <fieldset
              disabled={mutation.isPending}
              className="space-y-3 rounded-xl border border-border p-4"
            >
              <legend className="px-1 text-base font-semibold">Teams</legend>
              <p className="subtle text-xs">
                Name your teams, then choose a team for each player below.
              </p>
              {teams.map((team, index) => (
                <div key={team.key} className="flex min-w-0 items-end gap-2">
                  <label className="field min-w-0 flex-1">
                    Team {index + 1} name
                    <input
                      maxLength={100}
                      value={team.name}
                      onChange={(event) =>
                        setTeams((previous) =>
                          previous.map((item) =>
                            item.key === team.key
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    className="size-11 shrink-0 px-0"
                    aria-label={`Remove team ${team.name.trim() || index + 1}`}
                    onClick={() => {
                      setTeams((previous) =>
                        previous.filter((item) => item.key !== team.key),
                      );
                      setAssignments((previous) =>
                        Object.fromEntries(
                          Object.entries(previous).filter(
                            ([, value]) => value !== team.key,
                          ),
                        ),
                      );
                    }}
                  >
                    <X size={16} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={teams.length >= 50}
                onClick={() =>
                  setTeams((previous) => [
                    ...previous,
                    {
                      key: crypto.randomUUID(),
                      name: nextTeamName(previous),
                    },
                  ])
                }
              >
                <Plus size={16} />
                Add team
              </Button>
            </fieldset>
            <ParticipantPicker
              organizer={user.data?.me}
              members={members}
              guests={guests}
              onMembersChange={setMembers}
              onGuestsChange={setGuests}
              disabled={mutation.isPending}
              teams={teams}
              assignments={assignments}
              onTeamChange={(playerKey, teamKey) =>
                setAssignments((previous) => ({
                  ...previous,
                  [playerKey]: teamKey,
                }))
              }
            />
            {catalog.error && (
              <ErrorState
                error={catalog.error}
                retry={() => catalog.refetch()}
              />
            )}{" "}
            {mutation.error && (
              <p role="alert" className="error">
                {mutation.error.message}
              </p>
            )}
            <Button
              className="w-full"
              disabled={!catalog.data?.sports.length || mutation.isPending}
            >
              {mutation.isPending ? (
                <Pending label="Creating match…" />
              ) : (
                "Create match"
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
