"use client";
import { ReviewerPicker } from "./reviewer-picker";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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
import {
  FeedbackMatchPicker,
  type FeedbackReviewMode,
} from "./feedback-match-picker";
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
  const sourcePath = usePathname();
  function reviewContext() {
    return new URLSearchParams({
      mode: "device",
      returnTo: sourcePath + window.location.search,
    }).toString();
  }
  const [open, setOpen] = useState(false);
  const [reviewer, setReviewer] = useState<Member | null>(null);
  const [matchIds, setMatchIds] = useState<string[]>(
    initialMatch ? [initialMatch.id] : [],
  );
  const [matchRequest, setMatchRequest] = useState(!!initialMatch);
  const [reviewMode, setReviewMode] =
    useState<FeedbackReviewMode>("INDIVIDUAL_MATCHES");
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
        matchRequest &&
        (!matchIds.length ||
          matchIds.some(
            (id) =>
              !available.some(
                (m) =>
                  m.id === id &&
                  m.participants?.some((p) => p.userId === user.data!.me.id),
              ),
          ))
      )
        throw new Error("Select at least one match you participated in.");
      return gql<{
        createGuestFeedbackInvite: { token: string; expiresAt: string };
      }>(
        `mutation Invite($recipientId:ID!,$sportId:ID!,$matchIds:[ID!],$reviewMode:FeedbackReviewMode!,$assignedReviewerId:ID){createGuestFeedbackInvite(recipientId:$recipientId,sportId:$sportId,matchIds:$matchIds,reviewMode:$reviewMode,assignedReviewerId:$assignedReviewerId){token expiresAt}}`,
        {
          recipientId: user.data.me.id,
          sportId: sport.id,
          matchIds: matchRequest ? matchIds : [],
          reviewMode,
          assignedReviewerId: reviewer?.id ?? null,
        },
      );
    },
    onSuccess: ({ createGuestFeedbackInvite: value }, mode) => {
      const path = `/f/${encodeURIComponent(value.token)}`;
      if (mode === "device") {
        setOpen(false);
        router.push(`${path}?${reviewContext()}`);
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
          setMatchIds(initialMatch ? [initialMatch.id] : []);
          setMatchRequest(!!initialMatch);
          setReviewMode("INDIVIDUAL_MATCHES");
          create.reset();
        }}
      >
        <Plus size={17} />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
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
                  router.push(
                    `${new URL(invite.url).pathname}?${reviewContext()}`,
                  )
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
              <div
                role="group"
                aria-label="Feedback context"
                className="flex flex-wrap gap-2"
              >
                <Button
                  variant="outline"
                  aria-pressed={!matchRequest}
                  onClick={() => setMatchRequest(false)}
                >
                  General feedback
                </Button>
                <Button
                  variant="outline"
                  aria-pressed={matchRequest}
                  onClick={() => setMatchRequest(true)}
                >
                  Selected matches
                </Button>
              </div>
              {matchRequest && (
                <>
                  <FeedbackMatchPicker
                    matches={available}
                    selected={matchIds}
                    onChange={setMatchIds}
                    hasMore={matches.hasNextPage}
                    loadingMore={matches.isFetchingNextPage}
                    onLoadMore={() => {
                      void matches.fetchNextPage();
                    }}
                  />
                  <div
                    role="group"
                    aria-label="Match review mode"
                    className="feedback-request-modes"
                  >
                    <Button
                      variant="outline"
                      aria-pressed={reviewMode === "INDIVIDUAL_MATCHES"}
                      onClick={() => setReviewMode("INDIVIDUAL_MATCHES")}
                    >
                      Review each match separately
                    </Button>
                    <Button
                      variant="outline"
                      aria-pressed={reviewMode === "COMBINED_MATCHES"}
                      onClick={() => setReviewMode("COMBINED_MATCHES")}
                    >
                      One review for all matches
                    </Button>
                  </div>
                  <p className="subtle text-sm">
                    {reviewMode === "INDIVIDUAL_MATCHES"
                      ? "Your reviewer will rate each selected match individually. Each match receives its own feedback."
                      : "Your reviewer will provide one overall review covering all selected matches."}
                  </p>
                  <p className="text-sm">
                    {matchIds.length} selected ·{" "}
                    {reviewMode === "INDIVIDUAL_MATCHES"
                      ? matchIds.length * 5
                      : 5}{" "}
                    skill steps
                  </p>
                  {!matchIds.length && (
                    <p role="status" className="subtle">
                      Select at least one match.
                    </p>
                  )}
                </>
              )}
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
                disabled={
                  !sport ||
                  create.isPending ||
                  (matchRequest && !matchIds.length)
                }
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
                disabled={
                  !sport ||
                  create.isPending ||
                  (matchRequest && !matchIds.length)
                }
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
