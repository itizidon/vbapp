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
import { FeedbackNavigation } from "./feedback-navigation";
import { FeedbackQuickRatings } from "./feedback-quick-ratings";
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
type FeedbackSubmissionProps = {
  recipientId: string;
  sportId: string;
  token?: string;
  scopedMatchId?: string;
  initialMatchId?: string;
  guestOnly?: boolean;
};
export function FeedbackSubmissionForm(props: FeedbackSubmissionProps) {
  const [dirty, setDirty] = useState(false);
  return (
    <FeedbackNavigation dirty={dirty} publicHeader={!!props.token}>
      <FeedbackSubmissionFields {...props} onDirtyChange={setDirty} />
    </FeedbackNavigation>
  );
}
function FeedbackSubmissionFields({
  recipientId,
  sportId,
  token: initialToken,
  scopedMatchId,
  initialMatchId,
  guestOnly = false,
  onDirtyChange,
}: FeedbackSubmissionProps & { onDirtyChange: (dirty: boolean) => void }) {
  const [token, setToken] = useState(initialToken);
  const [followupGuest, setFollowupGuest] = useState(false);
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
            guestSession?: boolean;
            sport: Sport;
            match: InvitedMatch | null;
            matches?: InvitedMatch[];
            reviewMode?: "INDIVIDUAL_MATCHES" | "COMBINED_MATCHES";
          };
        }>(
          `query FeedbackInvitation($token:String!){feedbackInvitation(token:$token){recipientId recipientUsername assignedReviewer{id username} approvalRequired guestSession sport{id name slug skills{id sportId name slug description active requiredForSelfAssessment}} reviewMode matches{id playedAt teams{teamNumber score players} unassignedPlayers} match{id playedAt teams{teamNumber score players} unassignedPlayers}}}`,
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
        guestSession: false,
        match: null as InvitedMatch | null,
        matches: [] as InvitedMatch[],
        reviewMode: "INDIVIDUAL_MATCHES" as const,
      };
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const guestSession = followupGuest || !!catalog.data?.guestSession;
  const user = useUser(!guestOnly && !guestSession);
  const activeSession =
    !guestOnly &&
    !guestSession &&
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
  const [giverType, setGiverType] = useState<"guest" | "registered" | null>(
    null,
  );
  const [editingReviewer, setEditingReviewer] = useState(false);
  const requestMatches = catalog.data?.matches ?? [];
  const batchRequest = !!token && requestMatches.length > 0;
  const individualRequest =
    batchRequest && catalog.data?.reviewMode !== "COMBINED_MATCHES";
  const [matchIndex, setMatchIndex] = useState(0);
  const answerKey = individualRequest
    ? (requestMatches[matchIndex]?.id ?? "legacy")
    : "combined";
  const [answerSets, setAnswerSets] = useState<Record<string, FeedbackAnswers>>(
    {},
  );
  const answers = answerSets[answerKey] ?? {};
  function setAnswers(
    update: FeedbackAnswers | ((previous: FeedbackAnswers) => FeedbackAnswers),
  ) {
    setAnswerSets((previous) => ({
      ...previous,
      [answerKey]:
        typeof update === "function"
          ? update(previous[answerKey] ?? {})
          : update,
    }));
  }
  const [matchNotes, setMatchNotes] = useState<Record<string, string>>({});
  const requestSubmission = useRef<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [review, setReview] = useState(false);
  const [mode, setMode] = useState<"quick" | "cards">("quick");
  const displayMode = mode;
  const stepPanel = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    stepPanel.current?.focus({ preventScroll: true });
  }, [stepIndex, review, matchIndex, mode]);
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
  const invitationMatch = individualRequest
    ? (requestMatches[matchIndex] ?? null)
    : batchRequest
      ? null
      : (catalog.data?.match ?? null);
  const effectiveMatchId = token ? (invitationMatch?.id ?? "") : selected;
  const steps = feedbackSteps(sport?.skills ?? []);
  const currentStep = steps[stepIndex];
  const hasSkills = steps.some((step) => step.skill);
  const valuesToSend = feedbackRatings(steps, answers);
  function goMatch(index: number, skillIndex = 0) {
    const currentNote = form.getValues("overallComment") ?? "";
    setMatchNotes((previous) => ({
      ...previous,
      [answerKey]: currentNote,
    }));
    form.setValue(
      "overallComment",
      requestMatches[index].id === answerKey
        ? form.getValues("overallComment")
        : (matchNotes[requestMatches[index].id] ?? ""),
    );
    setMatchIndex(index);
    setStepIndex(skillIndex);
    setReview(false);
    setValidationError("");
    moved.current = true;
  }
  function requestReviews(values: z.infer<typeof feedbackSchema>) {
    return (individualRequest ? requestMatches : [null]).map((match) => {
      const key = match?.id ?? "combined";
      return {
        matchId: match?.id ?? null,
        ratings: feedbackRatings(steps, answerSets[key] ?? {}),
        overallComment:
          key === answerKey ? values.overallComment : (matchNotes[key] ?? ""),
        analyticsAllowed: values.analyticsAllowed,
        evidenceAllowed: values.evidenceAllowed,
      };
    });
  }
  function editStep(index: number) {
    moved.current = true;
    setStepIndex(index);
    setReview(false);
    setValidationError("");
  }
  function updateAnswer(patch: Partial<SkillFeedbackAnswer>) {
    if (currentStep.skill) updateSkillAnswer(currentStep.skill.id, patch);
  }
  function updateSkillAnswer(
    skillId: string,
    patch: Partial<SkillFeedbackAnswer>,
  ) {
    setAnswers((previous) => ({
      ...previous,
      [skillId]: {
        ...(previous[skillId] ?? emptyFeedbackAnswer(skillId)),
        ...patch,
        skillId,
      },
    }));
    setValidationError("");
  }
  function reviewQuick() {
    const invalid = steps.find(
      ({ skill }) =>
        skill &&
        answers[skill.id]?.comment.trim() &&
        answers[skill.id]?.rating == null,
    );
    if (invalid) {
      setValidationError(
        `Choose a rating for ${invalid.title} to include its comment.`,
      );
      return;
    }
    if (individualRequest && !valuesToSend.length) {
      setValidationError("Rate at least one category for this match.");
      return;
    }
    setValidationError("");
    moved.current = true;
    if (individualRequest && matchIndex < requestMatches.length - 1)
      goMatch(matchIndex + 1);
    else setReview(true);
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
    if (stepIndex === 4) {
      if (individualRequest && !feedbackRatings(steps, answers).length) {
        setValidationError("Rate at least one category for this match.");
        return;
      }
      if (individualRequest && matchIndex < requestMatches.length - 1)
        goMatch(matchIndex + 1);
      else setReview(true);
    } else setStepIndex(stepIndex + 1);
  }
  const registered = activeSession;
  const guest = !registered;
  const assignedReviewer = catalog.data?.assignedReviewer ?? selectedReviewer;
  const approvalRequired =
    !!catalog.data?.approvalRequired || !!selectedReviewer;
  const lockedReviewer = catalog.data?.assignedReviewer;
  const giverMode =
    lockedReviewer || registered ? "registered" : (giverType ?? "guest");
  const displayedReviewer =
    assignedReviewer ?? (registered && !editingReviewer ? user.data!.me : null);
  const giverValid = giverMode === "guest" || !!displayedReviewer;
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
                ? assignedReviewer
                  ? undefined
                  : guestName.trim() || undefined
                : user.data!.me.username,
              token,
            }
          : {}),
      };
      if (batchRequest) {
        const request = {
          token: token!,
          asGuest: guest,
          reviews: requestReviews(values),
          assignedReviewerId: selectedReviewer?.id,
          guestName: guest
            ? assignedReviewer
              ? undefined
              : guestName.trim() || undefined
            : user.data!.me.username,
        };
        // One ID per reviewer session: an ambiguous network retry must never
        // create another batch, even if the form was edited after the error.
        requestSubmission.current ??= crypto.randomUUID();
        return gql(
          `mutation SubmitFeedbackRequest($input:SubmitFeedbackRequestInput!){submitFeedbackRequest(input:$input){id}}`,
          { input: { ...request, submissionId: requestSubmission.current } },
        );
      }
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
  const draftValues = useWatch({ control: form.control });
  const dirty =
    !mutation.isSuccess &&
    !!(
      draftValues.guestName?.trim() ||
      draftValues.overallComment?.trim() ||
      draftValues.analyticsAllowed ||
      draftValues.evidenceAllowed ||
      selectedReviewer ||
      selected !== (scopedMatchId ?? initialMatchId ?? "") ||
      Object.values(matchNotes).some((note) => note.trim()) ||
      Object.values(answerSets).some((set) =>
        Object.values(set).some(
          (answer) => answer.rating !== null || answer.comment.trim(),
        ),
      )
    );
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  function submit(values: z.infer<typeof feedbackSchema>) {
    if (lockedSubmission.current || !review) return;
    if (!giverValid) {
      setValidationError(
        "Select a registered feedback giver, or choose Guest.",
      );
      return;
    }
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
    if (batchRequest) {
      const badIndex = requestReviews(values).findIndex(
        (review) => !validateRatings(review.ratings),
      );
      if (badIndex >= 0) {
        if (individualRequest) goMatch(badIndex);
        setValidationError(
          "Rate at least one category for every match before submitting.",
        );
        return;
      }
      const invalid = (individualRequest ? requestMatches : [null]).findIndex(
        (match) =>
          Object.values(answerSets[match?.id ?? "combined"] ?? {}).some(
            (a) => a.comment.trim() && a.rating === null && !a.skipped,
          ),
      );
      if (invalid >= 0) {
        if (individualRequest) goMatch(invalid);
        setValidationError("Choose a rating for each category with a comment.");
        return;
      }
    }
    if (!validateRatings(valuesToSend)) {
      setValidationError("Rate at least one category from 1 to 5.");
      return;
    }
    setValidationError("");
    lockedSubmission.current = true;
    mutation.mutate(values);
  }
  const anotherReview = useMutation({
    mutationFn: () => {
      if (!token || !requestSubmission.current || !mutation.isSuccess)
        throw new Error("Submit this review before starting another.");
      return gql<{
        startGuestReviewSession: { token: string; expiresAt: string };
      }>(
        `mutation StartGuestReviewSession($token:String!,$completedSubmissionId:ID!){startGuestReviewSession(token:$token,completedSubmissionId:$completedSubmissionId){token expiresAt}}`,
        { token, completedSubmissionId: requestSubmission.current },
      );
    },
    onSuccess: (data) => {
      setToken(data.startGuestReviewSession.token);
      setFollowupGuest(true);
      resetReview(true);
    },
  });
  function nextReviewer() {
    resetReview(false);
  }
  function resetReview(keepMode: boolean) {
    form.reset();
    setSelectedReviewer(null);
    setGiverType(keepMode ? "guest" : null);
    setEditingReviewer(false);
    setAnswerSets({});
    setMatchNotes({});
    setMatchIndex(0);
    requestSubmission.current = null;
    if (!keepMode) setMode("quick");
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
        {individualRequest && requestMatches.length > 1 && (
          <p className="mt-4">
            {requestMatches.length} match reviews submitted.
            {approvalRequired
              ? ` Each match is waiting in ${assignedReviewer?.username ?? "the assigned reviewer"}’s Account approvals.`
              : " Each match has its own feedback record."}
          </p>
        )}
        {batchRequest && !individualRequest && (
          <p className="mt-4">
            One combined review submitted for {requestMatches.length} matches.
          </p>
        )}
        <p className="subtle mt-4">
          {approvalRequired
            ? `Your draft is awaiting ${assignedReviewer?.username ?? "the assigned reviewer"}’s approval. It will reach the player after approval.`
            : "Your perspective has been sent to the player."}
        </p>
        {batchRequest && (
          <>
            <Button
              type="button"
              className="mt-6"
              disabled={anotherReview.isPending}
              onClick={() => anotherReview.mutate()}
            >
              {anotherReview.isPending ? (
                <Pending label="Starting a new review…" />
              ) : (
                "Leave Another Review"
              )}
            </Button>
            {anotherReview.error && (
              <p role="alert" className="error mt-3">
                {anotherReview.error.message}
              </p>
            )}
          </>
        )}
        {guestOnly && !batchRequest && (
          <Button className="mt-6" onClick={nextReviewer}>
            Next reviewer
          </Button>
        )}
        <Button className="mt-6 mx-2" asChild>
          <Link href="/">Return to BVBTips</Link>
        </Button>
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
      className={`feedback-experience feedback-top-layout ${token ? "feedback-invitation" : "feedback-in-app"}`}
    >
      {!registered && !token ? (
        <div className="feedback-signin-gate">
          <FeedbackReviewerHeader
            recipientName={catalog.data?.recipientUsername ?? "Player"}
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
            if (review || displayMode === "quick")
              void form.handleSubmit(submit)(event);
          }}
        >
          <fieldset
            disabled={mutation.isPending}
            className="feedback-layout min-w-0"
          >
            <aside
              className="feedback-sidebar"
              aria-label="Feedback user information"
            >
              {guestSession && (
                <p className="feedback-context-caption">
                  New guest review · Your own independent feedback
                </p>
              )}
              <FeedbackReviewerHeader
                recipientName={catalog.data?.recipientUsername ?? "Player"}
                context={
                  <>
                    {token ? (
                      batchRequest ? (
                        <p className="feedback-context-caption">
                          {requestMatches.length} selected{" "}
                          {requestMatches.length === 1 ? "match" : "matches"} ·{" "}
                          {individualRequest
                            ? "Individual reviews"
                            : "Combined review"}
                        </p>
                      ) : invitationMatch ? (
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
                          That match is unavailable. Choose General Feedback or
                          a match from the list.
                        </p>
                      )}
                  </>
                }
              >
                <div
                  role="group"
                  aria-label="Feedback giver type"
                  className="feedback-giver-switch"
                >
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={giverMode === "guest"}
                    disabled={!!lockedReviewer || registered}
                    title={
                      lockedReviewer
                        ? "The invitation fixes the feedback giver."
                        : registered
                          ? "Your signed-in identity is verified."
                          : undefined
                    }
                    onClick={() => {
                      setGiverType("guest");
                      setSelectedReviewer(null);
                      setEditingReviewer(false);
                    }}
                  >
                    Guest
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={giverMode === "registered"}
                    disabled={!!lockedReviewer || guestSession}
                    onClick={() => setGiverType("registered")}
                  >
                    Registered User
                  </Button>
                </div>
                {giverMode === "guest" ? (
                  <>
                    <label className="field">
                      Guest name <span className="font-normal">(optional)</span>
                      <input
                        autoComplete={guestOnly ? "off" : "name"}
                        maxLength={100}
                        placeholder="Enter your name"
                        {...form.register("guestName")}
                      />
                    </label>
                    {form.formState.errors.guestName && (
                      <p className="error">
                        {form.formState.errors.guestName.message}
                      </p>
                    )}
                    <p className="feedback-giver-hint">
                      Guest names are unverified. Feedback follows the
                      invitation’s submission rules.
                    </p>
                    {!guestOnly && !guestSession && (
                      <div className="feedback-sign-in">
                        <Link href={authHref("/login", returnTo)}>Log in</Link>
                        <Link href={authHref("/signup", returnTo)}>
                          Sign up
                        </Link>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <ReviewerPicker
                      recipientId={catalog.data?.recipientId ?? recipientId}
                      value={displayedReviewer}
                      label="Feedback giver"
                      placeholder="Search username..."
                      showHint={false}
                      locked={!!lockedReviewer}
                      disabled={mutation.isPending}
                      forFeedback
                      token={token}
                      onChange={(member) => {
                        setSelectedReviewer(member);
                        setEditingReviewer(!member);
                      }}
                    />
                    {registered && !displayedReviewer && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setEditingReviewer(false)}
                      >
                        Use my account
                      </Button>
                    )}
                    <p className="feedback-giver-hint" role="status">
                      {assignedReviewer ? (
                        <>
                          @{assignedReviewer.username} must sign in and approve
                          this feedback before it is published.
                        </>
                      ) : registered && displayedReviewer ? (
                        "Using your signed-in account."
                      ) : (
                        "Select a registered player from the search results."
                      )}
                    </p>
                    {registered && assignedReviewer && (
                      <p className="feedback-draft-submitter">
                        Draft entered by @{user.data!.me.username} · signed in
                      </p>
                    )}
                  </>
                )}
              </FeedbackReviewerHeader>
            </aside>
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
                className={`feedback-step-panel ${displayMode === "cards" ? "feedback-card-mode" : ""}`}
                aria-label={
                  review
                    ? "Review feedback"
                    : displayMode === "quick"
                      ? "Quick feedback"
                      : `${currentStep.title} category`
                }
              >
                <div
                  className="feedback-mode-controls"
                  role="group"
                  aria-label="Feedback mode"
                >
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={displayMode === "quick"}
                    onClick={() => {
                      setMode("quick");
                      setReview(false);
                      setValidationError("");
                    }}
                  >
                    Quick Review
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={displayMode === "cards"}
                    onClick={() => {
                      setMode("cards");
                      setReview(false);
                      setValidationError("");
                    }}
                  >
                    Card Review
                  </Button>
                </div>
                {batchRequest && (
                  <section
                    className="feedback-request-context"
                    aria-label="Request matches"
                  >
                    <h2>
                      {individualRequest
                        ? `Reviewing Match ${matchIndex + 1} of ${requestMatches.length}`
                        : `Reviewing ${requestMatches.length} matches together`}
                    </h2>
                    {individualRequest ? (
                      <>
                        <InvitedMatchPreview match={invitationMatch} />
                        <div className="feedback-request-nav">
                          {requestMatches.map((match, index) => (
                            <Button
                              type="button"
                              variant="outline"
                              key={match.id}
                              aria-pressed={index === matchIndex}
                              onClick={() => goMatch(index)}
                            >
                              Match {index + 1}
                            </Button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <details>
                        <summary>View all included matches</summary>
                        {requestMatches.map((match) => (
                          <InvitedMatchPreview key={match.id} match={match} />
                        ))}
                      </details>
                    )}
                  </section>
                )}
                {displayMode === "quick" && !review && (
                  <FeedbackQuickRatings
                    steps={steps}
                    answers={answers}
                    onChange={updateSkillAnswer}
                  />
                )}
                {displayMode === "cards" && (
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
                )}
                {individualRequest && !review && (
                  <label className="field feedback-match-notes">
                    Written feedback for this match (optional)
                    <textarea
                      rows={2}
                      maxLength={5000}
                      {...form.register("overallComment")}
                    />
                  </label>
                )}
                {review ? (
                  <section className="feedback-review feedback-card-enter">
                    <>
                      <p className="feedback-kicker">ONE LAST LOOK</p>
                      <h2>Review feedback</h2>
                      <p className="feedback-review-intro">
                        Reviewing @{catalog.data?.recipientUsername ?? "Player"}{" "}
                        ·{" "}
                        {individualRequest
                          ? `${requestMatches.length} match reviews`
                          : `${valuesToSend.length} of 5 categories rated.`}
                      </p>
                      {individualRequest ? (
                        requestMatches.map((match, index) => (
                          <section
                            key={match.id}
                            className="feedback-request-summary"
                          >
                            <h3>
                              Match {index + 1} ·{" "}
                              {match.playedAt
                                ? new Date(match.playedAt).toLocaleString()
                                : "Date not recorded"}
                            </h3>
                            <FeedbackReviewSummary
                              steps={steps}
                              answers={answerSets[match.id] ?? {}}
                              onEdit={(skillIndex) =>
                                goMatch(index, skillIndex)
                              }
                              disabled={mutation.isPending}
                            />
                            <p>
                              {match.id === answerKey
                                ? form.getValues("overallComment")
                                : matchNotes[match.id]}
                            </p>
                          </section>
                        ))
                      ) : (
                        <FeedbackReviewSummary
                          steps={steps}
                          answers={answers}
                          onEdit={editStep}
                          disabled={mutation.isPending}
                        />
                      )}
                    </>
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
                          !giverValid ||
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
                  </section>
                ) : displayMode === "quick" ? (
                  <div className="feedback-quick-actions">
                    {validationError && (
                      <p role="alert" className="feedback-inline-error">
                        {validationError}
                      </p>
                    )}
                    <Button
                      type="button"
                      className="feedback-primary"
                      onClick={reviewQuick}
                    >
                      {individualRequest &&
                      matchIndex < requestMatches.length - 1
                        ? "Next match"
                        : "Review & Submit"}
                    </Button>
                  </div>
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
                    nextLabel={
                      individualRequest &&
                      matchIndex < requestMatches.length - 1
                        ? "Next match"
                        : undefined
                    }
                    onSkip={() => advance(true)}
                    error={validationError}
                  />
                )}
              </div>
            )}
          </fieldset>
        </form>
      )}
    </div>
  );
}
