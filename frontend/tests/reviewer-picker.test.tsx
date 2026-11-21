import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewerPicker } from "../src/components/reviewer-picker";

function mount(onChange = vi.fn(), onSubmit = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <ReviewerPicker
          recipientId="recipient"
          value={null}
          onChange={onChange}
          forFeedback
          token="invitation"
          label="Feedback giver"
          showHint={false}
        />
      </form>
    </QueryClientProvider>,
  );
  return {
    search: screen.getByRole("combobox", { name: "Feedback giver" }),
    onSubmit,
  };
}
const reply = (members: { id: string; username: string }[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { feedbackReviewers: members } }),
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("debounces username searches, excludes the recipient and selects a backend user ID", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    reply([
      { id: "recipient", username: "Alex" },
      { id: "player-id", username: "Alexandra" },
    ]),
  );
  vi.stubGlobal("fetch", fetcher);
  const selected = vi.fn();
  const { search } = mount(selected);
  vi.useFakeTimers();
  fireEvent.change(search, { target: { value: "Al" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: "Alex" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(299);
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  vi.useRealTimers();
  const option = await screen.findByRole("option", { name: /Alexandra/ });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toEqual({
    search: "Alex",
    token: "invitation",
    recipientId: "recipient",
  });
  fireEvent.click(option);
  expect(selected).toHaveBeenCalledWith({
    id: "player-id",
    username: "Alexandra",
  });
});

it("shows loading and an honest empty result without accepting arbitrary usernames", async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<ReturnType<typeof reply>>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const selected = vi.fn();
  const { search } = mount(selected);
  fireEvent.change(search, { target: { value: "NoSuchUser" } });
  await screen.findByText("Searching…");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => resolve(reply([])));
  await screen.findByText("No matching reviewers.");
  fireEvent.keyDown(search, { key: "Enter" });
  expect(selected).not.toHaveBeenCalled();
});

it("allows retrying failed searches without submitting the surrounding feedback form", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("Search unavailable"))
    .mockResolvedValue(reply([]));
  vi.stubGlobal("fetch", fetcher);
  const { search, onSubmit } = mount();
  fireEvent.change(search, { target: { value: "Alex" } });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await screen.findByText("No matching reviewers.");
  expect(onSubmit).not.toHaveBeenCalled();
});
