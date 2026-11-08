"use client";
import { useRef, useState, useId } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Send } from "lucide-react";
import { useCatalog, useUser, useMatches, useMatch } from "@/lib/hooks";
import { authHref } from "@/lib/navigation";
import { gql, ApiError } from "@/lib/api";
import { recipientMatches } from "@/lib/matches";
import { feedbackSchema, validateRatings } from "@/lib/validation";
import type { z } from "zod";
import { Button } from "./ui/button";
import {
  RatingStars,
  LoadingSkeleton,
  ErrorState,
  Pending,
  EmptyState,
} from "./common";
import { MatchSelector } from "./match-selector";
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
}: {
  recipientId: string;
  sportId: string;
  token?: string;
  scopedMatchId?: string;
  initialMatchId?: string;
}) {
  const catalog = useCatalog();
  const user = useUser();
  const activeSession =
    !!user.data &&
    !(user.error instanceof ApiError && user.error.status === 401);
  const path = usePathname();
  const search = useSearchParams();
  const returnTo = path + (search.size ? `?${search.toString()}` : "");
  const client = useQueryClient();
  const matches = useMatches(activeSession);
  const [selected, setSelected] = useState(
    scopedMatchId ?? initialMatchId ?? "",
  );
  const selectedMatch = useMatch(selected, activeSession);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
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
  const sport = catalog.data?.sports.find((s) => s.id === sportId);
  const registered = activeSession;
  const guest = !registered;
  const ownReview = registered && user.data?.me.id === recipientId;
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
    !selected || !!scopedMatchId || available.some((m) => m.id === selected);
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof feedbackSchema>) => {
      if (!sport)
        throw new Error(
          "This invitation is not for Beach Volleyball. Ask the player for a new link.",
        );
      if (ownReview)
        throw new Error("You cannot leave feedback about yourself.");
      if (guest && !token)
        throw new Error(
          "Sign in or open a guest invitation to submit feedback.",
        );
      if (guest && !values.guestName.trim())
        throw new Error("Enter your name.");
      if (!chosenValid)
        throw new Error(
          "Choose a match you can access, or select General Feedback.",
        );
      const { guestName, ...rest } = values;
      const input = {
        ...rest,
        recipientId,
        sportId,
        matchId: selected || null,
        ratings: Object.entries(ratings)
          .filter(([, v]) => v > 0)
          .map(([skillId, rating]) => ({
            skillId,
            rating,
            comment: comments[skillId]?.trim() || undefined,
          })),
        ...(guest ? { guestName: guestName.trim(), token } : {}),
      };
      return gql(
        guest
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
    const unratedSkill = sport?.skills.find(
      (skill) => comments[skill.id]?.trim() && !ratings[skill.id],
    );
    if (unratedSkill) {
      setValidationError(
        `Choose a rating for ${unratedSkill.name} to include its comment.`,
      );
      return;
    }

    const valuesToSend = Object.entries(ratings)
      .filter(([, rating]) => rating > 0)
      .map(([skillId, rating]) => ({ skillId, rating }));
    if (!validateRatings(valuesToSend)) {
      setValidationError("Rate at least one category from 1 to 5.");
      return;
    }
    if (guest && !values.guestName.trim()) {
      setValidationError("Enter your name.");
      return;
    }
    setValidationError("");
    lockedSubmission.current = true;
    mutation.mutate(values);
  }
  if (mutation.isSuccess)
    return (
      <section className="panel py-12 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-accent text-primary">
          <Check size={27} />
        </span>
        <h1>Thanks for your feedback.</h1>
        <p className="subtle mt-4">
          Your perspective has been sent to the player.
        </p>
        {registered && (
          <Button className="mt-6" asChild>
            <Link href="/matches">Back to matches</Link>
          </Button>
        )}
      </section>
    );
  if (catalog.isPending || user.isPending) return <LoadingSkeleton />;
  if (catalog.error)
    return <ErrorState error={catalog.error} retry={() => catalog.refetch()} />;
  if (
    user.error &&
    !(user.error instanceof ApiError && user.error.status === 401)
  )
    return <ErrorState error={user.error} retry={() => user.refetch()} />;
  if (!sport)
    return (
      <EmptyState title="This sport is unavailable">
        Ask for a Beach Volleyball feedback link.
      </EmptyState>
    );
  return (
    <>
      <p className="eyebrow mb-3">A perspective that helps</p>
      <h1>Leave feedback for this player</h1>
      <section className="mb-6 mt-5 rounded-xl border border-border bg-card p-4">
        <p className="break-anywhere font-mono text-xs">Player {recipientId}</p>
        <p className="subtle mt-2 text-xs">
          Confirm this link came from the player you want to review.
        </p>
      </section>
      {!registered && !token ? (
        <section className="panel">
          <h2>Sign in to give feedback</h2>
          <p className="subtle my-4">
            Guests can use a personal feedback invitation instead.
          </p>
          <Button asChild>
            <Link href={authHref("/login", returnTo)}>Sign in</Link>
          </Button>
        </section>
      ) : (
        <form
          className="panel space-y-7"
          onSubmit={(event) => {
            void form.handleSubmit(submit)(event);
          }}
        >
          <section
            aria-label="Reviewer identity"
            className="space-y-4 rounded-xl bg-muted p-4"
          >
            <h2>Your identity</h2>
            {guest ? (
              <>
                <p className="subtle text-sm">
                  Continue as a guest, or use your player account.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" type="button" asChild>
                    <Link href={authHref("/login", returnTo)}>Log in</Link>
                  </Button>
                  <Button variant="outline" type="button" asChild>
                    <Link href={authHref("/signup", returnTo)}>Sign up</Link>
                  </Button>
                </div>
                <label className="field">
                  Your name
                  <input
                    autoComplete="name"
                    required
                    {...form.register("guestName")}
                  />
                  {form.formState.errors.guestName && (
                    <span className="error">
                      {form.formState.errors.guestName.message}
                    </span>
                  )}
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  Your name
                  <input
                    value={user.data!.me.username}
                    readOnly
                    autoComplete="nickname"
                  />
                </label>
                <p role="status" className="subtle text-sm">
                  Using your signed-in player account.
                </p>
              </>
            )}
          </section>
          <section>
            <p className="eyebrow mb-3">1 · Choose the context</p>
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
            {registered && matches.error && (
              <div className="mt-3">
                <ErrorState
                  error={matches.error}
                  retry={() => matches.refetch()}
                />
              </div>
            )}
            {registered && selectedMatch.error && !scopedMatchId && (
              <p role="alert" className="error mt-3">
                That match is unavailable. Choose General Feedback or a match
                from the list.
              </p>
            )}
            {registered && matches.isPending && (
              <p className="subtle mt-3 text-xs">
                Loading matches you can access. General Feedback is always
                available.
              </p>
            )}
          </section>
          <section className="space-y-4">
            <div>
              <p className="eyebrow mb-3">2 · Rate their game</p>
              <h2>What did you notice?</h2>
              <p className="subtle mt-1 text-xs">
                Rate at least one category on the 1–5 scale. Skip any skill you
                haven’t observed.
              </p>
            </div>
            {sport.skills
              .filter((s) => s.active)
              .map((skill) => (
                <CategoryRatingInput
                  key={skill.id}
                  name={skill.name}
                  description={skill.description}
                  value={ratings[skill.id] ?? 0}
                  comment={comments[skill.id] ?? ""}
                  onCommentChange={(value) =>
                    setComments((previous) => ({
                      ...previous,
                      [skill.id]: value,
                    }))
                  }
                  onChange={(value) =>
                    setRatings((previous) => ({
                      ...previous,
                      [skill.id]: value,
                    }))
                  }
                />
              ))}
          </section>
          <section className="space-y-5">
            <p className="eyebrow">3 · Add your perspective</p>
            <label className="field">
              Written feedback{" "}
              <span className="subtle font-normal">(optional)</span>
              <textarea
                rows={4}
                placeholder="What stood out? What could help them improve?"
                {...form.register("overallComment")}
              />
              {form.formState.errors.overallComment && (
                <span className="error">
                  {form.formState.errors.overallComment.message}
                </span>
              )}
            </label>
            <details className="rounded-xl bg-muted p-4">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
                Privacy & sharing
              </summary>
              <div className="space-y-4 pt-3">
                <label className="flex items-start gap-3 font-normal">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    {...form.register("analyticsAllowed")}
                  />
                  <span>Allow public aggregate analytics.</span>
                </label>
                <label className="flex items-start gap-3 font-normal">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    {...form.register("evidenceAllowed")}
                  />
                  <span>
                    Allow this feedback as supporting evidence for future
                    insights.
                  </span>
                </label>
              </div>
            </details>
          </section>
          {validationError && (
            <p role="alert" className="error">
              {validationError}
            </p>
          )}
          {mutation.error && (
            <p role="alert" className="error">
              {mutation.error.message}
            </p>
          )}
          {ownReview && (
            <p role="alert" className="error">
              You can’t review yourself. Share this link with another player.
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={mutation.isPending || ownReview || !chosenValid}
          >
            {mutation.isPending ? (
              <Pending label="Sending feedback…" />
            ) : (
              <>
                <Send size={16} />
                Submit feedback
              </>
            )}
          </Button>
        </form>
      )}
    </>
  );
}
