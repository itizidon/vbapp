"use client";
import { useCatalog, useSummary, useUser } from "@/lib/hooks";
import { UserAvatar, ErrorState, LoadingSkeleton } from "./common";
import { SelfSkillRatings, InternalRatingCard } from "./profile-skill-ratings";
import { AssessmentEditor } from "./assessment-editor";
import { FeedbackRequestDialog } from "./feedback-request-dialog";
import { AccountVisibilitySwitch } from "./account-visibility-switch";
import { AccountMenu } from "./app-shell";
import { PageHeader } from "./page-header";
export function AccountPage() {
  const user = useUser();
  const catalog = useCatalog();
  const summary = useSummary(user.data?.me.id);
  if (user.isPending || catalog.isPending || summary.isPending)
    return <LoadingSkeleton />;
  const error = user.error ?? catalog.error ?? summary.error;
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          user.refetch();
          catalog.refetch();
          summary.refetch();
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
            Name, email, and photo editing are not available yet. You can update
            your playing level and self-assessment below.
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
      {catalog.data?.sports.map((sport) => {
        const assessment = summary.data?.mySelfAssessments.find(
          (a) => a.sportId === sport.id,
        );
        return (
          <div
            key={sport.id}
            className="mt-5 grid min-w-0 gap-5 lg:grid-cols-2"
          >
            <section className="panel min-w-0" aria-label="Self-assessment">
              <h2>Self-assessment</h2>
              <p className="subtle mb-5 mt-1 text-sm">
                Your own view of your game.
              </p>
              <h3 className="mb-4">
                {sport.name} · {assessment?.overallLevel ?? "Unrated"}
              </h3>
              <SelfSkillRatings sport={sport} assessment={assessment} />
              <AssessmentEditor sport={sport} assessment={assessment} />
            </section>
            <InternalRatingCard
              userId={me.id}
              sport={sport}
              assessment={assessment}
            />
          </div>
        );
      })}
    </>
  );
}
