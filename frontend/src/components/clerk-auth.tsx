"use client";
import { SignIn, SignUp } from "@clerk/nextjs";
import { safeReturnTo, authHref } from "@/lib/navigation";
import { Brand, ThemeToggle } from "./app-shell";
export function ClerkAuthPage({
  mode,
  returnTo,
}: {
  mode: "login" | "signup";
  returnTo?: string;
}) {
  const destination = safeReturnTo(returnTo);
  const onboarding = returnTo
    ? `/onboarding?${new URLSearchParams({ next: destination })}`
    : "/onboarding";
  return (
    <main className="min-h-dvh px-5 py-7">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <Brand />
        <ThemeToggle />
      </header>
      <section className="mx-auto flex max-w-lg flex-col items-center gap-6 py-12">
        <h1>{mode === "login" ? "Welcome back." : "Join BVBTips."}</h1>
        <p className="subtle text-center">Your next chapter on the sand.</p>
        {!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <p role="alert" className="panel">
            Authentication needs configuration. Add your Clerk development keys
            to the frontend and backend environments.
          </p>
        ) : mode === "login" ? (
          <SignIn
            routing="path"
            path="/login"
            signUpUrl={returnTo ? authHref("/signup", destination) : "/signup"}
            fallbackRedirectUrl={destination}
            appearance={{
              elements: { rootBox: "w-full", cardBox: "w-full shadow-none" },
            }}
          />
        ) : (
          <SignUp
            routing="path"
            path="/signup"
            signInUrl={returnTo ? authHref("/login", destination) : "/login"}
            fallbackRedirectUrl={onboarding}
            appearance={{
              elements: { rootBox: "w-full", cardBox: "w-full shadow-none" },
            }}
          />
        )}
      </section>
    </main>
  );
}
