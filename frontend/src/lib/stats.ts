import type { Feedback } from "./types";
export function summarize(rows: Feedback[]) {
  const ratings = rows.flatMap((f) => f.ratings ?? []);
  return {
    count: rows.length,
    average: ratings.length
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : null,
    distribution: [1, 2, 3, 4, 5].map((value) => ({
      name: String(value),
      count: ratings.filter((r) => r.rating === value).length,
    })),
  };
}
export function filterFeedback(
  rows: Feedback[],
  skillId: string,
  from: string,
  to: string,
  sort: string,
) {
  return rows
    .filter(
      (f) =>
        (!skillId || f.ratings?.some((r) => r.skillId === skillId)) &&
        (!from || f.createdAt.slice(0, 10) >= from) &&
        (!to || f.createdAt.slice(0, 10) <= to),
    )
    .sort((a, b) =>
      sort === "oldest"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
}

// The backend groups months in UTC. Local midnight conversion would move a
// first-of-month bucket into the previous month west of UTC.
export function formatTrendPeriod(value: string, locale?: string) {
  return new Date(value).toLocaleDateString(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}
