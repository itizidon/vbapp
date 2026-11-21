"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser as useClerkUser } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { useCatalog, useUser } from "@/lib/hooks";
import { gql } from "@/lib/api";
import { Brand } from "./app-shell";
import { RatingStars, Pending } from "./common";
import { Button } from "./ui/button";
export function PlayerOnboarding({
  returnTo = "/matches",
}: {
  returnTo?: string;
}) {
  const account = useUser(),
    catalog = useCatalog(),
    router = useRouter(),
    client = useQueryClient(),
    clerk = useClerkUser();
  const [age, setAge] = useState(""),
    [height, setHeight] = useState(""),
    [level, setLevel] = useState(""),
    [ratings, setRatings] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const me = account.data?.me;
    if (!me?.onboardingComplete) return;
    let cancelled = false;
    void gql<{
      mySelfAssessments: {
        overallLevel: string;
        ratings: { skillId: string; rating: number }[];
      }[];
    }>("{mySelfAssessments{overallLevel ratings{skillId rating}}}")
      .then((data) => {
        if (cancelled) return;
        setAge(String(me.age ?? ""));
        setHeight(String(me.heightCm ?? ""));
        const a = data.mySelfAssessments[0];
        if (a) {
          setLevel(a.overallLevel);
          setRatings(
            Object.fromEntries(a.ratings.map((r) => [r.skillId, r.rating])),
          );
        }
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Your saved profile could not be loaded. Please refresh before editing.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [account.data?.me]);
  const sport = catalog.data?.sports.find((s) => s.slug === "beach-volleyball"),
    skills = sport?.skills.filter((s) => s.active) ?? [];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sport) return;
    setBusy(true);
    setError("");
    try {
      await gql(
        "mutation CompletePlayerOnboarding($input:PlayerOnboardingInput!){completePlayerOnboarding(input:$input){id onboardingComplete}}",
        {
          input: {
            age: Number(age),
            heightCm: Number(height),
            sportId: sport.id,
            overallLevel: level,
            ratings: Object.entries(ratings).map(([skillId, rating]) => ({
              skillId,
              rating,
            })),
          },
        },
      );
      await clerk.user?.reload();
      client.clear();
      router.replace(returnTo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl space-y-7 px-5 py-8">
      <Brand />
      <section className="panel space-y-5">
        <h1>Your player profile</h1>
        <p className="subtle">
          Tell us about your game. Age, height and self-assessment are private.
        </p>
        {catalog.isPending ? (
          <Pending label="Loading volleyball skills…" />
        ) : catalog.error ? (
          <p role="alert" className="error">
            {catalog.error.message}
          </p>
        ) : (
          <form
            method="post"
            action="/api/auth/form"
            onSubmit={submit}
            className="space-y-5"
          >
            <div className="grid grid-cols-2 gap-4">
              <label className="field">
                Age
                <input
                  type="number"
                  min={13}
                  max={120}
                  required
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </label>
              <label className="field">
                Height (cm)
                <input
                  type="number"
                  min={50}
                  max={300}
                  required
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              Volleyball level
              <select
                required
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                <option value="">Select your level</option>
                {["B", "BB", "A", "AA", "OPEN"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <h2>Your current self-assessment</h2>
            {skills.map((s) => (
              <div key={s.id} className="space-y-2">
                <p>
                  {s.name}
                  {s.requiredForSelfAssessment ? " *" : ""}
                </p>
                <RatingStars
                  label={s.name}
                  value={ratings[s.id] ?? 0}
                  onChange={(value) =>
                    setRatings((r) => ({ ...r, [s.id]: Math.round(value) }))
                  }
                />
              </div>
            ))}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <Button disabled={busy || !sport}>
              {busy
                ? "Saving…"
                : account.data?.me.onboardingComplete
                  ? "Save profile"
                  : "Complete profile"}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
