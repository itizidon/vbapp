export function parseTeamScore(value: string): number | null {
  if (!value.trim()) return null;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 0 || score > 2147483647)
    throw new Error("Score must be a whole number from 0 to 2147483647.");
  return score;
}
