export type RadarMode = "internal" | "self" | "average";
export interface SkillRadarData {
  skillId: string;
  skillName: string;
  skillSlug?: string;
  selfRating: number | null;
  internalRating: number | null;
  averageFeedbackRating: number | null;
  feedbackCount?: number;
}
// Axis aliases only: names, IDs and all values still come from backend records.
export const RADAR_AXES = [
  { key: "passing", label: "Passing", aliases: ["passing", "bump"] },
  { key: "setting", label: "Setting", aliases: ["setting", "set"] },
  { key: "attack", label: "Attack", aliases: ["attack", "attacking", "spike"] },
  { key: "serving", label: "Serving", aliases: ["serving", "serve"] },
  { key: "defense", label: "Defense", aliases: ["defense", "defence"] },
] as const;
export const RADAR_MODES = {
  internal: {
    label: "Internal rating",
    field: "internalRating",
    color: "#2563eb",
  },
  self: { label: "Self-assessment", field: "selfRating", color: "#d97706" },
  average: {
    label: "Average feedback",
    field: "averageFeedbackRating",
    color: "#16a34a",
  },
} as const;
export function validRadarRating(value: number | null | undefined) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 5
    ? value
    : null;
}
export function orderRadarSkills(data: SkillRadarData[]) {
  return RADAR_AXES.map((axis) => {
    const matches = (value?: string) =>
      axis.aliases.some((alias) => alias === value?.trim().toLowerCase());
    const source =
      data.find((skill) => matches(skill.skillSlug)) ??
      data.find((skill) => matches(skill.skillName));
    return {
      skillId: source?.skillId ?? null,
      skillName: source?.skillName ?? axis.label,
      axisKey: axis.key,
      selfRating: validRadarRating(source?.selfRating),
      internalRating: validRadarRating(source?.internalRating),
      averageFeedbackRating: validRadarRating(source?.averageFeedbackRating),
    };
  });
}
export function radarSnapshotTime(date: string, now = new Date()) {
  const end = new Date(`${date}T23:59:59.999Z`);
  return Number.isFinite(end.getTime())
    ? new Date(Math.min(end.getTime(), now.getTime())).toISOString()
    : null;
}
