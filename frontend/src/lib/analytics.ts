export const ANALYTICS_RANGES = [
  { id: "1W", label: "1W", name: "1 week" },
  { id: "1M", label: "1M", name: "1 month" },
  { id: "3M", label: "3M", name: "3 months" },
  { id: "YTD", label: "YTD", name: "Year to date" },
  { id: "1Y", label: "1Y", name: "1 year" },
  { id: "ALL", label: "ALL", name: "All time" },
] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]["id"];
export interface AnalyticsCategory {
  id: string;
  name: string;
  description?: string | null;
}
export interface AnalyticsPoint {
  date: string;
  winRate: number | null;
  wins: number;
  losses: number;
  ratings: { skillId: string; average: number; count: number }[];
}
export interface AnalyticsData {
  categories: AnalyticsCategory[];
  points: AnalyticsPoint[];
  wins: number;
  losses: number;
  ratingCount: number;
  from: string | null;
  before: string;
  timeZone: string;
}
export const METRIC_COLORS = [
  "#2563eb",
  "#d97706",
  "#9333ea",
  "#db2777",
  "#0891b2",
  "#64748b",
];
export function analyticsBounds(range: AnalyticsRange, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  function monthsAgo(months: number) {
    const day = start.getDate();
    start.setDate(1);
    start.setMonth(start.getMonth() - months);
    const lastDay = new Date(
      start.getFullYear(),
      start.getMonth() + 1,
      0,
    ).getDate();
    start.setDate(Math.min(day, lastDay));
  }
  switch (range) {
    case "1W":
      start.setDate(start.getDate() - 6);
      break;
    case "1M":
      monthsAgo(1);
      break;
    case "3M":
      monthsAgo(3);
      break;
    case "YTD":
      start.setMonth(0, 1);
      break;
    case "1Y":
      monthsAgo(12);
      break;
  }
  return {
    from: range === "ALL" ? null : start.toISOString(),
    before: now.toISOString(),
  };
}
export function calendarDay(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function dayTimestamp(date: string) {
  return Date.parse(`${date}T00:00:00Z`);
}
export function displayDay(timestamp: number, full = false) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(full ? { year: "numeric" } : {}),
  });
}
export function categoryAverage(points: AnalyticsPoint[], skillId: string) {
  let sum = 0,
    count = 0;
  for (const point of points)
    for (const rating of point.ratings)
      if (rating.skillId === skillId) {
        sum += rating.average * rating.count;
        count += rating.count;
      }
  return count ? sum / count : null;
}

export interface IndividualFeedback {
  id: string;
  submittedAt: string;
  rating: number;
}
export function displayFeedbackTime(timestamp: number, timeZone: string) {
  return new Date(timestamp).toLocaleString(undefined, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
