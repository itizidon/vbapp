import {
  FeedbackAnalysisProfile,
  EvidenceStatus,
} from "../feedback-analysis/models";
import { ANALYSIS_CONFIG } from "../feedback-analysis/config";
import {
  CoachDraft,
  CoachFailure,
  coachDraftSchema,
  safeMessages,
} from "./contracts";
export interface CoachFact {
  limited?: boolean;
  factId: string;
  claim: string;
  supportingReviewCount: number;
  feedbackIds: string[];
  metricKey: string | null;
}
export interface CoachObservation {
  observationId: string;
  feedbackId: string;
  submittedAt: string;
  themeId: string;
  themeName: string;
  skillId: string | null;
  sentiment: string;
  untrustedSourceText: string;
}
export interface CoachAnswer {
  message: string;
  evidence: CoachFact[];
  generalSuggestions: string[];
  recommendedDrillIds: string[];
  insufficientEvidence: boolean;
  status: string;
}
const fmt = (n: number) => n.toFixed(2);
export function profileFacts(
  profile: FeedbackAnalysisProfile,
): Map<string, CoachFact> {
  const facts = new Map<string, CoachFact>();
  const limited = (id: string) =>
    profile.evidenceStatus !== EvidenceStatus.SUFFICIENT ||
    profile.weaknesses.some(
      (w) =>
        id === `weakness.${w.themeId}` &&
        w.evidenceStatus !== EvidenceStatus.SUFFICIENT,
    ) ||
    profile.themes.some(
      (t) =>
        id.startsWith(`theme.${t.themeId}.`) &&
        t.evidenceStatus !== EvidenceStatus.SUFFICIENT,
    );
  const add = (factId: string, claim: string, count: number) =>
    facts.set(factId, {
      factId,
      claim,
      supportingReviewCount: count,
      feedbackIds: [],
      metricKey: factId,
      limited: limited(factId),
    });
  add(
    "profile.total",
    `${profile.totalEligibleFeedbackCount} eligible feedback submissions are available in this profile.`,
    profile.totalEligibleFeedbackCount,
  );
  for (const skill of profile.skills) {
    if (skill.peer.average !== null)
      add(
        `skill.${skill.skillId}.peer`,
        `${skill.name}: average peer rating ${fmt(skill.peer.average)} / 5 across ${skill.peer.count} eligible rated reviews.`,
        skill.peer.count,
      );
    const t = skill.ninetyDayComparison;
    if (t.trend !== "INSUFFICIENT_DATA")
      add(
        `skill.${skill.skillId}.trend90`,
        `${skill.name}: the descriptive 90-day rating trend is ${t.trend.toLowerCase()}; recent average ${fmt(t.recent.average!)} from ${t.recent.count} ratings, preceding average ${fmt(t.previous.average!)} from ${t.previous.count}, change ${fmt(t.delta!)}. This is not statistical proof.`,
        t.recent.count + t.previous.count,
      );
    if (skill.selfAssessment !== null && skill.peer.average !== null)
      add(
        `skill.${skill.skillId}.self`,
        `${skill.name}: current self-assessment ${fmt(skill.selfAssessment)} / 5; peer average ${fmt(skill.peer.average)} / 5 from ${skill.peer.count} ratings; self-minus-peer ${fmt(skill.selfMinusPeer!)}.`,
        skill.peer.count,
      );
    if (skill.internalRating !== null)
      add(
        `skill.${skill.skillId}.internal`,
        `${skill.name}: current internal weighted rating ${fmt(skill.internalRating)} / 5. This is separate from a direct peer average.`,
        0,
      );
  }
  for (const [index, w] of profile.weaknesses.slice(0, 3).entries()) {
    const theme = profile.themes.find((t) => t.themeId === w.themeId);
    add(
      `weakness.${w.themeId}`,
      `Priority ${index + 1}: ${theme?.name ?? w.themeId}. Negative mentions in ${w.supportingFeedbackCount} of ${w.relevantFeedbackCount} relevant written reviews; heuristic score ${fmt(w.priorityScore)} / 100; evidence ${w.evidenceStatus.toLowerCase().replaceAll("_", " ")}.`,
      w.supportingFeedbackCount,
    );
  }
  for (const theme of profile.themes) {
    for (const sentiment of ["positive", "negative"] as const) {
      const count =
        sentiment === "positive"
          ? theme.positiveFeedbackCount
          : theme.negativeFeedbackCount;
      if (count)
        add(
          `theme.${theme.themeId}.${sentiment}`,
          `${theme.name}: ${count} of ${theme.relevantFeedbackCount} relevant written-feedback submissions mention this ${sentiment === "positive" ? "positively" : "negatively"} (context: ${theme.denominatorKind.toLowerCase().replaceAll("_", " ")}). Silence does not establish evaluation of the exact technique.`,
          count,
        );
    }
    if (theme.improvement !== "INSUFFICIENT_DATA")
      add(
        `theme.${theme.themeId}.trend90`,
        `${theme.name}: the 90-day technique assessment is ${theme.improvement.toLowerCase().replaceAll("_", " ")}. Recent negatives ${theme.recent.negativeFeedbackCount}/${theme.recent.relevantFeedbackCount}, positives ${theme.recent.positiveFeedbackCount}/${theme.recent.relevantFeedbackCount}; preceding negatives ${theme.previous.negativeFeedbackCount}/${theme.previous.relevantFeedbackCount}, positives ${theme.previous.positiveFeedbackCount}/${theme.previous.relevantFeedbackCount}. Fewer negatives alone never proves improvement.`,
        theme.recent.feedbackCount + theme.previous.feedbackCount,
      );
  }
  return facts;
}
export function observationFact(o: CoachObservation): CoachFact {
  const source = o.untrustedSourceText
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[contact detail]")
    .replace(/https?:\/\/\S+/gi, "[link]");
  return {
    factId: `observation.${o.observationId}`,
    claim: `Feedback submitted ${o.submittedAt.slice(0, 10)} about ${o.themeName} was ${o.sentiment}: “${source}”`,
    supportingReviewCount: 1,
    feedbackIds: [o.feedbackId],
    metricKey: null,
  };
}
const intros = {
  SUMMARY: "Here is what your eligible feedback supports.",
  FOCUS: "These are feedback-supported areas to consider.",
  PROGRESS: "Here is the recorded evidence about your progress.",
  DETAIL: "Here is the relevant feedback.",
  LIMITED:
    "The available feedback is limited, so treat these observations cautiously.",
  OFF_TOPIC:
    "I can help with beach volleyball feedback and player development.",
};
export function validateDraft(
  value: unknown,
  facts: Map<string, CoachFact>,
): CoachDraft {
  const result = coachDraftSchema.safeParse(value);
  if (!result.success)
    throw new CoachFailure("INVALID_RESPONSE", safeMessages.INVALID_RESPONSE);
  const draft = result.data;
  const seen = new Set<string>();
  for (const e of draft.evidence) {
    const f = facts.get(e.factId);
    if (
      !f ||
      seen.has(e.factId) ||
      e.supportingReviewCount !== f.supportingReviewCount ||
      JSON.stringify([...e.feedbackIds].sort()) !==
        JSON.stringify([...f.feedbackIds].sort())
    )
      throw new CoachFailure("INVALID_RESPONSE", safeMessages.INVALID_RESPONSE);
    seen.add(e.factId);
  }
  for (const s of draft.generalSuggestions) {
    if (
      (s.relatedFactId && !seen.has(s.relatedFactId)) ||
      /[0-9%]|https?:|www\.|\b(you|your|you've|you're|reviewers?|ratings?|feedback|improving|declining|password|secret|api|token)\b/i.test(
        s.text,
      )
    )
      throw new CoachFailure("INVALID_RESPONSE", safeMessages.INVALID_RESPONSE);
  }
  if (
    draft.intro === "OFF_TOPIC" &&
    (draft.evidence.length || draft.generalSuggestions.length)
  )
    throw new CoachFailure("INVALID_RESPONSE", safeMessages.INVALID_RESPONSE);
  return draft;
}
export function renderDraft(
  draft: CoachDraft,
  facts: Map<string, CoachFact>,
  profile: FeedbackAnalysisProfile,
): CoachAnswer {
  const evidence = draft.evidence.map((e) => facts.get(e.factId)!);
  const onlyObservations =
    evidence.length > 0 && evidence.every((e) => e.metricKey === null);
  const unique = new Set(evidence.flatMap((e) => e.feedbackIds)).size;
  const insufficient =
    profile.evidenceStatus !== EvidenceStatus.SUFFICIENT ||
    profile.totalEligibleFeedbackCount < ANALYSIS_CONFIG.minReviews ||
    !evidence.length ||
    evidence.some((e) => e.limited) ||
    evidence.every((e) => e.supportingReviewCount === 0) ||
    (onlyObservations && unique < ANALYSIS_CONFIG.minReviews);
  const caution =
    insufficient && draft.intro !== "OFF_TOPIC"
      ? " There is not enough independent, complete evidence for firm conclusions."
      : "";
  return {
    message: [
      intros[draft.intro] + caution,
      ...evidence.map((e) => e.claim),
    ].join("\n\n"),
    evidence,
    generalSuggestions: draft.generalSuggestions.map((s) => s.text),
    recommendedDrillIds: [],
    insufficientEvidence: insufficient,
    status: "ANSWERED",
  };
}
export function fallbackAnswer(code: string): CoachAnswer {
  return {
    message: safeMessages[code] ?? safeMessages.UNAVAILABLE,
    evidence: [],
    generalSuggestions: [],
    recommendedDrillIds: [],
    insufficientEvidence: true,
    status: code,
  };
}
