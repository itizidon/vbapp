import React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SkillRadarProfile } from "../src/components/skill-radar-profile";
import { gql } from "../src/lib/api";

vi.mock("../src/lib/hooks", () => ({
  useUser: () => ({ data: { me: { id: "player" } } }),
  useCatalog: () => ({ data: { sports: [{ id: "beach" }] } }),
}));
vi.mock("../src/lib/api", () => ({ gql: vi.fn() }));

it("refreshes the current self-assessment when selected after the page opened", async () => {
  let savedSelfRating = 2;
  vi.mocked(gql).mockImplementation(async () => ({
    skillRadarProfile: {
      asOf: null,
      skills: ["Passing", "Setting", "Attack", "Serving", "Defense"].map(
        (name) => ({
          skillId: name,
          skillName: name,
          skillSlug: name.toLowerCase(),
          internalRating: 3,
          selfRating: savedSelfRating,
          averageFeedbackRating: null,
        }),
      ),
    },
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SkillRadarProfile immersive />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Passing: 3 out of 5" });

  // Simulate an assessment saved in another session after this page loaded.
  savedSelfRating = 5;
  fireEvent.click(
    screen.getByRole("switch", { name: "Self-assessment ratings" }),
  );
  await screen.findByRole("button", { name: "Passing: 5 out of 5" });
  expect(screen.getByRole("switch")).toBeChecked();
  for (const [query, variables] of vi.mocked(gql).mock.calls) {
    expect(query).not.toContain("$asOf");
    expect(variables).toEqual({ userId: "player", sportId: "beach" });
  }
  client.clear();
});
