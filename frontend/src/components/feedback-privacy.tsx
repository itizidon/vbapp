"use client";
import Link from "next/link";
import type { ReactNode } from "react";
export const PRIVACY_NOTICE_VERSION = "feedback-privacy-v1";
export function FeedbackPrivacyNotice({
  children,
  assigned = false,
}: {
  children?: ReactNode;
  assigned?: boolean;
}) {
  return (
    <section
      aria-label="How your feedback is used"
      className="rounded-xl border border-border p-4 space-y-3 text-sm"
    >
      <h3 className="font-semibold">How your feedback is used</h3>
      <p>
        If you opt in, your feedback helps this player through private analytics
        and AI coaching. Comments and observations may be sent to OpenAI.
        Reviewer account details are not intentionally included in AI prompts.
        Avoid adding names or contact details to comments.
      </p>
      <p>
        Submitting feedback does not make comments public or opt you into public
        aggregates, advertising, unrelated research, or model training by
        BVBTips. The recipient and registered reviewer can still see the
        original feedback.
      </p>
      {assigned && (
        <p>
          The assigned reviewer chooses processing permissions in their account.
          Approval and private AI permission are separate choices.
        </p>
      )}
      {children}
      <p>
        <Link
          className="underline"
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy notice and withdrawal options
        </Link>
      </p>
    </section>
  );
}
export function GuestPrivacyReceipts({ result }: { result: unknown }) {
  const data = result as Record<string, unknown> | undefined;
  const rows = Array.isArray(data?.submitFeedbackRequest)
    ? data.submitFeedbackRequest
    : [data?.submitGuestFeedback];
  const tokens = rows.filter(
    (r): r is { privacyWithdrawalToken: string } =>
      !!r &&
      typeof r === "object" &&
      "privacyWithdrawalToken" in r &&
      typeof r.privacyWithdrawalToken === "string",
  );
  if (!tokens.length) return null;
  return (
    <section
      className="mt-4 space-y-2 text-sm"
      aria-label="Guest privacy receipts"
    >
      <p>
        Save your private withdrawal link before handing this device to another
        reviewer. Anyone with the link can withdraw processing permissions; it
        cannot read your feedback. It expires after one year.
      </p>
      {tokens.map((r, i) => (
        <p key={r.privacyWithdrawalToken}>
          <Link
            className="underline"
            href={`/privacy/feedback#${r.privacyWithdrawalToken}`}
          >
            Manage privacy for review {i + 1}
          </Link>
        </p>
      ))}
    </section>
  );
}
