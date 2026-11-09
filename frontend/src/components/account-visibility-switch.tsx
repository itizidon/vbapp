"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql, USER_FIELDS } from "@/lib/api";
import { notifyAuthChanged } from "@/lib/auth-session";
import type { User } from "@/lib/types";
export function AccountVisibilitySwitch({ me }: { me: User }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (isPublic: boolean) =>
      gql<{ updateAccountVisibility: User }>(
        `mutation UpdateAccountVisibility($isPublic:Boolean!){updateAccountVisibility(isPublic:$isPublic){${USER_FIELDS}}}`,
        { isPublic },
      ),
    onSuccess: async (data) => {
      client.setQueryData(["me"], { me: data.updateAccountVisibility });
      notifyAuthChanged();
      await Promise.all([
        client.invalidateQueries({ queryKey: ["player-profile", me.id] }),
        client.invalidateQueries({ queryKey: ["player-matches", me.id] }),
        client.invalidateQueries({ queryKey: ["player-search"] }),
        client.invalidateQueries({ queryKey: ["player-suggestions"] }),
      ]);
    },
  });
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold">
            {me.isPublic ? "Public account" : "Private account"}
          </p>
          <p
            id="account-visibility-description"
            className="subtle mt-1 text-xs"
          >
            Everyone can find your username. Public accounts share match
            history, teams, players, and scores. Feedback stays private.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Public account"
          aria-checked={!!me.isPublic}
          aria-describedby="account-visibility-description"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(!me.isPublic)}
          className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors disabled:opacity-50 ${me.isPublic ? "bg-primary" : "bg-muted-foreground"}`}
        >
          <span
            className={`size-5 rounded-full bg-white shadow transition-transform ${me.isPublic ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </div>
      {mutation.isPending && (
        <p role="status" className="subtle text-xs">
          Saving visibility…
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="subtle text-xs">
          Account visibility saved.
        </p>
      )}
      {mutation.error && (
        <p role="alert" className="error">
          {mutation.error.message}
        </p>
      )}
    </div>
  );
}
