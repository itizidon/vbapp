import {
  ANALYSIS_CONFIG as C,
  DAY_MS,
  WEAKNESS_PRIORITY_WEIGHTS as W,
} from "./config";
import {
  AnalysisAverage,
  EvidenceStatus,
  FeedbackSkillAnalysis,
  FeedbackThemeAnalysis,
  FeedbackWeakness,
  RatingComparison,
  RatingTrend,
  TechniqueTrend,
} from "./models";
export const rate = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : null;
const direction = (delta: number) =>
  delta >= C.meaningfulRatingChange - C.epsilon
    ? 1
    : delta <= -C.meaningfulRatingChange + C.epsilon
      ? -1
      : 0;
export function compareRatings(
  recent: AnalysisAverage,
  previous: AnalysisAverage,
): RatingComparison {
  const delta =
    recent.average !== null && previous.average !== null
      ? recent.average - previous.average
      : null;
  const sufficient =
    recent.count >= C.minPeriodRatings &&
    previous.count >= C.minPeriodRatings &&
    delta !== null;
  const trend = !sufficient
    ? RatingTrend.INSUFFICIENT_DATA
    : direction(delta!) > 0
      ? RatingTrend.IMPROVING
      : direction(delta!) < 0
        ? RatingTrend.DECLINING
        : RatingTrend.STABLE;
  return {
    recent,
    previous,
    delta,
    trend,
    explanation: `Recent n=${recent.count}, average=${recent.average ?? "unavailable"}; previous n=${previous.count}, average=${previous.average ?? "unavailable"}; delta=${delta ?? "unavailable"}. Requires ${C.minPeriodRatings} ratings per period and change of ${C.meaningfulRatingChange}. Descriptive evidence, not statistical proof.`,
  };
}
export function combinedTrend(
  a: RatingComparison,
  b: RatingComparison,
): RatingTrend {
  const usable = [a, b].filter(
    (x) => x.trend !== RatingTrend.INSUFFICIENT_DATA,
  );
  if (!usable.length) return RatingTrend.INSUFFICIENT_DATA;
  if (
    usable.some((x) => x.trend === RatingTrend.IMPROVING) &&
    usable.some((x) => x.trend === RatingTrend.DECLINING)
  )
    return RatingTrend.MIXED;
  return (
    usable.find((x) => x.trend !== RatingTrend.STABLE)?.trend ??
    RatingTrend.STABLE
  );
}
export function themeImprovement(
  theme: Pick<FeedbackThemeAnalysis, "recent" | "previous">,
  rating: RatingTrend,
): { improvement: TechniqueTrend; explanation: string } {
  const { recent: r, previous: p } = theme;
  if (
    r.trustBreakdown &&
    p.trustBreakdown &&
    (![r, p].every(
      (period) =>
        (period.trustBreakdown?.find(
          (g) => g.classification === "VERIFIED_APPROVED",
        )?.feedbackCount ?? 0) >= C.minThemeMentions,
    ) ||
      r.distinctVerifiedReviewers < C.minVerifiedReviewers ||
      p.distinctVerifiedReviewers < C.minVerifiedReviewers)
  )
    return {
      improvement: TechniqueTrend.INSUFFICIENT_DATA,
      explanation:
        "Trust groups lack independent verified support in both periods; changes in guest or pending submissions are not confirmed improvement.",
    };
  const explanation = `Recent positives ${r.positiveFeedbackCount}/${r.relevantFeedbackCount}, negatives ${r.negativeFeedbackCount}/${r.relevantFeedbackCount}; previous positives ${p.positiveFeedbackCount}/${p.relevantFeedbackCount}, negatives ${p.negativeFeedbackCount}/${p.relevantFeedbackCount}; verified reviewers ${r.distinctVerifiedReviewers}/${p.distinctVerifiedReviewers}; numerical trend ${rating}.`;
  if (
    r.relevantFeedbackCount < C.minReviews ||
    p.relevantFeedbackCount < C.minReviews ||
    r.feedbackCount < C.minThemeMentions ||
    p.feedbackCount < C.minThemeMentions
  )
    return {
      improvement: TechniqueTrend.INSUFFICIENT_DATA,
      explanation:
        explanation +
        " Requires five relevant written reviews and three theme-mentioning reviews in each period.",
    };
  const pos = (r.positiveMentionRate ?? 0) - (p.positiveMentionRate ?? 0),
    neg = (r.negativeMentionRate ?? 0) - (p.negativeMentionRate ?? 0);
  return classifyTheme(pos, neg, r, p, rating, explanation);
}
function classifyTheme(
  pos: number,
  neg: number,
  r: FeedbackThemeAnalysis["recent"],
  p: FeedbackThemeAnalysis["previous"],
  rating: RatingTrend,
  explanation: string,
) {
  const threshold = C.meaningfulMentionRateChange - C.epsilon;
  let improvement = TechniqueTrend.STABLE;
  if (
    (pos >= threshold && neg >= threshold) ||
    (pos <= -threshold && neg <= -threshold) ||
    rating === RatingTrend.MIXED
  )
    improvement = TechniqueTrend.MIXED;
  else if (pos >= threshold && neg <= -threshold) {
    improvement =
      rating === RatingTrend.DECLINING
        ? TechniqueTrend.MIXED
        : rating === RatingTrend.IMPROVING &&
            r.distinctVerifiedReviewers >= C.minVerifiedReviewers &&
            p.distinctVerifiedReviewers >= C.minVerifiedReviewers
          ? TechniqueTrend.LIKELY_IMPROVING
          : TechniqueTrend.POSSIBLY_IMPROVING;
  } else if (pos >= threshold && neg < C.epsilon)
    improvement =
      rating === RatingTrend.DECLINING
        ? TechniqueTrend.MIXED
        : TechniqueTrend.POSSIBLY_IMPROVING;
  else if (
    neg >= threshold &&
    (pos <= -threshold || rating === RatingTrend.DECLINING)
  )
    improvement =
      rating === RatingTrend.IMPROVING
        ? TechniqueTrend.MIXED
        : TechniqueTrend.POSSIBLY_DECLINING;
  return {
    improvement,
    explanation:
      explanation +
      " Fewer negative mentions alone never establishes improvement; missing comments are not positive evidence.",
  };
}
export function evidence(
  total: number,
  verified: number,
  partial = false,
): EvidenceStatus {
  return !total
    ? EvidenceStatus.NO_DATA
    : total < C.minReviews
      ? EvidenceStatus.INSUFFICIENT_DATA
      : partial
        ? EvidenceStatus.PARTIAL_ANALYSIS
        : verified < C.minVerifiedReviewers
          ? EvidenceStatus.LIMITED_REVIEWER_DIVERSITY
          : EvidenceStatus.SUFFICIENT;
}
export function rankWeaknesses(
  themes: FeedbackThemeAnalysis[],
  skills: FeedbackSkillAnalysis[],
  total: number,
  asOf: Date,
  partial: boolean,
): FeedbackWeakness[] {
  if (total < C.minReviews || partial) return [];
  return themes
    .filter(
      (t) =>
        t.negativeFeedbackCount >= C.minThemeMentions &&
        t.relevantFeedbackCount >= C.minReviews,
    )
    .map((t) => {
      const related = skills.filter(
        (s) =>
          t.skillIds.includes(s.skillId) &&
          s.peer.count > 0 &&
          s.peer.average !== null,
      );
      const count = related.reduce((n, s) => n + s.peer.count, 0);
      const average = count
        ? related.reduce((n, s) => n + s.peer.count * s.peer.average!, 0) /
          count
        : null;
      const components = {
        lowSkillRating:
          average === null || count < C.minReviews ? null : (5 - average) / 4,
        negativeMentionRate: t.negativeMentionRate,
        reviewerAgreement: t.verifiedReviewerCoverage
          ? t.distinctNegativeReviewers / t.verifiedReviewerCoverage
          : null,
        recency: t.lastNegativeAt
          ? Math.max(
              0,
              1 -
                (asOf.getTime() - Date.parse(t.lastNegativeAt)) /
                  (C.recentDays * DAY_MS),
            )
          : null,
        persistence: t.feedbackCount
          ? t.negativeFeedbackCount / t.feedbackCount
          : null,
      };
      const available = Object.entries(components).filter(
        ([, v]) => v !== null,
      );
      const weight = available.reduce(
        (n, [k]) => n + W[k as keyof typeof W],
        0,
      );
      const status =
        t.distinctNegativeReviewers >= C.minVerifiedReviewers
          ? EvidenceStatus.SUFFICIENT
          : EvidenceStatus.LIMITED_REVIEWER_DIVERSITY;
      const factor =
        status === EvidenceStatus.SUFFICIENT ? 1 : C.limitedDiversityFactor;
      const breakdown = Object.entries(components).map(([name, value]) => ({
        name,
        value: value === null ? null : Math.max(0, Math.min(1, value)),
        effectiveWeight:
          value === null ? 0 : W[name as keyof typeof W] / weight,
      }));
      const score =
        breakdown.reduce((n, c) => n + (c.value ?? 0) * c.effectiveWeight, 0) *
        factor *
        (t.trustEvidenceFactor ?? 1) *
        100;
      return {
        verifiedSupportingFeedbackCount: t.trustBreakdown?.find(
          (g) => g.classification === "VERIFIED_APPROVED",
        )?.negativeFeedbackCount,
        unverifiedSupportingFeedbackCount: t.trustBreakdown
          ?.filter((g) => g.classification !== "VERIFIED_APPROVED")
          .reduce((n, g) => n + g.negativeFeedbackCount, 0),
        trustEvidenceFactor: t.trustEvidenceFactor,
        skillId: t.skillIds.length === 1 ? t.skillIds[0] : null,
        themeId: t.themeId,
        priorityScore: Number(score.toFixed(6)),
        supportingFeedbackCount: t.negativeFeedbackCount,
        negativeMentionRate: t.negativeMentionRate!,
        relevantFeedbackCount: t.relevantFeedbackCount,
        distinctVerifiedReviewers: t.distinctNegativeReviewers,
        relevantRatingCount: count,
        relevantRatingAverage: average,
        evidenceStatus: status,
        evidenceFactor: factor,
        components: breakdown,
        explanation: `Heuristic priority: ${t.negativeFeedbackCount}/${t.relevantFeedbackCount} relevant reviews mention this negatively. ${t.distinctNegativeReviewers} verified negative reviewers. Missing components are reweighted; limited diversity halves the score. Guests are not verified independent people. Trust weights are applied once to the final score, with one evidence unit per stable account and a capped unverified evidence budget; raw counts remain literal submissions.`,
      };
    })
    .sort(
      (a, b) =>
        Number((b.verifiedSupportingFeedbackCount ?? 0) > 0) -
          Number((a.verifiedSupportingFeedbackCount ?? 0) > 0) ||
        b.priorityScore - a.priorityScore ||
        (a.themeId < b.themeId ? -1 : a.themeId > b.themeId ? 1 : 0),
    )
    .slice(0, C.maxWeaknesses);
}
