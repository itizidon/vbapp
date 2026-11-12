"use client";
import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { gql } from "@/lib/api";
import { useUser } from "@/lib/hooks";
import { ErrorState, EmptyState, Pending } from "./common";
import { displayFeedbackTime } from "@/lib/analytics";
export interface HistoryPoint {
  id: string;
  sequence: string;
  timestamp: string;
  recordedAt: string;
  previousRating: number | null;
  newRating: number;
  delta: number;
  type: string;
}
export interface HistoryPage {
  items: HistoryPoint[];
  baseline: HistoryPoint | null;
  hasMore: boolean;
  nextCursor: string | null;
  revision: number;
}
export function historyChartPoints(pages: HistoryPage[], from?: string | null) {
  const baseline = pages[0]?.baseline;
  return [
    ...(baseline && from
      ? [{ ...baseline, timestamp: from, type: "OPENING_BASELINE", delta: 0 }]
      : []),
    ...pages.flatMap((p) => p.items),
  ].map((p) => ({ ...p, time: Date.parse(p.timestamp), value: p.newRating }));
}
export function RatingHistoryChart({
  skillId,
  name,
  mode,
  from,
  before,
  timeZone,
}: {
  skillId: string;
  name: string;
  mode: "internal" | "self";
  from: string | null;
  before: string;
  timeZone: string;
}) {
  const user = useUser();
  const history = useInfiniteQuery({
    queryKey: ["rating-history", user.data?.me.id, skillId, mode, from, before],
    initialPageParam: undefined as
      { cursor: string; revision: number } | undefined,
    queryFn: async ({ pageParam }) => {
      const field =
        mode === "internal" ? "internalRatingHistory" : "selfAssessmentHistory";
      const result = await gql<{ history: HistoryPage }>(
        `query RatingHistory($userId:ID!,$skillId:ID!,$from:DateTime,$before:DateTime,$cursor:String${mode === "internal" ? ",$revision:Int" : ""}){history:${field}(userId:$userId,skillId:$skillId,from:$from,before:$before,cursor:$cursor,limit:250${mode === "internal" ? ",revision:$revision" : ""}){items{id sequence timestamp recordedAt previousRating newRating delta type} baseline{id sequence timestamp recordedAt previousRating newRating delta type} hasMore nextCursor revision}}`,
        {
          userId: user.data!.me.id,
          skillId,
          from,
          before,
          cursor: pageParam?.cursor,
          ...(mode === "internal" ? { revision: pageParam?.revision } : {}),
        },
      );
      return result.history;
    },
    getNextPageParam: (p) =>
      p.hasMore && p.nextCursor
        ? { cursor: p.nextCursor, revision: p.revision }
        : undefined,
    enabled: !!user.data?.me.id,
    refetchOnWindowFocus: "always",
  });
  useEffect(() => {
    if (history.hasNextPage && !history.isFetching && !history.error)
      void history.fetchNextPage();
  }, [
    history.hasNextPage,
    history.isFetching,
    history.error,
    history.fetchNextPage,
  ]);
  const points = historyChartPoints(history.data?.pages ?? [], from);
  if (user.error || history.error)
    return (
      <ErrorState
        error={(user.error ?? history.error)!}
        retry={() => {
          void history.refetch();
          void user.refetch();
        }}
      />
    );
  if (
    user.isPending ||
    history.isPending ||
    history.hasNextPage ||
    history.isFetchingNextPage
  )
    return <Pending label="Loading rating history…" />;
  if (!points.length)
    return (
      <EmptyState title="No rating history for this period">
        An initial self-assessment starts your internal rating. Existing
        accounts may need the rating-history backfill.
      </EmptyState>
    );
  const start = from ? Date.parse(from) : points[0].time,
    end = Math.max(start + 1000, Date.parse(before));
  return (
    <div className="space-y-4">
      <p className="subtle text-sm">
        {mode === "internal" ? "Internal rating" : "Self-assessment"} · {name} ·
        Latest {points[points.length - 1].value.toFixed(4)} / 5
      </p>
      <div
        className="h-80 min-w-0 sm:h-96"
        aria-label={`${mode === "internal" ? "Internal rating" : "Self-assessment"} history chart`}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={points}
            accessibilityLayer
            margin={{ top: 16, right: 12, left: 0, bottom: 8 }}
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={[start, end]}
              tickFormatter={(v) =>
                new Date(Number(v)).toLocaleDateString(undefined, {
                  timeZone,
                  month: "short",
                  day: "numeric",
                })
              }
              minTickGap={40}
            />
            <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} width={30} />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as
                  (typeof points)[number] | undefined;
                return active && p ? (
                  <div className="rounded-xl border border-border bg-card p-3 text-sm">
                    <p>{displayFeedbackTime(p.time, timeZone)}</p>
                    <p>
                      {name}: {p.value.toFixed(4)} / 5
                    </p>
                    <p>
                      {p.type.replaceAll("_", " ")}
                      {p.type === "OPENING_BASELINE"
                        ? ""
                        : ` · ${p.delta >= 0 ? "+" : ""}${p.delta.toFixed(4)}`}
                    </p>
                  </div>
                ) : null;
              }}
            />
            <Line
              type="stepAfter"
              dataKey="value"
              name={name}
              stroke="var(--primary)"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="subtle text-xs">
        {mode === "internal"
          ? "Backend-calculated ratings. Corrections rebuild this skill using the original reviewer snapshots; this chart shows the latest revision."
          : "Recorded self-assessment changes. Editing your self-assessment does not reset your internal rating."}{" "}
        Times shown in {timeZone}. An opening baseline carries forward the last
        known value.
      </p>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          View rating history
        </summary>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Rating</th>
                <th className="p-2">Change</th>
                <th className="p-2">Event</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr
                  key={`${p.id}:${p.type}`}
                  className="border-t border-border"
                >
                  <td className="p-2">
                    {displayFeedbackTime(p.time, timeZone)}
                  </td>
                  <td className="p-2">{p.value.toFixed(4)}</td>
                  <td className="p-2">
                    {p.delta >= 0 ? "+" : ""}
                    {p.delta.toFixed(4)}
                  </td>
                  <td className="p-2">{p.type.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
