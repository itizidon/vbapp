import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignupForm } from "../src/components/auth-form";

const mocks = vi.hoisted(() => ({
  gql: vi.fn(),
  push: vi.fn(),
  catalog: {
    data: { sports: [] as object[] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../src/lib/hooks", () => ({ useCatalog: () => mocks.catalog }));
vi.mock("../src/lib/api", () => ({ gql: mocks.gql, USER_FIELDS: "id" }));
vi.mock("../src/components/app-shell", () => ({
  Brand: () => null,
  ThemeToggle: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog.data.sports = [
    {
      id: "beach-id",
      slug: "beach-volleyball",
      name: "Beach Volleyball",
      skills: [
        {
          id: "passing-id",
          name: "Passing",
          active: true,
          requiredForSelfAssessment: true,
        },
      ],
    },
  ];
  mocks.gql.mockResolvedValue({ register: { user: { id: "user-id" } } });
});
function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SignupForm />
    </QueryClientProvider>,
  );
}
it("registers with Beach Volleyball and required ratings without a sport selector", async () => {
  setup();
  expect(screen.queryByLabelText("Your sport")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "tester" },
  });
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "tester@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password · at least 12 characters"), {
    target: { value: "a-long-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByText(
    "Rate every required skill and at least one skill to continue.",
  );
  expect(mocks.gql).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Passing: 4 out of 5" }));
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() =>
    expect(mocks.gql).toHaveBeenCalledWith(expect.any(String), {
      input: expect.objectContaining({
        sportId: "beach-id",
        ratings: [{ skillId: "passing-id", rating: 4 }],
      }),
    }),
  );
});
it("blocks signup when the Beach Volleyball catalog is missing", () => {
  mocks.catalog.data.sports = [];
  setup();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Player skills are not available yet",
  );
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
});
