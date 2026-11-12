"use client";
import { PendingFeedbackApprovals } from "./pending-feedback-approvals";
import { useUser } from "@/lib/hooks";
import { UserAvatar, ErrorState, LoadingSkeleton } from "./common";
import { FeedbackRequestDialog } from "./feedback-request-dialog";
import { AccountVisibilitySwitch } from "./account-visibility-switch";
import { AccountMenu } from "./app-shell";
import { PageHeader } from "./page-header";
export function AccountPage() {
  const user = useUser();
  if (user.isPending) return <LoadingSkeleton />;
  const error = user.error;
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          user.refetch();
        }}
      />
    );
  const me = user.data!.me;
  return (
    <>
      <PageHeader
        title="Your account"
        description="Your player profile and preferences, in one place."
      />
      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            <UserAvatar name={me.username} size="large" />
            <div className="min-w-0">
              <h2 className="break-anywhere text-xl">{me.username}</h2>
              <p className="subtle break-anywhere text-sm">{me.email}</p>
            </div>
          </div>
          <p className="subtle text-xs">
            Member since {new Date(me.createdAt).toLocaleDateString()}
          </p>
          <p className="subtle text-sm">
            Name, email, and photo editing are not available yet.
          </p>
        </section>
        <AccountMenu />
        <section id="feedback-links" className="panel space-y-4">
          <h2>Feedback links</h2>
          <p className="subtle text-sm">
            Create a reusable, 24-hour link for general feedback or one of your
            matches. Expiration appears when your link is ready.
          </p>
          <FeedbackRequestDialog label="Create a feedback link" />
        </section>
        <section className="panel space-y-4">
          <h2>Privacy</h2>
          <p className="subtle text-sm">
            Feedback details are visible to its recipient and registered
            reviewer. Each reviewer chooses whether to allow aggregate analytics
            or future supporting evidence when submitting.
          </p>
          <AccountVisibilitySwitch me={me} />
        </section>
      </div>
      <PendingFeedbackApprovals />
    </>
  );
}
