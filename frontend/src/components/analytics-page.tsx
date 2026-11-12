"use client";
import { PerformanceProfile } from "./performance-profile";
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { gql } from "@/lib/api";
import {
  ANALYTICS_RANGES,
  analyticsBounds,
  categoryAverage,
  dayTimestamp,
  displayDay,
  type AnalyticsRange,
  type AnalyticsData,
  type IndividualFeedback,
  displayFeedbackTime,
} from "@/lib/analytics";
import { RatingHistoryChart } from "./rating-history-chart";
import { AnalyticsChart } from "./analytics-chart";
import { Button } from "./ui/button";
import { LoadingSkeleton, ErrorState, EmptyState } from "./common";
export function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>("1M");
  const [selected, setSelected] = useState("winRate");
  const [mode, setMode] = useState("daily");
  const individualMode = mode === "individual";
  const historyMode = mode === "internal" || mode === "self";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const analytics = useQuery({
    queryKey: ["analytics", range, timeZone],
    queryFn: () =>
      gql<{ myAnalytics: AnalyticsData }>(
        `query MyAnalytics($from:DateTime,$before:DateTime,$timeZone:String!){myAnalytics(from:$from,before:$before,timeZone:$timeZone){categories{id name description} points{date winRate wins losses ratings{skillId average count}} wins losses ratingCount from before timeZone}}`,
        { ...analyticsBounds(range), timeZone },
      ),
    staleTime: 0,
    refetchOnWindowFocus: "always",
    placeholderData: keepPreviousData,
  });
  const data = analytics.data?.myAnalytics;
  const category = data?.categories.find((item) => item.id === selected);
  const winRate = !category;
  const individual = individualMode && !!category;
  const feedback = useQuery({
    queryKey: ["analytics-feedback", category?.id, data?.from, data?.before],
    queryFn: () =>
      gql<{ myCategoryFeedback: IndividualFeedback[] }>(
        `query MyCategoryFeedback($skillId:ID!,$from:DateTime,$before:DateTime){myCategoryFeedback(skillId:$skillId,from:$from,before:$before){id submittedAt rating}}`,
        { skillId: category!.id, from: data!.from, before: data!.before },
      ),
    enabled: individual && !!data && !analytics.isPlaceholderData,
    refetchOnWindowFocus: false,
  });
  const samples = feedback.data?.myCategoryFeedback ?? [];
  const busy =
    analytics.isPending ||
    analytics.isPlaceholderData ||
    (individual && feedback.isPending);
  const chartError = analytics.error ?? (individual ? feedback.error : null);
  const games = (data?.wins ?? 0) + (data?.losses ?? 0);
  const points =
    data?.points.filter((point) =>
      winRate
        ? point.winRate !== null
        : point.ratings.some((rating) => rating.skillId === category.id),
    ) ?? [];
  const ratingCount = category
    ? points.reduce(
        (sum, point) =>
          sum +
          (point.ratings.find((rating) => rating.skillId === category.id)
            ?.count ?? 0),
        0,
      )
    : (data?.ratingCount ?? 0);
  return (
    <>
      <PerformanceProfile onSkillSelect={setSelected} />
      <section className="panel min-w-0 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2>Performance over time</h2>
          <p className="subtle text-xs">
            {individual ? "Individual ratings" : "Daily"} · {timeZone}
          </p>
        </div>
        <div
          role="group"
          aria-label="Time frame"
          className="flex max-w-full gap-2 overflow-x-auto pb-2"
        >
          {ANALYTICS_RANGES.map((option) => (
            <Button
              key={option.id}
              variant={range === option.id ? "default" : "ghost"}
              className="shrink-0"
              aria-label={option.name}
              aria-pressed={range === option.id}
              onClick={() => setRange(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <label className="field max-w-sm">
          Chart metric
          <select
            value={category?.id ?? "winRate"}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="winRate" disabled={historyMode}>
              Win rate
            </option>
            {data?.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field max-w-sm">
          Chart mode
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
              if (
                ["internal", "self"].includes(event.target.value) &&
                !category &&
                data?.categories[0]
              )
                setSelected(data.categories[0].id);
            }}
          >
            <option value="daily">Daily average</option>
            <option value="individual">Each feedback</option>
            <option value="internal">Internal rating</option>
            <option value="self">Self-assessment</option>
          </select>
        </label>
        {category?.description && (
          <p className="subtle text-sm">{category.description}</p>
        )}
        {!historyMode && (
          <div className="space-y-2">
            <div className="grid max-w-sm grid-cols-[1fr_auto_1fr] items-center gap-2 text-center text-sm">
              <span
                className={
                  !individual ? "font-semibold text-primary" : "subtle"
                }
              >
                Daily average
              </span>
              <button
                type="button"
                role="switch"
                aria-label="Individual feedback"
                aria-checked={individual}
                disabled={winRate}
                aria-describedby="analytics-mode-description"
                className="inline-flex min-h-11 items-center rounded-lg p-1 disabled:opacity-50"
                onClick={() => setMode(individualMode ? "daily" : "individual")}
              >
                <span
                  className={`inline-flex h-7 w-12 items-center rounded-full p-1 transition-colors ${individual ? "bg-primary" : "bg-muted-foreground"}`}
                >
                  <span
                    className={`size-5 rounded-full bg-white shadow transition-transform ${individual ? "translate-x-5" : "translate-x-0"}`}
                  />
                </span>
              </button>
              <span
                className={individual ? "font-semibold text-primary" : "subtle"}
              >
                Individual feedback
              </span>
            </div>
            <p id="analytics-mode-description" className="subtle text-xs">
              {winRate
                ? "Select a feedback category to view individual ratings. Win rate is shown per day."
                : individual
                  ? "Each point is one received rating at its submission time."
                  : "Each point is the daily average for the selected category."}
            </p>
          </div>
        )}
        <div
          className="grid gap-3 sm:grid-cols-3"
          aria-label="Analytics summary"
        >
          <div className="rounded-xl bg-muted p-4">
            <p className="subtle text-xs">Win rate in this period</p>
            <p className="mt-1 text-2xl font-bold">
              {busy || !games
                ? "—"
                : `${((data!.wins / games) * 100).toFixed(1)}%`}
            </p>
            <p className="subtle mt-1 text-xs">
              {busy
                ? "Updating…"
                : `${data?.wins ?? 0} wins · ${data?.losses ?? 0} losses`}
            </p>
          </div>
          <div className="rounded-xl bg-muted p-4">
            <p className="subtle text-xs">Scored games</p>
            <p className="mt-1 text-2xl font-bold">{busy ? "—" : games}</p>
            <p className="subtle mt-1 text-xs">
              Ties and incomplete scores excluded
            </p>
          </div>
          <div className="rounded-xl bg-muted p-4">
            <p className="subtle text-xs">
              {category ? `${category.name} ratings` : "Ratings received"}
            </p>
            <p className="mt-1 text-2xl font-bold">
              {busy ? "—" : ratingCount}
            </p>
            <p className="subtle mt-1 text-xs">Received · Published feedback</p>
          </div>
        </div>
        <div aria-busy={busy}>
          {historyMode && category && data && !analytics.isPlaceholderData ? (
            <RatingHistoryChart
              key={`${category.id}:${mode}:${range}`}
              skillId={category.id}
              name={category.name}
              mode={mode as "internal" | "self"}
              from={data.from}
              before={data.before}
              timeZone={timeZone}
            />
          ) : chartError ? (
            <ErrorState
              error={chartError}
              retry={() =>
                individual ? feedback.refetch() : analytics.refetch()
              }
            />
          ) : busy ? (
            <LoadingSkeleton />
          ) : !(individual ? samples.length : points.length) ? (
            <EmptyState title="No data for this metric">
              Try a longer time frame or choose another metric.
            </EmptyState>
          ) : (
            data && (
              <AnalyticsChart
                data={{ ...data, points }}
                category={category}
                individualFeedback={individual ? samples : undefined}
              />
            )
          )}
        </div>
        {!historyMode && (
          <p className="subtle text-xs leading-6">
            {individual
              ? "Individual mode shows every published rating you received for this category, on a 1–5 scale. Points use the exact submission time; lines connect submissions without averaging them."
              : "Win rate uses your team’s fully recorded scores by date played. Cancelled and in-progress games are excluded. The selected category shows daily average ratings received from feedback submission dates, on a 1–5 scale. Lines connect recorded days; missing days are not counted as zero."}
          </p>
        )}
        {!historyMode && category && !busy && data && (
          <p className="subtle text-sm">
            {category.name}:{" "}
            <strong className="text-foreground">
              {categoryAverage(data.points, category.id)?.toFixed(2) ?? "—"}
            </strong>{" "}
            / 5
          </p>
        )}
        {!historyMode &&
          !busy &&
          data &&
          !!(individual ? samples.length : points.length) && (
            <details className="min-w-0">
              <summary className="cursor-pointer text-sm font-semibold">
                {individual ? "View individual feedback" : "View daily data"}
              </summary>
              <div className="mt-4 max-h-80 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="p-2">
                        {individual ? "Submitted" : "Date"}
                      </th>
                      {winRate && <th className="p-2">Win rate</th>}
                      {category && <th className="p-2">{category.name}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {individual
                      ? samples.map((sample) => (
                          <tr
                            key={sample.id}
                            className="border-t border-border"
                          >
                            <td className="p-2">
                              {displayFeedbackTime(
                                Date.parse(sample.submittedAt),
                                timeZone,
                              )}
                            </td>
                            <td className="p-2">{sample.rating} / 5</td>
                          </tr>
                        ))
                      : points.map((point) => (
                          <tr
                            key={point.date}
                            className="border-t border-border"
                          >
                            <td className="whitespace-nowrap p-2">
                              {displayDay(dayTimestamp(point.date), true)}
                            </td>
                            {winRate && (
                              <td className="p-2">
                                {point.winRate === null
                                  ? "—"
                                  : `${point.winRate.toFixed(1)}% (${point.wins}W / ${point.losses}L)`}
                              </td>
                            )}
                            {category && (
                              <td className="p-2">
                                {(() => {
                                  const rating = point.ratings.find(
                                    (item) => item.skillId === category.id,
                                  )!;
                                  return `${rating.average.toFixed(2)} / 5 (${rating.count})`;
                                })()}
                              </td>
                            )}
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
      </section>
    </>
  );
}
