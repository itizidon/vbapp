"use client";
import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { LoaderCircle, Send, Sparkles, Plus } from "lucide-react";
import { gql } from "@/lib/api";
import { useCatalog, useUser } from "@/lib/hooks";
import {
  COACH_FIELDS,
  COACH_SUGGESTIONS,
  type CoachConversation,
  type CoachMessage,
  type CoachPage,
} from "@/lib/ai-coach";
import { BeachCourtBackground } from "./beach-court-background";
interface ProfileSummary {
  state: string;
  rebuildQueued: boolean;
  profile: {
    totalEligibleFeedbackCount: number;
    verifiedFeedbackCount?: number;
    guestFeedbackCount?: number;
    awaitingReviewerApprovalCount?: number;
    evidenceStatus: string;
    state: string;
  } | null;
}
export function AiCoach() {
  const user = useUser(),
    catalog = useCatalog();
  const sport = catalog.data?.sports[0];
  if (user.isPending || catalog.isPending)
    return (
      <section className="ai-coach" aria-label="AI Coach">
        <p role="status">Preparing your coach…</p>
      </section>
    );
  if (!user.data?.me || !sport) return null;
  return (
    <CoachChat
      key={user.data.me.id + ":" + sport.id}
      userId={user.data.me.id}
      sportId={sport.id}
    />
  );
}
export function CoachChat({
  userId,
  sportId,
}: {
  userId: string;
  sportId: string;
}) {
  const client = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const request = useRef<{
    question: string;
    conversationId: string | null;
    clientRequestId: string;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const profile = useQuery({
    queryKey: ["coach-profile", userId, sportId],
    queryFn: () =>
      gql<{ myFeedbackAnalysisProfile: ProfileSummary }>(
        `query CoachProfile($sportId:ID!){myFeedbackAnalysisProfile(sportId:$sportId){state rebuildQueued profile {totalEligibleFeedbackCount verifiedFeedbackCount guestFeedbackCount awaitingReviewerApprovalCount evidenceStatus state}}}`,
        { sportId },
      ),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (q) =>
      q.state.data?.myFeedbackAnalysisProfile.state === "STALE" ? 10000 : false,
  });
  const conversations = useQuery({
    queryKey: ["coach-conversations", userId, sportId],
    queryFn: () =>
      gql<{ myAiCoachConversations: CoachConversation[] }>(
        `query CoachConversations($sportId:ID!){myAiCoachConversations(sportId:$sportId){id title updatedAt}}`,
        { sportId },
      ),
    staleTime: 0,
  });
  const messagesKey = ["coach-messages", userId, sportId, conversationId];
  const messages = useInfiniteQuery({
    queryKey: messagesKey,
    enabled: !!conversationId,
    queryFn: ({ pageParam }) =>
      gql<{ myAiCoachMessages: CoachPage }>(
        `query CoachMessages($conversationId:ID!,$cursor:ID){myAiCoachMessages(conversationId:$conversationId,cursor:$cursor){messages{${COACH_FIELDS}} nextCursor}}`,
        { conversationId, cursor: pageParam },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.myAiCoachMessages.nextCursor ?? undefined,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.myAiCoachMessages.messages.some(
          (message) => message.status === "PENDING",
        ),
      )
        ? 2000
        : false,
  });
  const send = useMutation({
    mutationFn: (payload: {
      question: string;
      conversationId: string | null;
      clientRequestId: string;
    }) =>
      gql<{ askAiCoach: CoachMessage }>(
        `mutation AskAiCoach($input:AskAiCoachInput!){askAiCoach(input:$input){${COACH_FIELDS}}}`,
        { input: { sportId, ...payload } },
      ),
    retry: false,
    onSuccess: (data) => {
      const turn = data.askAiCoach;
      const key = ["coach-messages", userId, sportId, turn.conversationId];
      client.setQueryData<InfiniteData<{ myAiCoachMessages: CoachPage }>>(
        key,
        (old) => {
          if (!old)
            return {
              pages: [
                { myAiCoachMessages: { messages: [turn], nextCursor: null } },
              ],
              pageParams: [null],
            };
          const pages = old.pages.map((p, index) =>
            index
              ? p
              : {
                  myAiCoachMessages: {
                    ...p.myAiCoachMessages,
                    messages: [
                      ...p.myAiCoachMessages.messages.filter(
                        (m) => m.id !== turn.id,
                      ),
                      turn,
                    ],
                  },
                },
          );
          return { ...old, pages };
        },
      );
      setConversationId(turn.conversationId);
      setQuestion("");
      request.current = null;
      void client.invalidateQueries({
        queryKey: ["coach-conversations", userId, sportId],
      });
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || value.length > 2000 || send.isPending) return;
    if (
      !request.current ||
      request.current.question !== value ||
      request.current.conversationId !== conversationId
    )
      request.current = {
        question: value,
        conversationId,
        clientRequestId: crypto.randomUUID(),
      };
    send.mutate(request.current);
  };
  const rows = [...(messages.data?.pages ?? [])]
    .reverse()
    .flatMap((p) => p.myAiCoachMessages.messages);
  const snapshot = profile.data?.myFeedbackAnalysisProfile;
  return (
    <section className="ai-coach" aria-label="AI Coach">
      <BeachCourtBackground />
      <div className="ai-coach__content">
        <header className="ai-coach__header">
          <div>
            <p className="ai-coach__eyebrow">
              <Sparkles size={16} /> BVBTIPS · YOUR GAME
            </p>
            <h2>AI Coach</h2>
            <p>Turn your feedback into a clearer next step.</p>
          </div>
          <span className="ai-coach__private">Private to your account</span>
        </header>
        <div className="ai-coach__layout">
          <aside className="ai-coach__history">
            <button
              type="button"
              className="ai-coach__new"
              disabled={send.isPending}
              onClick={() => {
                setConversationId(null);
                setQuestion("");
                request.current = null;
                send.reset();
              }}
            >
              <Plus size={16} /> New conversation
            </button>
            <details>
              <summary>Recent conversations</summary>
              {conversations.isPending ? (
                <p role="status">Loading conversations…</p>
              ) : conversations.error ? (
                <p role="alert">
                  Conversation history is unavailable.{" "}
                  <button
                    type="button"
                    onClick={() => void conversations.refetch()}
                  >
                    Retry
                  </button>
                </p>
              ) : !conversations.data?.myAiCoachConversations.length ? (
                <p>No conversations yet.</p>
              ) : (
                <ul>
                  {conversations.data.myAiCoachConversations.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={send.isPending}
                        aria-current={
                          c.id === conversationId ? "page" : undefined
                        }
                        onClick={() => {
                          setConversationId(c.id);
                          setQuestion("");
                          request.current = null;
                          send.reset();
                        }}
                      >
                        {c.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </aside>
          <div className="ai-coach__chat">
            {profile.error ? (
              <p role="alert">
                Your analytical profile is unavailable.{" "}
                <button type="button" onClick={() => void profile.refetch()}>
                  Retry
                </button>
              </p>
            ) : snapshot?.state === "STALE" ? (
              <p className="ai-coach__notice" role="status">
                Your analytical profile is being prepared. Please check back
                shortly.
              </p>
            ) : snapshot?.profile?.totalEligibleFeedbackCount === 0 ? (
              <div className="ai-coach__notice">
                <strong>No eligible feedback yet</strong>
                <p>
                  Your coach needs submitted feedback with permission for
                  private analytics and AI coaching. Pending assigned reviews
                  also need the reviewer’s explicit permission to share AI
                  insights before approval.
                </p>
                <Link href="/feedback">Request feedback</Link>
              </div>
            ) : snapshot?.profile &&
              snapshot.profile.evidenceStatus !== "SUFFICIENT" ? (
              <p className="ai-coach__notice">
                Evidence is limited or processing is incomplete. Your coach will
                keep conclusions cautious.
              </p>
            ) : null}
            {snapshot?.profile &&
              snapshot.profile.verifiedFeedbackCount !== undefined && (
                <p className="ai-coach__notice text-sm">
                  Evidence: {snapshot.profile.verifiedFeedbackCount} verified
                  approved · {snapshot.profile.guestFeedbackCount ?? 0}{" "}
                  unverified guest ·{" "}
                  {snapshot.profile.awaitingReviewerApprovalCount ?? 0} awaiting
                  reviewer approval. Unverified feedback adds context and never
                  changes internal ratings.
                </p>
              )}
            <div
              role="log"
              aria-label="Coaching conversation"
              aria-live="polite"
              aria-busy={send.isPending}
              className="ai-coach__messages"
            >
              {messages.hasNextPage && (
                <button
                  type="button"
                  className="ai-coach__earlier"
                  disabled={messages.isFetchingNextPage}
                  onClick={() => void messages.fetchNextPage()}
                >
                  {messages.isFetchingNextPage
                    ? "Loading…"
                    : "Load earlier messages"}
                </button>
              )}
              {conversationId && messages.isPending ? (
                <p role="status">
                  <LoaderCircle className="animate-spin" size={18} /> Loading
                  messages…
                </p>
              ) : messages.error ? (
                <p role="alert">
                  Unable to load this conversation.{" "}
                  <button type="button" onClick={() => void messages.refetch()}>
                    Retry
                  </button>
                </p>
              ) : rows.length ? (
                rows.map((turn) => (
                  <article key={turn.id} className="ai-coach__turn">
                    <div className="ai-coach__question">
                      <span>You</span>
                      <p>{turn.question}</p>
                    </div>
                    <div className="ai-coach__answer">
                      <span>
                        <Sparkles size={14} /> Coach
                      </span>
                      {turn.sourceAsOf && (
                        <small className="ai-coach__basis">
                          Analysis as of{" "}
                          <time dateTime={turn.sourceAsOf}>
                            {new Date(turn.sourceAsOf).toLocaleString()}
                          </time>
                        </small>
                      )}
                      {turn.response.insufficientEvidence && (
                        <p className="ai-coach__caution">
                          Limited evidence · cautious guidance
                        </p>
                      )}
                      <p className="ai-coach__text">{turn.response.message}</p>
                      {turn.response.evidence.length > 0 && (
                        <details>
                          <summary>
                            Feedback evidence ({turn.response.evidence.length})
                          </summary>
                          <ul>
                            {turn.response.evidence.map((e) => (
                              <li key={e.factId}>
                                <p>{e.claim}</p>
                                <small>
                                  {e.supportingReviewCount} supporting{" "}
                                  {e.supportingReviewCount === 1
                                    ? "review"
                                    : "reviews"}
                                  {e.metricKey ? " · SQL profile metric" : ""}
                                </small>
                                {e.trustClassification ===
                                "AWAITING_REVIEWER_APPROVAL" ? (
                                  <small>
                                    Awaiting reviewer approval · AI excerpt
                                    shared by permission
                                  </small>
                                ) : (
                                  e.feedbackIds.map((id) => (
                                    <Link key={id} href={`/feedback/${id}`}>
                                      View supporting feedback
                                    </Link>
                                  ))
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {turn.response.generalSuggestions.length > 0 && (
                        <div className="ai-coach__general">
                          <h3>General practice suggestions</h3>
                          <p>
                            Coaching ideas, not verified drill recommendations.
                          </p>
                          <ul>
                            {turn.response.generalSuggestions.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <div className="ai-coach__welcome">
                  <Sparkles size={28} />
                  <h3>What would help your game today?</h3>
                  <p>
                    Ask about your strengths, trends, or what reviewers noticed.
                    Statistics come from your analytical profile; feedback
                    references are checked on the server.
                  </p>
                </div>
              )}
              {send.isPending && (
                <div className="ai-coach__pending" role="status">
                  <p>{send.variables?.question}</p>
                  <span>
                    <LoaderCircle className="animate-spin" size={18} /> Checking
                    your feedback…
                  </span>
                </div>
              )}
            </div>
            <div
              className="ai-coach__prompts"
              aria-label="Suggested coaching questions"
            >
              {COACH_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={send.isPending}
                  onClick={() => {
                    setQuestion(s);
                    inputRef.current?.focus();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            {send.error && (
              <p role="alert" className="ai-coach__error">
                {send.error.message} Your question is saved below; retrying uses
                the same request.
              </p>
            )}
            <form onSubmit={submit} className="ai-coach__form">
              <label htmlFor="coach-question">Ask your volleyball coach</label>
              <textarea
                ref={inputRef}
                id="coach-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                maxLength={2000}
                disabled={send.isPending}
                placeholder="What should I focus on next?"
                aria-describedby="coach-input-help"
              />
              <div>
                <small id="coach-input-help">
                  {question.length}/2000 · AI guidance can be imperfect. Check
                  the evidence.
                </small>
                <button
                  type="submit"
                  className="ai-coach__send"
                  disabled={send.isPending || !question.trim()}
                >
                  {send.isPending ? (
                    <LoaderCircle className="animate-spin" size={16} />
                  ) : (
                    <Send size={16} />
                  )}{" "}
                  {send.isPending ? "Thinking…" : "Send"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
