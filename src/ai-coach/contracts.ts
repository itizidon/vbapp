import { z } from "zod";
import { zodResponsesFunction } from "openai/helpers/zod";
export const profileArgs = z.object({}).strict();
export const searchArgs = z
  .object({
    query: z.string().max(1000).nullable(),
    skill: z
      .enum(["attack", "defense", "passing", "setting", "serving"])
      .nullable(),
    theme: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,79}$/)
      .nullable(),
    from: z.string().datetime({ offset: true }).nullable(),
    before: z.string().datetime({ offset: true }).nullable(),
    limit: z.number().int().min(1).max(10).nullable(),
  })
  .strict();
export type SearchArgs = z.infer<typeof searchArgs>;
export const coachDraftSchema = z
  .object({
    intro: z.enum([
      "SUMMARY",
      "FOCUS",
      "PROGRESS",
      "DETAIL",
      "LIMITED",
      "OFF_TOPIC",
    ]),
    evidence: z
      .array(
        z
          .object({
            factId: z.string().min(1).max(180),
            supportingReviewCount: z.number().int().min(0),
            feedbackIds: z.array(z.string().uuid()).max(10),
          })
          .strict(),
      )
      .max(6),
    generalSuggestions: z
      .array(
        z
          .object({
            text: z.string().min(1).max(300),
            relatedFactId: z.string().max(180).nullable(),
          })
          .strict(),
      )
      .max(3),
    recommendedDrillIds: z.array(z.string()).max(0),
    insufficientEvidence: z.boolean(),
  })
  .strict();
export type CoachDraft = z.infer<typeof coachDraftSchema>;
export const COACH_TOOLS = [
  zodResponsesFunction({
    name: "get_player_profile",
    parameters: profileArgs,
    description:
      "Authoritative cached SQL statistics and verified facts for the authenticated player. Prefer this for broad weaknesses, strengths, trends, comparisons and priorities. Counts are authoritative; do not calculate them yourself.",
  }),
  zodResponsesFunction({
    name: "search_feedback",
    parameters: searchArgs,
    description:
      "Find authorized observations for the authenticated player using optional skill/theme/UTC date filters and semantic query. A bounded retrieval sample is NOT a frequency statistic. Null means no filter. Never accepts a player ID.",
  }),
];
export interface CoachUsage {
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  trace: { name: string; status: string; round: number; durationMs: number }[];
  chargeFullBudget: boolean;
}
export class CoachFailure extends Error {
  usage?: CoachUsage;
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
  ) {
    super(code);
  }
}
export const safeMessages: Record<string, string> = {
  CONFIG:
    "The AI coach is not configured yet. Please try again after the server configuration is complete.",
  PROFILE_PENDING:
    "Your analytical profile is being prepared. Please try again shortly.",
  NO_FEEDBACK:
    "There is no eligible feedback to analyze yet. A reviewer can enable private analytics and AI coaching in Feedback privacy; any required approval must also be complete.",
  LIMIT_REACHED:
    "This question reached the coach’s processing limit. Try a shorter, more specific volleyball question.",
  TIMEOUT: "The coach took too long to respond. Please try again.",
  UNAVAILABLE:
    "The AI coach is temporarily unavailable. Please try again later.",
  INVALID_RESPONSE:
    "The coach could not verify an answer against your feedback. Try a more specific question.",
  OUTDATED:
    "Your feedback has changed since this answer was prepared. Ask again for a current analysis.",
  BUSY: "A coaching answer is already being prepared. Please wait before sending another question.",
  RATE_LIMITED:
    "Your coaching usage limit has been reached. Please try again later.",
};

// Persist only the validated user-facing answer, never raw provider/tool transcripts.
export const coachAnswerSchema = z
  .object({
    message: z.string().max(12000),
    evidence: z
      .array(
        z
          .object({
            factId: z.string().max(180),
            claim: z.string().max(2000),
            supportingReviewCount: z.number().int().min(0),
            feedbackIds: z.array(z.string().uuid()).max(10),
            metricKey: z.string().nullable(),
            limited: z.boolean().optional(),
          })
          .strict(),
      )
      .max(6),
    generalSuggestions: z.array(z.string().max(300)).max(3),
    recommendedDrillIds: z.array(z.string()).max(0),
    insufficientEvidence: z.boolean(),
    status: z.literal("ANSWERED"),
  })
  .strict();
