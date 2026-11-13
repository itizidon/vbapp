"use client";
import { useQuery } from "@tanstack/react-query";
import { Star, MessageSquare, TrendingUp } from "lucide-react";
import { gql } from "@/lib/api";
import { useCatalog, useUser } from "@/lib/hooks";
import { feedbackSummary } from "@/lib/feedback-history";
import type { SkillAverage } from "@/lib/types";

export function FeedbackSummaryStats() {
  const user = useUser(),
    catalog = useCatalog();
  const sport = catalog.data?.sports[0];
  const summary = useQuery({
    queryKey: ["feedback", "history-summary", user.data?.me.id, sport?.id],
    enabled: !!user.data && !!sport,
    queryFn: () =>
      gql<{
        userSkillRatings: SkillAverage[];
        feedbackCount: { count: number };
      }>(
        `query FeedbackHistorySummary($userId:ID!,$sportId:ID!){userSkillRatings(userId:$userId,sportId:$sportId){skillId average count} feedbackCount(userId:$userId,sportId:$sportId){count}}`,
        { userId: user.data!.me.id, sportId: sport!.id },
      ),
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const loading =
    user.isPending || catalog.isPending || (!!sport && summary.isPending);
  const unavailable =
    !!(summary.error || user.error || catalog.error) || !sport;
  const data = summary.data;
  const { average, top } = feedbackSummary(
    data?.userSkillRatings ?? [],
    sport?.skills ?? [],
  );
  const ready = !unavailable && !!data;
  const stats = [
    {
      label: "Average feedback rating",
      value: ready && average !== null ? average.toFixed(2) : "—",
      note: "Published ratings · out of 5",
      Icon: Star,
    },
    {
      label: "Total reviews",
      value: ready ? String(data.feedbackCount.count) : "—",
      note: "Published submissions received",
      Icon: MessageSquare,
    },
    {
      label: "Top-rated skill",
      value: ready && top ? top.name : "—",
      note:
        ready && top
          ? `${top.average.toFixed(2)} / 5 · ${top.count < 3 ? "Limited data: " : ""}${top.count} ${top.count === 1 ? "rating" : "ratings"}`
          : "No rated skills yet",
      Icon: TrendingUp,
    },
  ];
  return (
    <div
      className="feedback-summary"
      aria-label="Feedback summary"
      aria-busy={loading}
    >
      {stats.map(({ label, value, note, Icon }) => (
        <div className="performance-stat" key={label}>
          <p className="feedback-summary__label">
            <Icon size={16} aria-hidden="true" />
            {label}
          </p>
          <p className="feedback-summary__value">{value}</p>
          <p className="subtle text-xs">
            {loading ? "Loading…" : unavailable ? "Summary unavailable" : note}
          </p>
        </div>
      ))}
      {summary.error && (
        <button
          className="feedback-summary__retry"
          onClick={() => void summary.refetch()}
        >
          Retry summary
        </button>
      )}
    </div>
  );
}
