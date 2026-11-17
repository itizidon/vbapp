import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CoachChat } from "../src/components/ai-coach";
const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  sport: "22222222-2222-4222-8222-222222222222",
  conversation: "33333333-3333-4333-8333-333333333333",
  feedback: "44444444-4444-4444-8444-444444444444",
};
const turn = {
  id: "55555555-5555-4555-8555-555555555555",
  conversationId: ids.conversation,
  question: "How is my passing?",
  startedAt: "2026-11-16T12:00:00Z",
  status: "COMPLETED",
  model: "gpt-6.1-sol",
  promptVersion: "bvbtips-coach-v1",
  inputTokens: 100,
  outputTokens: 50,
  response: {
    message:
      "Passing has an average peer rating of 3.00 / 5 across 6 eligible reviews.",
    status: "ANSWERED",
    insufficientEvidence: false,
    generalSuggestions: ["Keep a steady platform and aim at a target."],
    recommendedDrillIds: [],
    evidence: [
      {
        factId: "observation.known",
        claim: "A verified platform observation.",
        supportingReviewCount: 1,
        feedbackIds: [ids.feedback],
        metricKey: null,
      },
    ],
  },
};
afterEach(() => vi.unstubAllGlobals());
function fixture(
  options: {
    empty?: boolean;
    pending?: boolean;
    failOnce?: boolean;
    hold?: boolean;
  } = {},
) {
  let saved = false,
    fail = options.failOnce,
    release!: (value: unknown) => void;
  const requests: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    let data: unknown;
    if (query.includes("query CoachProfile"))
      data = {
        myFeedbackAnalysisProfile: {
          state: options.pending ? "STALE" : "READY",
          rebuildQueued: !!options.pending,
          profile: options.pending
            ? null
            : {
                totalEligibleFeedbackCount: options.empty ? 0 : 6,
                evidenceStatus: "SUFFICIENT",
                state: "COMPLETE",
              },
        },
      };
    else if (query.includes("query CoachConversations"))
      data = {
        myAiCoachConversations: saved
          ? [
              {
                id: ids.conversation,
                title: turn.question,
                updatedAt: turn.startedAt,
              },
            ]
          : [],
      };
    else if (query.includes("query CoachMessages"))
      data = {
        myAiCoachMessages: { messages: saved ? [turn] : [], nextCursor: null },
      };
    else if (query.includes("mutation AskAiCoach")) {
      requests.push(variables.input);
      if (fail) {
        fail = false;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            errors: [{ message: "Temporary coaching error" }],
          }),
        };
      }
      if (options.hold) await new Promise((resolve) => (release = resolve));
      saved = true;
      data = { askAiCoach: turn };
    } else throw Error("Unexpected coach query");
    return { ok: true, status: 200, json: async () => ({ data }) };
  });
  vi.stubGlobal("fetch", fetcher);
  return { requests, fetcher, release: () => release(undefined) };
}
function mount(userId = ids.user) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <CoachChat userId={userId} sportId={ids.sport} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}
it("shows useful empty and pending analytical states without inventing insights", async () => {
  fixture({ empty: true });
  mount();
  expect(
    await screen.findByText("No eligible feedback yet"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Request feedback" }),
  ).toHaveAttribute("href", "/feedback");
});
it("shows suggested questions, accessible input and mobile touch actions", async () => {
  fixture();
  mount();
  const question = await screen.findByRole("textbox", {
    name: "Ask your volleyball coach",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "What are my biggest weaknesses?" }),
  );
  expect(question).toHaveValue("What are my biggest weaknesses?");
  expect(question).toHaveAttribute("maxLength", "2000");
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
});
it("disables duplicate submissions and displays loading while preserving the question", async () => {
  const f = fixture({ hold: true });
  mount();
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: turn.question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(
    await screen.findByText("Checking your feedback…"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thinking…" })).toBeDisabled();
  f.release();
  expect(await screen.findByText(turn.response.message)).toBeInTheDocument();
  expect(f.requests).toHaveLength(1);
});
it("renders verified counts, server-issued review links and separately labeled general suggestions", async () => {
  fixture();
  mount();
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: turn.question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(turn.response.message)).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "General practice suggestions" }),
  ).toBeInTheDocument();
  expect(screen.getByText("1 supporting review")).toBeInTheDocument();
  expect(
    screen.getByRole("link", {
      name: "View supporting feedback",
      hidden: true,
    }),
  ).toHaveAttribute("href", "/feedback/" + ids.feedback);
  expect(screen.queryByText("recommendedDrillIds")).not.toBeInTheDocument();
});
it("preserves retry identity after a network/provider error without putting questions in a URL", async () => {
  const f = fixture({ failOnce: true });
  mount();
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: turn.question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Temporary coaching error",
  );
  expect(screen.getByRole("textbox")).toHaveValue(turn.question);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(turn.response.message)).toBeInTheDocument();
  expect(f.requests[0].clientRequestId).toBe(f.requests[1].clientRequestId);
  expect(
    f.fetcher.mock.calls.every(
      ([url, init]) => url === "/api/graphql" && init.method === "POST",
    ),
  ).toBe(true);
});
it("can start a new conversation and does not carry old messages into it", async () => {
  fixture();
  mount();
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: turn.question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(turn.response.message);
  fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
  await waitFor(() =>
    expect(screen.queryByText(turn.response.message)).not.toBeInTheDocument(),
  );
  expect(
    screen.getByText("What would help your game today?"),
  ).toBeInTheDocument();
});
