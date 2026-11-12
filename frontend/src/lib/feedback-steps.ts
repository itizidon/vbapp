import attackingImage from "../../public/assets/feedback_bg_attacking.png";
import defenseImage from "../../public/assets/feedback_bg_defense.png";
import passingImage from "../../public/assets/feedback_bg_passing.png";
import settingImage from "../../public/assets/feedback_bg_setting.png";
import servingImage from "../../public/assets/feedback_bg_serving.png";
import type { Skill } from "./types";
import { RADAR_AXES } from "./skill-radar";
export interface SkillFeedbackAnswer {
  skillId: string;
  rating: number | null;
  comment: string;
  skipped: boolean;
}
export type FeedbackAnswers = Record<string, SkillFeedbackAnswer>;
export const FEEDBACK_CATEGORIES = [
  {
    key: "attack",
    title: "Attacking",
    image: attackingImage,
    placeholder:
      "How is their shot selection, power, and attacking consistency?",
  },
  {
    key: "defense",
    title: "Defense",
    image: defenseImage,
    placeholder: "How is their court coverage, digging, and reaction time?",
  },
  {
    key: "passing",
    title: "Passing",
    image: passingImage,
    placeholder: "How consistent and accurate is their passing?",
  },
  {
    key: "setting",
    title: "Setting",
    image: settingImage,
    placeholder: "How is their setting accuracy and ball placement?",
  },
  {
    key: "serving",
    title: "Serving",
    image: servingImage,
    placeholder: "How is their serving consistency, placement, and variety?",
  },
] as const;
export function feedbackSteps(skills: Skill[]) {
  return FEEDBACK_CATEGORIES.map((category) => {
    const aliases: readonly string[] = RADAR_AXES.find(
      (axis) => axis.key === category.key,
    )!.aliases;
    const matches = (value?: string) =>
      !!value && aliases.includes(value.trim().toLowerCase());
    const active = skills.filter((skill) => skill.active);
    const skill =
      active.find((skill) => matches(skill.slug)) ??
      active.find((skill) => matches(skill.name)) ??
      null;
    return { ...category, skill };
  });
}
export type FeedbackStep = ReturnType<typeof feedbackSteps>[number];
export function emptyFeedbackAnswer(skillId: string): SkillFeedbackAnswer {
  return { skillId, rating: null, comment: "", skipped: false };
}
export function feedbackRatings(
  steps: FeedbackStep[],
  answers: FeedbackAnswers,
) {
  return steps.flatMap(({ skill }) => {
    if (!skill) return [];
    const answer = answers[skill.id];
    if (!answer || answer.skipped || answer.rating === null) return [];
    return [
      {
        skillId: skill.id,
        rating: answer.rating,
        comment: answer.comment.trim() || undefined,
      },
    ];
  });
}
