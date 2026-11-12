"use client";
import { ReviewerPicker } from "./reviewer-picker";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  Copy,
  Check,
  Share2,
  Plus,
  Smartphone,
  Link as LinkIcon,
} from "lucide-react";
import { useUser, useCatalog, useMatches } from "@/lib/hooks";
import { recipientMatches } from "@/lib/matches";
import { gql } from "@/lib/api";
import type { Match, Member } from "@/lib/types";
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
      await navigator.share({ title: "Leave me feedback on bvbtips", url });
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
      <figure className="mx-auto max-w-64 space-y-2">
        <div className="rounded-xl bg-white p-2">
          <QRCodeSVG
            value={url}
            size={256}
            level="M"
            marginSize={4}
            role="img"
            aria-label="Feedback link QR code"
            className="h-auto w-full"
          />
        </div>
        <figcaption className="subtle text-center text-xs">
          Scan to open the feedback form.
        </figcaption>
      </figure>
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
        Reusable for 24 hours · expires {new Date(expiresAt).toLocaleString()}
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reviewer, setReviewer] = useState<Member | null>(null);
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
    mutationFn: (_mode: "share" | "device") => {
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
        `mutation Invite($recipientId:ID!,$sportId:ID!,$matchId:ID,$assignedReviewerId:ID){createGuestFeedbackInvite(recipientId:$recipientId,sportId:$sportId,matchId:$matchId,assignedReviewerId:$assignedReviewerId){token expiresAt}}`,
        {
          recipientId: user.data.me.id,
          sportId: sport.id,
          matchId: matchId || null,
          assignedReviewerId: reviewer?.id ?? null,
        },
      );
    },
    onSuccess: ({ createGuestFeedbackInvite: value }, mode) => {
      const path = `/f/${encodeURIComponent(value.token)}`;
      if (mode === "device") {
        setOpen(false);
        router.push(`${path}?mode=device`);
      } else {
        setInvite({
          url: `${window.location.origin}${path}`,
          expiresAt: value.expiresAt,
        });
      }
    },
  });
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          setInvite(null);
          setReviewer(null);
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
            Create a link to share, or let someone leave feedback on this
            device. No account is needed to review.
          </DialogDescription>
          {invite ? (
            <div className="space-y-4">
              <FeedbackLinkShare {...invite} />
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  router.push(`${new URL(invite.url).pathname}?mode=device`)
                }
              >
                <Smartphone size={16} />
                Review on this device
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <ReviewerPicker
                recipientId={user.data?.me.id ?? ""}
                value={reviewer}
                onChange={setReviewer}
                disabled={create.isPending}
              />
              <MatchSelector
                matches={available}
                value={matchId}
                onChange={setMatchId}
                locked={!!initialMatch}
                scopedMatchId={initialMatch?.id}
                hasMore={!initialMatch && matches.hasNextPage}
                loadingMore={matches.isFetchingNextPage}
                onLoadMore={() => matches.fetchNextPage()}
              />
              {!initialMatch && matches.isPending && (
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
                The link is restricted to your choice and can be used by
                multiple submissions for 24 hours. Assigned submissions wait for
                the designated reviewer’s approval.
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
                onClick={() => create.mutate("share")}
              >
                {create.isPending && create.variables === "share" ? (
                  <Pending label="Creating link…" />
                ) : (
                  <>
                    <LinkIcon size={16} />
                    Create feedback link
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={!sport || create.isPending}
                onClick={() => create.mutate("device")}
              >
                {create.isPending && create.variables === "device" ? (
                  <Pending label="Opening guest review…" />
                ) : (
                  <>
                    <Smartphone size={16} />
                    Review on this device
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
