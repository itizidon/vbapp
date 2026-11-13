import type { Feedback, Skill, SkillAverage } from "./types";
import { RADAR_AXES, SKILL_ACCENTS } from "./skill-radar";

export function feedbackSkillColor(skill?: Skill) {
  const key = RADAR_AXES.find((axis) =>
    axis.aliases.some((alias) =>
      [skill?.slug, skill?.name].some(
        (value) => value?.toLowerCase() === alias,
      ),
    ),
  )?.key;
  return key ? SKILL_ACCENTS[key] : "#a8c9e4";
}
export function feedbackReport(feedback: Feedback) {
  const ratings = (feedback.ratings ?? []).filter(
    (row) => Number.isFinite(row.rating) && row.rating >= 1 && row.rating <= 5,
  );
  return {
    ratings,
    average: ratings.length
      ? ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length
      : null,
    comment:
      feedback.overallComment?.trim() ||
      feedback.ratings?.find((row) => row.comment?.trim())?.comment?.trim() ||
      null,
  };
}
export function feedbackSummary(ratings: SkillAverage[], skills: Skill[]) {
  const eligible = ratings.filter(
    (row) =>
      row.count > 0 &&
      Number.isFinite(row.average) &&
      row.average >= 1 &&
      row.average <= 5 &&
      skills.some((skill) => skill.id === row.skillId),
  );
  const count = eligible.reduce((sum, row) => sum + row.count, 0);
  const top = [...eligible].sort(
    (a, b) =>
      b.average - a.average ||
      b.count - a.count ||
      a.skillId.localeCompare(b.skillId),
  )[0];
  return {
    average: count
      ? eligible.reduce((sum, row) => sum + row.average * row.count, 0) / count
      : null,
    top: top
      ? { ...top, name: skills.find((skill) => skill.id === top.skillId)!.name }
      : null,
  };
}
