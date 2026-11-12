"use client";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Flame, Volleyball, Star } from "lucide-react";
import { gql } from "@/lib/api";
import { ErrorState } from "./common";
export interface PerformanceSummaryData {
  winRate: number | null;
  currentStreak: number;
  streakKind: string;
  gamesPlayed: number;
  averagePlayerRating: number | null;
  ratedSkillCount: number;
}
export function PerformanceSummaryCards() {
  const summary = useQuery({
    queryKey: ["performance-summary"],
    queryFn: () =>
      gql<{ myPerformanceSummary: PerformanceSummaryData }>(
        `query MyPerformanceSummary{myPerformanceSummary{winRate currentStreak streakKind gamesPlayed averagePlayerRating ratedSkillCount}}`,
      ),
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const data = summary.data?.myPerformanceSummary;
  const values = [
    {
      label: "Win rate",
      value: data?.winRate == null ? "—" : `${data.winRate.toFixed(1)}%`,
      note: "Decisive scored games",
      icon: Trophy,
      tone: data?.winRate != null && data.winRate >= 50 ? "positive" : "",
    },
    {
      label: "Current streak",
      value: data
        ? `${data.currentStreak}${data.streakKind === "WIN" ? "W" : data.streakKind === "LOSS" ? "L" : ""}`
        : "—",
      note:
        data?.streakKind === "WIN"
          ? "Scored wins in a row"
          : data?.streakKind === "LOSS"
            ? "Scored losses in a row"
            : "No active streak",
      icon: Flame,
      tone:
        data?.streakKind === "WIN"
          ? "positive"
          : data?.streakKind === "LOSS"
            ? "negative"
            : "",
    },
    {
      label: "Games played",
      value: data ? String(data.gamesPlayed) : "—",
      note: "Completed matches",
      icon: Volleyball,
      tone: "",
    },
    {
      label: "Average player rating",
      value:
        data?.averagePlayerRating == null
          ? "—"
          : data.averagePlayerRating.toFixed(2),
      note: data
        ? `${data.ratedSkillCount} rated skills · Internal / 5`
        : "Internal rating / 5",
      icon: Star,
      tone: "",
    },
  ];
  return (
    <div
      className="performance-summary"
      aria-label="Career performance statistics"
    >
      {summary.error && (
        <div className="performance-summary__error">
          <ErrorState error={summary.error} retry={() => summary.refetch()} />
        </div>
      )}
      {values.map(({ label, value, note, icon: Icon, tone }) => (
        <div
          className={`performance-stat ${tone}`}
          key={label}
          aria-busy={summary.isPending}
        >
          <div className="performance-stat__label">
            <Icon size={15} />
            <span>{label}</span>
          </div>
          <p className="performance-stat__value">
            {summary.isPending || summary.error ? "—" : value}
          </p>
          <p className="performance-stat__note">
            {summary.isPending
              ? "Loading…"
              : summary.error
                ? "Unavailable"
                : note}
          </p>
        </div>
      ))}
    </div>
  );
}
