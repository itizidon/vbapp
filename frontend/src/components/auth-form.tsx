"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { notifyAuthChanged } from "@/lib/auth-session";
import { authHref, safeReturnTo } from "@/lib/navigation";
import { gql, USER_FIELDS } from "@/lib/api";
import { useCatalog } from "@/lib/hooks";
import { loginSchema, signupSchema, validateRatings } from "@/lib/validation";
import type { User } from "@/lib/types";
import type { z } from "zod";
import { Brand, ThemeToggle } from "./app-shell";
import { Button } from "./ui/button";
import { RatingStars, Pending, ErrorState } from "./common";
function AuthFrame({
  signup,
  children,
  returnTo,
}: {
  returnTo: string;
  signup: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-[#192e68] p-12 text-white lg:flex">
        <div className="text-xl font-bold">courtside.</div>
        <div className="max-w-md">
          <div className="mb-7 flex size-16 items-center justify-center rounded-2xl bg-white/10">
            <ShieldCheck size={32} />
          </div>
          <p className="mb-6 text-4xl font-semibold leading-tight tracking-tight">
            A better game begins with a fresh perspective.
          </p>
          <p className="text-blue-100">
            A thoughtful space for honest feedback, shared progress, and the
            people who help you grow.
          </p>
          <div className="mt-10 space-y-4 text-sm">
            {[
              "Feedback with a purpose",
              "Progress you can understand",
              "Your perspective. Your choice.",
            ].map((t) => (
              <p key={t} className="flex items-center gap-3">
                <Check size={17} />
                {t}
              </p>
            ))}
          </div>
        </div>
        <p className="text-xs text-blue-200">Made for the love of the game.</p>
      </section>
      <section className="px-5 py-7 sm:px-10">
        <div className="flex items-center justify-between">
          <Brand />
          <ThemeToggle />
        </div>
        <div className="mx-auto max-w-md py-12">
          <p className="eyebrow mb-3">
            {signup ? "Your next chapter" : "Back in your corner"}
          </p>
          <h1>{signup ? "Let’s grow your game." : "Welcome back."}</h1>
          <p className="subtle mb-8 mt-3">
            {signup
              ? "Build your player profile and start with your own perspective."
              : "Sign in to see what’s moving your game forward."}
          </p>
          {children}
          <p className="subtle mt-7 text-center text-sm">
            {signup ? "Already part of the team? " : "New around here? "}
            <Link
              className="font-semibold text-primary"
              href={authHref(signup ? "/login" : "/signup", returnTo)}
            >
              {signup ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
export function LoginForm({ returnTo = "/matches" }: { returnTo?: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { login: "", password: "" },
  });
  const mutation = useMutation({
    mutationFn: (input: z.infer<typeof loginSchema>) =>
      gql<{ login: { user: User } }>(
        `mutation Login($input:LoginInput!){login(input:$input){accessToken user {${USER_FIELDS}}}}`,
        { input },
      ),
    onSuccess: (data) => {
      client.clear();
      client.setQueryData(["me"], { me: data.login.user });
      notifyAuthChanged();
      router.push(safeReturnTo(returnTo));
    },
  });
  return (
    <AuthFrame signup={false} returnTo={returnTo}>
      <form
        onSubmit={form.handleSubmit((input) => mutation.mutate(input))}
        className="space-y-5"
        noValidate
      >
        <label className="field">
          Email or username
          <input
            autoComplete="username"
            {...form.register("login")}
            aria-invalid={!!form.formState.errors.login}
          />
          {form.formState.errors.login && (
            <span className="error">{form.formState.errors.login.message}</span>
          )}
        </label>
        <label className="field">
          Password
          <input
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
            aria-invalid={!!form.formState.errors.password}
          />
          {form.formState.errors.password && (
            <span className="error">
              {form.formState.errors.password.message}
            </span>
          )}
        </label>
        {mutation.error && (
          <p role="alert" className="error">
            {mutation.error.message}
          </p>
        )}
        <Button className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Pending label="Signing in…" />
          ) : (
            <>
              Sign in
              <ArrowRight size={16} />
            </>
          )}
        </Button>
      </form>
      <p className="subtle mt-4 text-xs">
        Password recovery is not available yet.
      </p>
    </AuthFrame>
  );
}
const signupFormSchema = signupSchema.omit({ sportId: true });
export function SignupForm({ returnTo = "/matches" }: { returnTo?: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const catalog = useCatalog();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [ratingError, setRatingError] = useState("");
  const form = useForm<z.infer<typeof signupFormSchema>>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      age: 18,
      heightCm: 170,
      overallLevel: "B",
    },
  });
  const sport = catalog.data?.sports.find((s) => s.slug === "beach-volleyball");
  const skills = sport?.skills.filter((s) => s.active) ?? [];
  const mutation = useMutation({
    mutationFn: (input: z.infer<typeof signupFormSchema>) =>
      gql<{ register: { user: User } }>(
        `mutation Register($input:RegisterInput!){register(input:$input){accessToken user {${USER_FIELDS}}}}`,
        {
          input: {
            ...input,
            sportId: sport!.id,
            ratings: Object.entries(ratings)
              .filter(([, rating]) => rating > 0)
              .map(([skillId, rating]) => ({ skillId, rating })),
          },
        },
      ),
    onSuccess: (data) => {
      client.clear();
      client.setQueryData(["me"], { me: data.register.user });
      notifyAuthChanged();
      router.push(safeReturnTo(returnTo));
    },
  });
  function submit(input: z.infer<typeof signupFormSchema>) {
    if (!sport) return;
    const values = Object.entries(ratings)
      .filter(([, rating]) => rating > 0)
      .map(([skillId, rating]) => ({ skillId, rating }));
    if (
      !validateRatings(values) ||
      skills.some((s) => s.requiredForSelfAssessment && !ratings[s.id])
    ) {
      setRatingError(
        "Rate every required skill and at least one skill to continue.",
      );
      return;
    }
    setRatingError("");
    mutation.mutate(input);
  }
  return (
    <AuthFrame signup returnTo={returnTo}>
      <form
        onSubmit={form.handleSubmit(submit)}
        className="space-y-5"
        noValidate
      >
        {(
          [
            ["username", "Username", "text", "username"],
            ["email", "Email address", "email", "email"],
            [
              "password",
              "Password · at least 12 characters",
              "password",
              "new-password",
            ],
          ] as const
        ).map(([name, label, type, autoComplete]) => (
          <label className="field" key={name}>
            {label}
            <input
              type={type}
              autoComplete={autoComplete}
              {...form.register(name)}
              aria-invalid={!!form.formState.errors[name]}
            />
            {form.formState.errors[name] && (
              <span className="error">
                {form.formState.errors[name]?.message}
              </span>
            )}
          </label>
        ))}
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ["age", "Age"],
              ["heightCm", "Height (cm)"],
            ] as const
          ).map(([name, label]) => (
            <label className="field" key={name}>
              {label}
              <input
                type="number"
                {...form.register(name, { valueAsNumber: true })}
              />
              {form.formState.errors[name] && (
                <span className="error">
                  {form.formState.errors[name]?.message}
                </span>
              )}
            </label>
          ))}
        </div>
        <p className="subtle text-xs">
          Age and height are required by the backend and are not shown publicly.
        </p>
        {catalog.error ? (
          <ErrorState error={catalog.error} retry={() => catalog.refetch()} />
        ) : catalog.isPending ? (
          <Pending label="Loading player skills…" />
        ) : !sport ? (
          <p role="alert" className="error">
            Player skills are not available yet. Please try again later.
          </p>
        ) : null}
        {sport && (
          <>
            <label className="field">
              Overall level
              {["volleyball", "beach-volleyball"].includes(sport.slug) ? (
                <select {...form.register("overallLevel")}>
                  {["B", "BB", "A", "AA", "OPEN"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              ) : (
                <input
                  {...form.register("overallLevel")}
                  placeholder="Your current level"
                />
              )}
            </label>
            <div className="space-y-4 rounded-xl border border-border p-4">
              <h2>How do you see your game?</h2>
              <p className="subtle text-xs">
                Self-assessments use the backend’s 1–5 scale. Required skills
                are marked *.
              </p>
              {skills.map((s) => (
                <div key={s.id}>
                  <label>
                    {s.name}
                    {s.requiredForSelfAssessment ? " *" : " (optional)"}
                  </label>
                  <RatingStars
                    label={s.name}
                    value={ratings[s.id] ?? 0}
                    onChange={(n) => setRatings((r) => ({ ...r, [s.id]: n }))}
                  />
                </div>
              ))}
            </div>
          </>
        )}
        {ratingError && (
          <p role="alert" className="error">
            {ratingError}
          </p>
        )}
        {mutation.error && (
          <p role="alert" className="error">
            {mutation.error.message}
          </p>
        )}
        <Button
          className="w-full"
          disabled={
            mutation.isPending || catalog.isPending || !!catalog.error || !sport
          }
        >
          {mutation.isPending ? (
            <Pending label="Creating account…" />
          ) : (
            <>
              Create account
              <ArrowRight size={16} />
            </>
          )}
        </Button>
      </form>
    </AuthFrame>
  );
}
