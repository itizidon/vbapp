"use client";
import { useRef, useState, useId, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Send, ArrowLeft } from "lucide-react";
import { useCatalog, useUser, useMatches, useMatch } from "@/lib/hooks";
import { authHref } from "@/lib/navigation";
import { gql, ApiError } from "@/lib/api";
import { recipientMatches } from "@/lib/matches";
import { feedbackSchema, validateRatings } from "@/lib/validation";
import type { z } from "zod";
import { InvitedMatchPreview } from "./invited-match-preview";
import type { InvitedMatch } from "@/lib/invites";
import type { Sport, Skill, Member } from "@/lib/types";
import { Button } from "./ui/button";
import {
  RatingStars,
  LoadingSkeleton,
  ErrorState,
  Pending,
  EmptyState,
} from "./common";
import { ReviewerPicker } from "./reviewer-picker";
import { MatchSelector } from "./match-selector";
import {
  feedbackSteps,
  feedbackRatings,
  emptyFeedbackAnswer,
  type FeedbackAnswers,
  type SkillFeedbackAnswer,
} from "@/lib/feedback-steps";
import { FeedbackCategoryCard } from "./feedback-category-card";
import { FeedbackReviewerHeader } from "./feedback-reviewer-header";
import { FeedbackReviewSummary } from "./feedback-review-summary";
export function CategoryRatingInput({
  name,
  description,
  value,
  onChange,
  comment = "",
  onCommentChange,
}: {
  name: string;
  description?: string | null;
  value: number;
  onChange: (n: number) => void;
  comment?: string;
  onCommentChange?: (value: string) => void;
}) {
  const descriptionId = useId();
  return (
    <div className="rounded-xl border border-border p-4">
      <h3>{name}</h3>
      {description?.trim() && (
        <p id={descriptionId} className="subtle mt-2 text-sm leading-6">
          {description}
        </p>
      )}
      <RatingStars
        label={name}
        descriptionId={description?.trim() ? descriptionId : undefined}
        value={value}
        onChange={onChange}
      />
      <label className="field mt-3">
        <span>
          {name} comment <span className="subtle font-normal">(optional)</span>
        </span>
        <textarea
          rows={2}
          value={comment}
          placeholder={`Add feedback about ${name.toLowerCase()}…`}
          onChange={(event) => onCommentChange?.(event.target.value)}
        />
      </label>
    </div>
  );
}
export function RegisteredFeedbackPage({
  recipientId,
}: {
  recipientId: string;
}) {
  const catalog = useCatalog();
  const params = useSearchParams();
  if (catalog.isPending) return <LoadingSkeleton />;
  if (catalog.error)
    return <ErrorState error={catalog.error} retry={() => catalog.refetch()} />;
  const sport = catalog.data?.sports[0];
  if (!sport) return <EmptyState title="Beach Volleyball is unavailable" />;
  return (
    <FeedbackSubmissionForm
      recipientId={recipientId}
      sportId={sport.id}
      initialMatchId={params.get("match") ?? undefined}
    />
  );
}
export function FeedbackSubmissionForm({
  recipientId,
  sportId,
  token,
  scopedMatchId,
  initialMatchId,
  guestOnly = false,
}: {
  recipientId: string;
  sportId: string;
  token?: string;
  scopedMatchId?: string;
  initialMatchId?: string;
  guestOnly?: boolean;
}) {
  const catalog = useQuery({
    queryKey: [
      "feedback-categories",
      sportId,
      recipientId,
      token ?? "registered",
    ],
    queryFn: async () => {
      if (token) {
        const result = await gql<{
          feedbackInvitation: {
            recipientId: string;
            recipientUsername: string;
            assignedReviewer: { id: string; username: string } | null;
            approvalRequired: boolean;
            sport: Sport;
            match: InvitedMatch | null;
          };
        }>(
          `query FeedbackInvitation($token:String!){feedbackInvitation(token:$token){recipientId recipientUsername assignedReviewer{id username} approvalRequired sport{id name slug skills{id sportId name slug description active requiredForSelfAssessment}} match{id playedAt teams{teamNumber score players} unassignedPlayers}}}`,
          { token },
        );
        return result.feedbackInvitation;
      }
      const result = await gql<{
        sport: Pick<Sport, "id" | "name" | "slug"> | null;
        skills: Skill[];
        playerProfile: { username: string };
      }>(
        `query FeedbackCategories($sportId:ID!,$recipientId:ID!){playerProfile(id:$recipientId){username} sport(id:$sportId){id name slug} skills(sportId:$sportId){id sportId name slug description active requiredForSelfAssessment}}`,
        { sportId, recipientId },
      );
      return {
        sport: result.sport ? { ...result.sport, skills: result.skills } : null,
        recipientId,
        recipientUsername: result.playerProfile.username,
        assignedReviewer: null,
        approvalRequired: false,
        match: null as InvitedMatch | null,
      };
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const user = useUser(!guestOnly);
  const activeSession =
    !guestOnly &&
    !!user.data &&
    !(user.error instanceof ApiError && user.error.status === 401);
  const path = usePathname();
  const search = useSearchParams();
  const returnTo = path + (search.size ? `?${search.toString()}` : "");
  const client = useQueryClient();
  const matches = useMatches(activeSession && !token);
  const [selected, setSelected] = useState(
    scopedMatchId ?? initialMatchId ?? "",
  );
  const selectedMatch = useMatch(selected, activeSession && !token);
  const [selectedReviewer, setSelectedReviewer] = useState<Member | null>(null);
  const [answers, setAnswers] = useState<FeedbackAnswers>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [review, setReview] = useState(false);
  const stepPanel = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    stepPanel.current?.focus({ preventScroll: true });
  }, [stepIndex, review]);
  const [validationError, setValidationError] = useState("");
  const lockedSubmission = useRef(false);
  const form = useForm<z.infer<typeof feedbackSchema>>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      guestName: "",
      overallComment: "",
      analyticsAllowed: false,
      evidenceAllowed: false,
    },
  });
  const sport = catalog.data?.sport;
  const invitationMatch = catalog.data?.match ?? null;
  const effectiveMatchId = token ? (invitationMatch?.id ?? "") : selected;
  const steps = feedbackSteps(sport?.skills ?? []);
  const currentStep = steps[stepIndex];
  const hasSkills = steps.some((step) => step.skill);
  const valuesToSend = feedbackRatings(steps, answers);
  const guestNameValue = useWatch({ control: form.control, name: "guestName" });
  function editStep(index: number) {
    moved.current = true;
    setStepIndex(index);
    setReview(false);
    setValidationError("");
  }
  function updateAnswer(patch: Partial<SkillFeedbackAnswer>) {
    const skill = currentStep.skill;
    if (!skill) return;
    setAnswers((previous) => ({
      ...previous,
      [skill.id]: {
        ...(previous[skill.id] ?? emptyFeedbackAnswer(skill.id)),
        ...patch,
        skillId: skill.id,
      },
    }));
    setValidationError("");
  }
  function advance(skip = false) {
    const answer = currentStep.skill ? answers[currentStep.skill.id] : null;
    if (!skip && answer?.comment.trim() && answer.rating === null) {
      setValidationError(
        `Choose a rating for ${currentStep.title} to include its comment, or use Skip to clear this answer.`,
      );
      return;
    }
    if (skip || answer?.rating == null)
      updateAnswer({ rating: null, comment: "", skipped: true });
    setValidationError("");
    moved.current = true;
    if (stepIndex === 4) setReview(true);
    else setStepIndex(stepIndex + 1);
  }
  const registered = activeSession;
  const guest = !registered;
  const assignedReviewer = catalog.data?.assignedReviewer ?? selectedReviewer;
  const approvalRequired =
    !!catalog.data?.approvalRequired || !!selectedReviewer;
  const ownReview =
    !approvalRequired &&
    registered &&
    user.data?.me.id === (catalog.data?.recipientId ?? recipientId);
  const eligible = recipientMatches(matches.data?.rows ?? [], recipientId);
  const extra = selectedMatch.data?.match;
  if (
    extra &&
    extra.participants?.some((p) => p.userId === recipientId) &&
    (!extra.sportId || extra.sportId === sportId) &&
    !eligible.some((m) => m.id === extra.id)
  )
    eligible.unshift(extra);
  const available = eligible.filter((m) => !m.sportId || m.sportId === sportId);
  const chosenValid =
    !!token ||
    !selected ||
    !!scopedMatchId ||
    available.some((m) => m.id === selected);
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof feedbackSchema>) => {
      if (!sport)
        throw new Error(
          "This invitation’s sport is unavailable. Ask the player for a new link.",
        );
      if (ownReview)
        throw new Error("You cannot leave feedback about yourself.");
      if (guest && !token)
        throw new Error(
          "Sign in or open a guest invitation to submit feedback.",
        );
      if (!chosenValid)
        throw new Error(
          "Choose a match you can access, or select General Feedback.",
        );
      const { guestName, ...rest } = values;
      const input = {
        ...rest,
        recipientId: catalog.data?.recipientId ?? recipientId,
        sportId: sport.id,
        matchId: effectiveMatchId || null,
        ratings: valuesToSend,
        ...(selectedReviewer && !catalog.data?.assignedReviewer
          ? { assignedReviewerId: selectedReviewer.id }
          : {}),
        ...(guest || (token && approvalRequired)
          ? {
              guestName: guest
                ? guestName.trim() || undefined
                : user.data!.me.username,
              token,
            }
          : {}),
      };
      return gql(
        guest || (token && approvalRequired)
          ? `mutation GuestFeedback($input:SubmitGuestFeedbackInput!){submitGuestFeedback(input:$input){id}}`
          : `mutation SubmitFeedback($input:SubmitFeedbackInput!){submitFeedback(input:$input){id}}`,
        { input },
      );
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["feedback"] });
      client.invalidateQueries({ queryKey: ["submitted-feedback"] });
      client.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: () => {
      lockedSubmission.current = false;
    },
  });
  function submit(values: z.infer<typeof feedbackSchema>) {
    if (lockedSubmission.current) return;
    const unratedStep = steps.find(
      ({ skill }) =>
        skill &&
        answers[skill.id]?.comment.trim() &&
        answers[skill.id]?.rating === null,
    );
    if (unratedStep) {
      setValidationError(
        `Choose a rating for ${unratedStep.title} to include its comment.`,
      );
      return;
    }
    if (!validateRatings(valuesToSend)) {
      setValidationError("Rate at least one category from 1 to 5.");
      return;
    }
    setValidationError("");
    lockedSubmission.current = true;
    mutation.mutate(values);
  }
  function nextReviewer() {
    form.reset();
    setSelectedReviewer(null);
    setAnswers({});
    setStepIndex(0);
    setReview(false);
    setValidationError("");
    lockedSubmission.current = false;
    mutation.reset();
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  if (mutation.isSuccess)
    return (
      <section className="panel py-12 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-accent text-primary">
          <Check size={27} />
        </span>
        <h1>Thanks for your feedback.</h1>
        <p className="subtle mt-4">
          {approvalRequired
            ? `Your draft is awaiting ${assignedReviewer?.username ?? "the assigned reviewer"}’s approval. It will reach the player after approval.`
            : "Your perspective has been sent to the player."}
        </p>
        {guestOnly && (
          <Button className="mt-6" onClick={nextReviewer}>
            Next reviewer
          </Button>
        )}
        {registered && (
          <Button className="mt-6" asChild>
            <Link href="/matches">Back to matches</Link>
          </Button>
        )}
      </section>
    );
  if (catalog.isPending || (!guestOnly && user.isPending))
    return <LoadingSkeleton />;
  if (catalog.error)
    return <ErrorState error={catalog.error} retry={() => catalog.refetch()} />;
  if (
    !guestOnly &&
    user.error &&
    !(user.error instanceof ApiError && user.error.status === 401)
  )
    return <ErrorState error={user.error} retry={() => user.refetch()} />;
  if (!sport)
    return (
      <EmptyState title="This sport is unavailable">
        Ask the player for a new feedback link.
      </EmptyState>
    );
  return (
    <div
      className={`feedback-experience ${token ? "feedback-invitation" : "feedback-in-app"}`}
    >
      {!registered && !token ? (
        <div className="feedback-signin-gate">
          <FeedbackReviewerHeader
            reviewer={registered ? user.data!.me : null}
            guestName={guestNameValue}
            recipientName={catalog.data?.recipientUsername ?? "Player"}
            assignedReviewer={assignedReviewer}
            approvalRequired={approvalRequired}
          />
          <section className="feedback-setup">
            <h2>Sign in to give feedback</h2>
            <p className="subtle my-4">
              Guests can use a personal feedback invitation instead.
            </p>
            <Button asChild>
              <Link href={authHref("/login", returnTo)}>Sign in</Link>
            </Button>
          </section>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (review) void form.handleSubmit(submit)(event);
          }}
        >
          <fieldset
            disabled={mutation.isPending}
            className="feedback-layout min-w-0"
          >
            {!hasSkills ? (
              <div className="feedback-setup">
                <EmptyState title="No categories available">
                  The five volleyball categories are unavailable. Please try
                  again later.
                </EmptyState>
              </div>
            ) : (
              <div
                ref={stepPanel}
                tabIndex={-1}
                className="feedback-step-panel"
                aria-label={
                  review ? "Review feedback" : `${currentStep.title} category`
                }
              >
                <div className="feedback-progress">
                  <p className="feedback-progress-recipient">
                    Reviewing @{catalog.data?.recipientUsername ?? "Player"}
                  </p>
                  <div className="feedback-progress-label">
                    <span>
                      {review ? "Ready for a final look?" : currentStep.title}
                    </span>
                    <strong>{review ? 5 : stepIndex + 1} of 5</strong>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Feedback progress"
                    aria-valuemin={1}
                    aria-valuemax={5}
                    aria-valuenow={review ? 5 : stepIndex + 1}
                    aria-valuetext={
                      review
                        ? "Review your five categories"
                        : `${currentStep.title}, ${stepIndex + 1} of 5`
                    }
                    className="feedback-progress-track"
                  >
                    {steps.map((step, index) => (
                      <span
                        key={step.key}
                        className={
                          review || index <= stepIndex ? "is-reached" : ""
                        }
                      />
                    ))}
                  </div>
                  <p className="sr-only" role="status">
                    {review
                      ? "Review feedback before submitting."
                      : `${stepIndex + 1} of 5: ${currentStep.title}`}
                  </p>
                </div>
                {review ? (
                  <section className="feedback-review feedback-card-enter">
                    <p className="feedback-kicker">ONE LAST LOOK</p>
                    <h2>Review feedback</h2>
                    <p className="feedback-review-intro">
                      Reviewing @{catalog.data?.recipientUsername ?? "Player"} ·{" "}
                      {valuesToSend.length} of 5 categories rated.
                    </p>
                    <FeedbackReviewSummary
                      steps={steps}
                      answers={answers}
                      onEdit={editStep}
                      disabled={mutation.isPending}
                    />
                    <label className="field mt-5">
                      Written feedback{" "}
                      <span className="font-normal">(optional)</span>
                      <textarea
                        rows={3}
                        maxLength={5000}
                        placeholder="Anything else that could help their game?"
                        {...form.register("overallComment")}
                      />
                    </label>
                    {form.formState.errors.overallComment && (
                      <p className="feedback-inline-error">
                        {form.formState.errors.overallComment.message}
                      </p>
                    )}
                    <details className="feedback-sharing">
                      <summary>Privacy & sharing</summary>
                      <div className="space-y-4 pt-3">
                        <label className="flex items-start gap-3 font-normal">
                          <input
                            type="checkbox"
                            {...form.register("analyticsAllowed")}
                          />
                          <span>Allow public aggregate analytics.</span>
                        </label>
                        <label className="flex items-start gap-3 font-normal">
                          <input
                            type="checkbox"
                            {...form.register("evidenceAllowed")}
                          />
                          <span>
                            Allow this feedback as supporting evidence for
                            future insights.
                          </span>
                        </label>
                      </div>
                    </details>
                    {!valuesToSend.length && (
                      <p role="status" className="feedback-inline-error">
                        Rate at least one category before submitting feedback.
                      </p>
                    )}
                    {validationError && (
                      <p role="alert" className="feedback-inline-error">
                        {validationError}
                      </p>
                    )}
                    {mutation.error && (
                      <p role="alert" className="feedback-inline-error">
                        {mutation.error.message}
                      </p>
                    )}
                    {ownReview && (
                      <p role="alert" className="feedback-inline-error">
                        You can’t review yourself. Share this link with another
                        player.
                      </p>
                    )}
                    <div className="feedback-review-actions">
                      <Button
                        type="button"
                        variant="outline"
                        className="feedback-secondary"
                        onClick={() => editStep(4)}
                      >
                        <ArrowLeft size={16} />
                        Back
                      </Button>
                      <Button
                        type="submit"
                        className="feedback-primary"
                        disabled={
                          mutation.isPending ||
                          ownReview ||
                          !chosenValid ||
                          !valuesToSend.length
                        }
                      >
                        {mutation.isPending ? (
                          <Pending label="Sending feedback…" />
                        ) : (
                          <>
                            <Send size={16} />
                            Submit Feedback
                          </>
                        )}
                      </Button>
                    </div>
                    {approvalRequired && (
                      <p className="feedback-final-note">
                        This draft will wait for @{assignedReviewer?.username}’s
                        approval before it reaches the player or affects
                        ratings.
                      </p>
                    )}
                  </section>
                ) : (
                  <FeedbackCategoryCard
                    key={currentStep.key}
                    step={currentStep}
                    index={stepIndex}
                    answer={
                      currentStep.skill
                        ? (answers[currentStep.skill.id] ??
                          emptyFeedbackAnswer(currentStep.skill.id))
                        : null
                    }
                    onChange={updateAnswer}
                    onPrevious={() => editStep(stepIndex - 1)}
                    onNext={() => advance()}
                    onSkip={() => advance(true)}
                    error={validationError}
                  />
                )}
              </div>
            )}
            <aside
              className="feedback-sidebar"
              aria-label="Feedback user information"
            >
              <FeedbackReviewerHeader
                reviewer={registered ? user.data!.me : null}
                guestName={guestNameValue}
                recipientName={catalog.data?.recipientUsername ?? "Player"}
                assignedReviewer={assignedReviewer}
                approvalRequired={approvalRequired}
              />
              <section
                aria-label="Reviewer identity"
                className="feedback-setup"
              >
                {guest ? (
                  <>
                    <label className="field">
                      Your name <span className="font-normal">(optional)</span>
                      <input
                        aria-label="Your name"
                        autoComplete={guestOnly ? "off" : "name"}
                        maxLength={100}
                        placeholder="Guest reviewer"
                        {...form.register("guestName")}
                      />
                    </label>
                    {form.formState.errors.guestName && (
                      <p className="error">
                        {form.formState.errors.guestName.message}
                      </p>
                    )}
                    {!guestOnly && (
                      <div className="feedback-sign-in">
                        <span>Guest reviewer · or use your account</span>
                        <Link href={authHref("/login", returnTo)}>Log in</Link>
                        <Link href={authHref("/signup", returnTo)}>
                          Sign up
                        </Link>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="feedback-signed-in">
                    <span>Using your signed-in player account.</span>
                    <label className="sr-only">
                      Your name
                      <input
                        value={user.data!.me.username}
                        readOnly
                        autoComplete="nickname"
                      />
                    </label>
                  </div>
                )}
                {!catalog.data?.assignedReviewer && (
                  <div className="mt-4">
                    <ReviewerPicker
                      recipientId={catalog.data?.recipientId ?? recipientId}
                      value={selectedReviewer}
                      onChange={setSelectedReviewer}
                      disabled={mutation.isPending}
                      forFeedback
                      token={token}
                    />
                  </div>
                )}
                {token ? (
                  invitationMatch ? (
                    <details className="feedback-match-context">
                      <summary>
                        Match on{" "}
                        {invitationMatch.playedAt
                          ? new Date(
                              invitationMatch.playedAt,
                            ).toLocaleDateString()
                          : "date not recorded"}{" "}
                        · View teams <span>(read only)</span>
                      </summary>
                      <div className="mt-3">
                        <InvitedMatchPreview match={invitationMatch} />
                      </div>
                    </details>
                  ) : (
                    <p className="feedback-context-caption">
                      General feedback · No match selected
                    </p>
                  )
                ) : (
                  <div className="mt-4">
                    <MatchSelector
                      matches={registered ? available : []}
                      value={selected}
                      onChange={setSelected}
                      locked={!!scopedMatchId}
                      scopedMatchId={scopedMatchId}
                      guest={guest}
                      hasMore={registered && matches.hasNextPage}
                      loadingMore={matches.isFetchingNextPage}
                      onLoadMore={() => matches.fetchNextPage()}
                    />
                  </div>
                )}
                {registered && !token && matches.error && (
                  <ErrorState
                    error={matches.error}
                    retry={() => matches.refetch()}
                  />
                )}
                {registered &&
                  !token &&
                  selectedMatch.error &&
                  !scopedMatchId && (
                    <p role="alert" className="error">
                      That match is unavailable. Choose General Feedback or a
                      match from the list.
                    </p>
                  )}
              </section>
            </aside>
          </fieldset>
        </form>
      )}
    </div>
  );
}
