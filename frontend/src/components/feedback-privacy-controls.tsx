"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "@/lib/api";
import { useUser, useSubmittedFeedback } from "@/lib/hooks";
import type { Feedback, User } from "@/lib/types";
import {
  FeedbackPrivacyNotice,
  PRIVACY_NOTICE_VERSION,
} from "./feedback-privacy";
import { Button } from "./ui/button";

type Purpose =
  | "privateAnalyticsAllowed"
  | "privateCoachingAllowed"
  | "publicAnalyticsAllowed";
export function FeedbackPermissionControls({
  feedback,
  showPublic = false,
}: {
  feedback: Pick<Feedback, "id" | Purpose>;
  showPublic?: boolean;
}) {
  const client = useQueryClient();
  const [overrides, setOverrides] = useState<Partial<Pick<Feedback, Purpose>>>(
    {},
  );
  const values = { ...feedback, ...overrides };
  const change = useMutation({
    mutationFn: async ({
      key,
      allowed,
    }: {
      key: Purpose;
      allowed: boolean;
    }) => {
      await gql(
        `mutation Privacy($input:FeedbackPrivacyInput!){updateFeedbackPrivacy(input:$input){id privateAnalyticsAllowed privateCoachingAllowed publicAnalyticsAllowed}}`,
        {
          input: {
            feedbackId: feedback.id,
            [key]: allowed,
            ...(allowed
              ? { privacyNoticeVersion: PRIVACY_NOTICE_VERSION }
              : {}),
          },
        },
      );
      return { key, allowed };
    },
    onSuccess: ({ key, allowed }) => {
      setOverrides((old) => ({ ...old, [key]: allowed }));
      for (const prefix of [
        "feedback",
        "submitted-feedback",
        "feedback-details",
        "pending-feedback-approvals",
        "approvals",
        "coach-profile",
        "coach-messages",
        "coach-conversations",
        "dashboard",
        "summary",
        "category-feedback",
        "skill-radar",
      ])
        void client.invalidateQueries({ queryKey: [prefix] });
    },
  });
  const checkbox = (key: Purpose, label: string) => (
    <label className="flex items-start gap-3 text-sm font-normal">
      <input
        type="checkbox"
        checked={values[key] === true}
        disabled={change.isPending}
        onChange={(e) => change.mutate({ key, allowed: e.target.checked })}
      />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="space-y-3">
      <FeedbackPrivacyNotice>
        {checkbox(
          "privateAnalyticsAllowed",
          "Allow this review in the recipient’s private performance analytics.",
        )}
        {checkbox(
          "privateCoachingAllowed",
          "Allow OpenAI processing and private coaching evidence. Private analytics permission is also needed for coaching.",
        )}
      </FeedbackPrivacyNotice>
      {showPublic && (
        <details className="rounded-xl border border-border p-4 text-sm">
          <summary>Optional public aggregate sharing</summary>
          <p className="my-3">
            Separate from private coaching. Only statistics with at least 10
            reviews from 5 registered reviewers are returned. This does not
            publish your comments or identity. Thresholds reduce risk but do not
            guarantee anonymity.
          </p>
          {checkbox(
            "publicAnalyticsAllowed",
            "Opt in to public aggregate analytics (optional).",
          )}
        </details>
      )}
      {change.error && (
        <p role="alert" className="error">
          {change.error.message}
        </p>
      )}
    </div>
  );
}
export function AccountProcessingPrivacy() {
  const user = useUser();
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      gql<{ updatePrivateCoachingPreference: User }>(
        `mutation CoachingPrivacy($enabled:Boolean!){updatePrivateCoachingPreference(enabled:$enabled){id aiCoachingEnabled}}`,
        { enabled },
      ),
    onSuccess: (data) => {
      client.setQueryData<{ me: User }>(["me"], (old) =>
        old
          ? { me: { ...old.me, ...data.updatePrivateCoachingPreference } }
          : old,
      );
      void user.refetch();
      for (const prefix of [
        "coach-profile",
        "coach-messages",
        "coach-conversations",
      ])
        client.removeQueries({ queryKey: [prefix] });
    },
  });
  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={user.data?.me.aiCoachingEnabled !== false}
          disabled={toggle.isPending || !user.data}
          onChange={(e) => toggle.mutate(e.target.checked)}
        />
        <span>
          Enable my private AI coaching. Disabling removes derived
          observations/vectors and saved Coach answer content; numerical ratings
          remain. Re-enabling does not override reviewer permissions.
        </span>
      </label>
      {toggle.error && <p role="alert">{toggle.error.message}</p>}
      <Link className="underline" href="/privacy/feedback">
        Manage permissions for feedback you wrote
      </Link>
    </div>
  );
}
export function FeedbackPrivacySettings() {
  const client = useQueryClient();
  const user = useUser();
  const rows = useSubmittedFeedback(!!user.data);
  const [token, setToken] = useState("");
  const receipt = useSyncExternalStore(subscribeReceipt, readReceipt, () => "");
  const activeToken = token || receipt;
  const withdraw = useMutation({
    mutationFn: () =>
      gql(
        `mutation Withdraw($token:String!){withdrawGuestFeedbackPrivacy(token:$token)}`,
        { token: activeToken },
      ),
    onSuccess: () => {
      setToken("");
      for (const prefix of [
        "coach-profile",
        "coach-messages",
        "coach-conversations",
        "feedback",
        "summary",
        "dashboard",
      ])
        client.removeQueries({ queryKey: [prefix] });
      window.history.replaceState(null, "", window.location.pathname);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    },
  });
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <h1 className="text-2xl">Feedback privacy</h1>
      <Link className="underline" href="/privacy">
        Read the privacy notice
      </Link>
      <section className="panel space-y-3">
        <h2>Guest withdrawal</h2>
        <p className="text-sm">
          Paste the private receipt from your submission, or open its withdrawal
          link. This withdraws private analytics, external AI processing and
          public aggregates without deleting the original review. Keep it
          private; it expires after one year.
        </p>
        <label className="block text-sm">
          Private withdrawal receipt
          <input
            className="mt-2 w-full"
            type="password"
            autoComplete="off"
            value={activeToken}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <Button
          disabled={!activeToken || withdraw.isPending}
          onClick={() => withdraw.mutate()}
        >
          Withdraw processing permissions
        </Button>
        {withdraw.isSuccess && (
          <p role="status">Processing permissions withdrawn.</p>
        )}
        {withdraw.error && <p role="alert">{withdraw.error.message}</p>}
      </section>
      {!user.data ? (
        <p>
          For registered reviews,{" "}
          <Link className="underline" href="/login">
            sign in
          </Link>{" "}
          to change permissions.
        </p>
      ) : (
        <section className="space-y-5">
          <h2>Reviews you wrote or were assigned</h2>
          {rows.isPending && <p role="status">Loading your reviews…</p>}
          {rows.error && <p role="alert">{rows.error.message}</p>}
          {rows.data?.rows.map((f) => (
            <article key={f.id} className="panel space-y-3">
              <h3>
                Review from {new Date(f.createdAt).toLocaleDateString()} ·{" "}
                {f.status.toLowerCase()}
              </h3>
              <p className="text-sm">
                These choices do not approve or republish a review.
              </p>
              <FeedbackPermissionControls feedback={f} showPublic />
            </article>
          ))}
          {rows.hasNextPage && (
            <Button
              disabled={rows.isFetchingNextPage}
              onClick={() => void rows.fetchNextPage()}
            >
              Load more reviews
            </Button>
          )}
          {rows.data?.rows.length === 0 && <p>No submitted reviews.</p>}
        </section>
      )}
      <Link className="underline" href="/account">
        Account privacy settings
      </Link>
    </main>
  );
}

function subscribeReceipt(change: () => void) {
  window.addEventListener("hashchange", change);
  return () => window.removeEventListener("hashchange", change);
}
function readReceipt() {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
}
