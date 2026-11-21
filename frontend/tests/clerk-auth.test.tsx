import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@clerk/nextjs", () => ({
  SignIn: (props: {
    path: string;
    signUpUrl: string;
    fallbackRedirectUrl: string;
  }) => (
    <div
      data-testid="clerk-signin"
      data-path={props.path}
      data-return-to={props.fallbackRedirectUrl}
    >
      Clerk Sign In
    </div>
  ),
  SignUp: (props: { path: string; signInUrl: string }) => (
    <div data-testid="clerk-signup" data-path={props.path}>
      Clerk Sign Up
    </div>
  ),
}));
vi.mock("@/components/app-shell", () => ({
  Brand: () => <div>BVBTips</div>,
  ThemeToggle: () => null,
}));
import { ClerkAuthPage } from "@/components/clerk-auth";
afterEach(() => vi.unstubAllEnvs());
it("uses Clerk to own sign-in, verification, social login and recovery", () => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture");
  render(<ClerkAuthPage mode="login" />);
  expect(screen.getByTestId("clerk-signin")).toHaveAttribute(
    "data-path",
    "/login",
  );
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});
it("uses the Clerk signup widget", () => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture");
  render(<ClerkAuthPage mode="signup" />);
  expect(screen.getByTestId("clerk-signup")).toHaveAttribute(
    "data-path",
    "/signup",
  );
});
it("shows configuration requirements without generating a second auth system", () => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
  render(<ClerkAuthPage mode="login" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Clerk development keys");
  expect(screen.queryByTestId("clerk-signin")).not.toBeInTheDocument();
});

it("preserves a guest review return path without permitting external redirects", () => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_fixture");
  const view = render(
    <ClerkAuthPage mode="login" returnTo="/f/opaque-invitation" />,
  );
  expect(screen.getByTestId("clerk-signin")).toHaveAttribute(
    "data-return-to",
    "/f/opaque-invitation",
  );
  view.rerender(<ClerkAuthPage mode="login" returnTo="//evil.example" />);
  expect(screen.getByTestId("clerk-signin")).toHaveAttribute(
    "data-return-to",
    "/matches",
  );
});
