"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Plus } from "lucide-react";
import { useCatalog, useUser } from "@/lib/hooks";
import { gql } from "@/lib/api";
import { MATCH_FIELDS } from "@/lib/matches";
import {
  buildMatchRoster,
  initialMatchTeams,
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
  const [navigating, startTransition] = useTransition();
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
      client.setQueryData(["match", match.id], { match });
      void client.invalidateQueries({
        queryKey: ["matches"],
        refetchType: "none",
      });
      startTransition(() => router.push(`/matches/${match.id}`));
    },
    onError: () => {
      locked.current = false;
    },
  });
  const busy = mutation.isPending || mutation.isSuccess || navigating;
  return (
    <>
      <Button
        disabled={busy}
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
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="lg:max-w-4xl lg:p-8">
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
                disabled={busy}
                {...form.register("description")}
              />
            </label>
            <label className="field">
              Date and time{" "}
              <span className="subtle font-normal">(optional)</span>
              <input
                type="datetime-local"
                disabled={busy}
                {...form.register("playedAt")}
              />
            </label>
            <ParticipantPicker
              organizer={user.data?.me}
              members={members}
              guests={guests}
              onMembersChange={setMembers}
              onGuestsChange={setGuests}
              disabled={busy}
              teams={teams}
              assignments={assignments}
              onScoreChange={(teamKey, score) =>
                setTeams((previous) =>
                  previous.map((team) =>
                    team.key === teamKey ? { ...team, score } : team,
                  ),
                )
              }
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
              disabled={!catalog.data?.sports.length || busy}
            >
              {busy ? (
                <Pending
                  label={
                    mutation.isPending ? "Creating match…" : "Opening match…"
                  }
                />
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
