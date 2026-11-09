import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopPlayerSearch } from "../src/components/top-player-search";
import { gql } from "../src/lib/api";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/lib/api", () => ({
  gql: vi.fn(async () => ({ playerSuggestions: [] })),
}));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TopPlayerSearch />
    </QueryClientProvider>,
  );
  const input = screen.getByRole("combobox", {
    name: "Search players",
  });
  fireEvent.focus(input);
  return { client, input };
}
it("waits 500ms after the latest input and queries only the final text", async () => {
  vi.useFakeTimers();
  const { client, input } = setup();
  fireEvent.change(input, { target: { value: "Ta" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(499);
  });
  expect(gql).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Taylor" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(499);
  });
  expect(gql).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(gql).toHaveBeenCalledTimes(1);
  expect(gql).toHaveBeenCalledWith(
    expect.stringContaining("PlayerSuggestions"),
    { search: "Taylor" },
  );
  client.clear();
});
it("does not search after the dropdown is dismissed before the delay finishes", async () => {
  vi.useFakeTimers();
  const { client, input } = setup();
  fireEvent.change(input, { target: { value: "Taylor" } });
  fireEvent.keyDown(input, { key: "Escape" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(gql).not.toHaveBeenCalled();
  client.clear();
});
