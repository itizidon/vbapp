import { decodeInviteToken } from "@/lib/invites";
import { FeedbackSubmissionForm } from "@/components/feedback-form";
import { Brand, ThemeToggle } from "@/components/app-shell";
export const metadata = {
  title: "Leave feedback",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claims = decodeInviteToken(token);
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-6">
        <Brand />
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-12 pt-4">
        {claims ? (
          <FeedbackSubmissionForm
            recipientId={claims.recipientId}
            sportId={claims.sportId}
            scopedMatchId={claims.matchId}
            token={token}
          />
        ) : (
          <section className="panel">
            <h1>This invitation is unavailable.</h1>
            <p className="subtle mt-4">
              The link is invalid or has expired. Ask the player for a new
              feedback link.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
