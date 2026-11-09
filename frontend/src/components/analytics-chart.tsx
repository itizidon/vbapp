"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import {
  METRIC_COLORS,
  calendarDay,
  dayTimestamp,
  displayDay,
  type AnalyticsData,
  type AnalyticsCategory,
  type IndividualFeedback,
  displayFeedbackTime,
} from "@/lib/analytics";
export function AnalyticsChart({
  data,
  category,
  individualFeedback,
}: {
  data: AnalyticsData;
  category?: AnalyticsCategory;
  individualFeedback?: IndividualFeedback[];
}) {
  const winRate = !category;
  const name = category?.name ?? "Win rate";
  const index = data.categories.findIndex((item) => item.id === category?.id);
  const individual = individualFeedback !== undefined;
  const points = individualFeedback
    ? individualFeedback.map((point) => ({
        timestamp: Date.parse(point.submittedAt),
        value: point.rating,
      }))
    : data.points.map((point) => ({
        timestamp: dayTimestamp(point.date),
        value: winRate
          ? point.winRate
          : (point.ratings.find((rating) => rating.skillId === category.id)
              ?.average ?? null),
      }));
  const end = individual
    ? Date.parse(data.before)
    : dayTimestamp(calendarDay(new Date(data.before), data.timeZone));
  const start = data.from
    ? individual
      ? Date.parse(data.from)
      : dayTimestamp(calendarDay(new Date(data.from), data.timeZone))
    : (points[0]?.timestamp ?? end - 86400000);
  return (
    <div
      className="h-80 min-w-0 w-full sm:h-96"
      aria-label={
        individual
          ? "Individual feedback line chart"
          : "Daily analytics line chart"
      }
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart
          data={points}
          margin={{ top: 16, right: 8, bottom: 8, left: 0 }}
          accessibilityLayer
        >
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={[
              start,
              Math.max(start + (individual ? 60000 : 86400000), end),
            ]}
            tickFormatter={(value) =>
              individual
                ? new Date(Number(value)).toLocaleDateString(undefined, {
                    timeZone: data.timeZone,
                    month: "short",
                    day: "numeric",
                    ...(end - start > 330 * 86400000
                      ? { year: "numeric" }
                      : {}),
                  })
                : displayDay(Number(value), end - start > 330 * 86400000)
            }
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            minTickGap={35}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={winRate ? [0, 100] : [1, 5]}
            ticks={winRate ? [0, 25, 50, 75, 100] : [1, 2, 3, 4, 5]}
            width={winRate ? 44 : 30}
            tickFormatter={(value) => (winRate ? `${value}%` : String(value))}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(value) =>
              individual
                ? displayFeedbackTime(Number(value), data.timeZone)
                : displayDay(Number(value), true)
            }
            formatter={(value) => [
              typeof value === "number"
                ? `${value.toFixed(winRate ? 1 : 2)}${winRate ? "%" : " / 5"}`
                : "No data",
              name,
            ]}
            contentStyle={{
              background: "var(--card)",
              borderColor: "var(--border)",
              borderRadius: 12,
              color: "var(--foreground)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 14 }} />
          <Line
            name={name}
            type="linear"
            dataKey="value"
            stroke={
              winRate ? "#16a34a" : METRIC_COLORS[index % METRIC_COLORS.length]
            }
            strokeWidth={2.5}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
