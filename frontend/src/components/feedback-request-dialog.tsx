"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, Check, Share2, Plus, Link as LinkIcon } from "lucide-react";
import { useUser, useCatalog, useMatches } from "@/lib/hooks";
import { recipientMatches } from "@/lib/matches";
import { gql } from "@/lib/api";
import type { Match } from "@/lib/types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { MatchSelector } from "./match-selector";
import { ErrorState, Pending } from "./common";
export function FeedbackLinkShare({
  url,
  expiresAt,
}: {
  url: string;
  expiresAt: string;
}) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setMessage("Link copied.");
    } catch {
      setMessage("Select the link below and copy it manually.");
    }
  }
  async function share() {
    try {
      await navigator.share({ title: "Leave me feedback on Courtside", url });
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        setMessage("Sharing failed. You can copy the link instead.");
    }
  }
  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-accent p-4">
      <div className="flex items-center gap-2 font-semibold text-primary">
        <Check size={18} />
        Your link is ready
      </div>
      <label className="field">
        Feedback link
        <input
          value={url}
          readOnly
          onFocus={(event) => event.target.select()}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}Copy link
        </Button>
        {typeof navigator !== "undefined" &&
          typeof navigator.share === "function" && (
            <Button variant="outline" type="button" onClick={share}>
              <Share2 size={16} />
              Share
            </Button>
          )}
      </div>
      <p className="subtle text-xs">
        Guest link: single use · expires {new Date(expiresAt).toLocaleString()}
      </p>
      <p role="status" className="text-xs">
        {message}
      </p>
    </div>
  );
}
export function FeedbackRequestDialog({
  initialMatch,
  label = "Request feedback",
}: {
  initialMatch?: Match;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [matchId, setMatchId] = useState(initialMatch?.id ?? "");
  const [invite, setInvite] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  const user = useUser();
  const catalog = useCatalog();
  const matches = useMatches(open && !!user.data);
  const ownMatches = recipientMatches(
    matches.data?.rows ?? [],
    user.data?.me.id ?? "",
  );
  const available =
    initialMatch && !ownMatches.some((m) => m.id === initialMatch.id)
      ? [initialMatch, ...ownMatches]
      : ownMatches;
  const sport = catalog.data?.sports[0];
  const create = useMutation({
    mutationFn: () => {
      if (!sport || !user.data)
        throw new Error(
          "Beach Volleyball is unavailable. Try again after the catalog loads.",
        );
      if (
        matchId &&
        !available.some(
          (m) =>
            m.id === matchId &&
            m.participants?.some((p) => p.userId === user.data!.me.id),
        )
      )
        throw new Error("You must be a participant in the selected match.");
      return gql<{
        createGuestFeedbackInvite: { token: string; expiresAt: string };
      }>(
        `mutation Invite($recipientId:ID!,$sportId:ID!,$matchId:ID){createGuestFeedbackInvite(recipientId:$recipientId,sportId:$sportId,matchId:$matchId){token expiresAt}}`,
        {
          recipientId: user.data.me.id,
          sportId: sport.id,
          matchId: matchId || null,
        },
      );
    },
    onSuccess: ({ createGuestFeedbackInvite: value }) =>
      setInvite({
        url: `${window.location.origin}/f/${encodeURIComponent(value.token)}`,
        expiresAt: value.expiresAt,
      }),
  });
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          setInvite(null);
          setMatchId(initialMatch?.id ?? "");
          create.reset();
        }}
      >
        <Plus size={17} />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="pr-9 text-xl font-bold">
            Request feedback
          </DialogTitle>
          <DialogDescription className="subtle mb-6 mt-2 text-sm">
            Share a personal link with another player. They can leave feedback
            without creating an account.
          </DialogDescription>
          {invite ? (
            <FeedbackLinkShare {...invite} />
          ) : (
            <div className="space-y-5">
              <MatchSelector
                matches={available}
                value={matchId}
                onChange={setMatchId}
                hasMore={matches.hasNextPage}
                loadingMore={matches.isFetchingNextPage}
                onLoadMore={() => matches.fetchNextPage()}
              />
              {matches.isPending && (
                <p className="subtle text-xs">
                  Loading your matches. You can still request general feedback.
                </p>
              )}
              {matches.error && (
                <ErrorState
                  error={matches.error}
                  retry={() => matches.refetch()}
                />
              )}
              <p className="subtle text-xs">
                The link is restricted to your choice. Create a separate link
                for each reviewer.
              </p>
              {catalog.error && (
                <ErrorState
                  error={catalog.error}
                  retry={() => catalog.refetch()}
                />
              )}{" "}
              {create.error && (
                <p role="alert" className="error">
                  {create.error.message}
                </p>
              )}
              <Button
                className="w-full"
                disabled={!sport || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? (
                  <Pending label="Creating link…" />
                ) : (
                  <>
                    <LinkIcon size={16} />
                    Create feedback link
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
