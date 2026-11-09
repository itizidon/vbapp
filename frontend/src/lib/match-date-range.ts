export type MatchDateRange = { from: string; to: string };
export const EMPTY_DATE_RANGE: MatchDateRange = { from: "", to: "" };
export function matchDateVariables(range: MatchDateRange) {
  function localDate(value: string) {
    const date = new Date(`${value}T00:00:00`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(date.getTime()) ||
      date.getFullYear() !== Number(value.slice(0, 4)) ||
      date.getMonth() + 1 !== Number(value.slice(5, 7)) ||
      date.getDate() !== Number(value.slice(8, 10))
    )
      throw new Error("Choose a valid date.");
    return date;
  }
  const from = range.from ? localDate(range.from) : null;
  const to = range.to ? localDate(range.to) : null;
  if (from && to && from > to)
    throw new Error("From date must be on or before To date.");
  if (to) to.setDate(to.getDate() + 1);
  return {
    playedFrom: from?.toISOString() ?? null,
    playedBefore: to?.toISOString() ?? null,
  };
}

export function feedbackDateVariables(range: MatchDateRange) {
  const dates = matchDateVariables(range);
  return { createdFrom: dates.playedFrom, createdBefore: dates.playedBefore };
}
