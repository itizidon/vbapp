import {
  combinedTrend,
  compareRatings,
  evidence,
  rankWeaknesses,
  themeImprovement,
} from "../src/feedback-analysis/calculations";
import { ANALYSIS_CONFIG as C } from "../src/feedback-analysis/config";
import {
  EvidenceStatus as E,
  FeedbackSkillAnalysis,
  FeedbackThemeAnalysis,
  RatingTrend as R,
  TechniqueTrend as T,
  ThemePeriod,
} from "../src/feedback-analysis/models";
const average = (n: number, average: number | null) => ({ count: n, average });
const period = (change: Partial<ThemePeriod> = {}): ThemePeriod => ({
  feedbackCount: 5,
  relevantFeedbackCount: 10,
  positiveFeedbackCount: 1,
  negativeFeedbackCount: 5,
  neutralFeedbackCount: 0,
  distinctVerifiedReviewers: 2,
  distinctNegativeReviewers: 2,
  positiveMentionRate: 0.1,
  negativeMentionRate: 0.5,
  ...change,
});
const asOf = new Date("2026-11-16T12:00:00Z");
const theme = (
  changes: Partial<FeedbackThemeAnalysis> = {},
): FeedbackThemeAnalysis => ({
  themeId: "platform_control",
  name: "Platform control",
  skillIds: ["passing"],
  rawObservationCount: 9,
  feedbackCount: 6,
  positiveFeedbackCount: 1,
  negativeFeedbackCount: 5,
  neutralFeedbackCount: 0,
  distinctVerifiedReviewers: 2,
  distinctNegativeReviewers: 2,
  guestFeedbackCount: 0,
  relevantFeedbackCount: 10,
  verifiedReviewerCoverage: 3,
  totalEligibleFeedbackCount: 10,
  denominatorKind: "SKILL_WRITTEN_REVIEWS",
  negativeMentionRate: 0.5,
  firstObservedAt: "2026-09-01T00:00:00Z",
  lastObservedAt: asOf.toISOString(),
  lastNegativeAt: asOf.toISOString(),
  recent: period(),
  previous: period(),
  improvement: T.STABLE,
  explanation: "",
  evidenceStatus: E.SUFFICIENT,
  ...changes,
});
const skill = {
  skillId: "passing",
  peer: average(10, 2),
} as FeedbackSkillAnalysis;
describe("deterministic feedback analytics calculations", () => {
  it("keeps missing averages and deltas null and refuses small-sample trends", () => {
    expect(compareRatings(average(0, null), average(0, null))).toMatchObject({
      delta: null,
      trend: R.INSUFFICIENT_DATA,
    });
    expect(compareRatings(average(4, 5), average(5, 1)).trend).toBe(
      R.INSUFFICIENT_DATA,
    );
  });
  it("uses conservative thresholds without floating point boundary flips", () => {
    expect(compareRatings(average(5, 3.3), average(5, 3)).trend).toBe(
      R.IMPROVING,
    );
    expect(compareRatings(average(5, 3), average(5, 3.3)).trend).toBe(
      R.DECLINING,
    );
    expect(compareRatings(average(5, 3.29), average(5, 3)).trend).toBe(
      R.STABLE,
    );
    expect(
      combinedTrend(
        compareRatings(average(5, 4), average(5, 3)),
        compareRatings(average(5, 2), average(5, 3)),
      ),
    ).toBe(R.MIXED);
  });
  it("reports evidence limitations separately from numeric counts", () => {
    expect(evidence(0, 0)).toBe(E.NO_DATA);
    expect(evidence(4, 4)).toBe(E.INSUFFICIENT_DATA);
    expect(evidence(10, 0)).toBe(E.LIMITED_REVIEWER_DIVERSITY);
    expect(evidence(10, 2, true)).toBe(E.PARTIAL_ANALYSIS);
    expect(evidence(10, 2)).toBe(E.SUFFICIENT);
  });
  it("does not call fewer negatives improvement without corroborating positive evidence", () => {
    expect(
      themeImprovement(
        {
          recent: period({
            negativeMentionRate: 0.1,
            negativeFeedbackCount: 1,
          }),
          previous: period(),
        },
        R.STABLE,
      ).improvement,
    ).toBe(T.STABLE);
  });
  it("requires supporting positives and numerical trends for likely technique improvement", () => {
    const periods = {
      recent: period({ negativeMentionRate: 0.1, positiveMentionRate: 0.6 }),
      previous: period(),
    };
    expect(themeImprovement(periods, R.IMPROVING).improvement).toBe(
      T.LIKELY_IMPROVING,
    );
    expect(themeImprovement(periods, R.STABLE).improvement).toBe(
      T.POSSIBLY_IMPROVING,
    );
    expect(themeImprovement(periods, R.DECLINING).improvement).toBe(T.MIXED);
    expect(
      themeImprovement(
        {
          ...periods,
          recent: period({ ...periods.recent, distinctVerifiedReviewers: 0 }),
        },
        R.IMPROVING,
      ).improvement,
    ).toBe(T.POSSIBLY_IMPROVING);
  });
  it("reports decline, mixed observations and insufficient technique coverage", () => {
    expect(
      themeImprovement(
        {
          recent: period({ positiveMentionRate: 0, negativeMentionRate: 0.8 }),
          previous: period({ positiveMentionRate: 0.5 }),
        },
        R.DECLINING,
      ).improvement,
    ).toBe(T.POSSIBLY_DECLINING);
    expect(
      themeImprovement(
        {
          recent: period({
            positiveMentionRate: 0.6,
            negativeMentionRate: 0.8,
          }),
          previous: period(),
        },
        R.STABLE,
      ).improvement,
    ).toBe(T.MIXED);
    expect(
      themeImprovement(
        { recent: period({ relevantFeedbackCount: 4 }), previous: period() },
        R.STABLE,
      ).improvement,
    ).toBe(T.INSUFFICIENT_DATA);
  });
  it("suppresses rankings below thresholds or with incomplete extraction", () => {
    expect(rankWeaknesses([theme()], [skill], 4, asOf, false)).toEqual([]);
    expect(rankWeaknesses([theme()], [skill], 10, asOf, true)).toEqual([]);
    expect(
      rankWeaknesses(
        [theme({ negativeFeedbackCount: 2 })],
        [skill],
        10,
        asOf,
        false,
      ),
    ).toEqual([]);
  });
  it("normalizes components, redistributes missing reviewer agreement, and discounts unverified evidence", () => {
    const [result] = rankWeaknesses(
      [
        theme({
          distinctVerifiedReviewers: 0,
          distinctNegativeReviewers: 0,
          verifiedReviewerCoverage: 0,
        }),
      ],
      [],
      10,
      asOf,
      false,
    );
    expect(result.evidenceStatus).toBe(E.LIMITED_REVIEWER_DIVERSITY);
    expect(result.evidenceFactor).toBe(0.5);
    expect(
      result.components.find((c) => c.name === "reviewerAgreement"),
    ).toMatchObject({ value: null, effectiveWeight: 0 });
    expect(
      result.components.find((c) => c.name === "lowSkillRating"),
    ).toMatchObject({ value: null, effectiveWeight: 0 });
    expect(
      result.components.reduce((n, c) => n + c.effectiveWeight, 0),
    ).toBeCloseTo(1);
    expect(result.priorityScore).toBeLessThanOrEqual(50);
  });
  it("scores transparently and does not reward proportional review volume", () => {
    const t = theme();
    const a = rankWeaknesses([t], [skill], 10, asOf, false)[0];
    const b = rankWeaknesses(
      [
        theme({
          ...t,
          feedbackCount: 12,
          negativeFeedbackCount: 10,
          relevantFeedbackCount: 20,
          rawObservationCount: 18,
        }),
      ],
      [skill],
      20,
      asOf,
      false,
    )[0];
    expect(a.priorityScore).toBe(b.priorityScore);
    const expected =
      (0.3 * 0.75 + 0.3 * 0.5 + 0.2 * (2 / 3) + 0.1 + 0.1 * (5 / 6)) * 100;
    expect(a.priorityScore).toBeCloseTo(expected, 5);
  });
  it("uses canonical IDs as stable tie breaks and returns at most five weaknesses", () => {
    const list = Array.from({ length: 8 }, (_, i) =>
      theme({ themeId: "theme_" + i }),
    ).reverse();
    const ranked = rankWeaknesses(list, [skill], 10, asOf, false);
    expect(ranked).toHaveLength(C.maxWeaknesses);
    expect(ranked.map((t) => t.themeId)).toEqual([
      "theme_0",
      "theme_1",
      "theme_2",
      "theme_3",
      "theme_4",
    ]);
  });
});
it("applies trust weighting once and preserves literal counts", () => {
  const baseline = rankWeaknesses([theme()], [], 10, asOf, false)[0];
  const weighted = rankWeaknesses(
    [
      theme({
        trustEvidenceFactor: 0.35,
        trustBreakdown: [
          {
            classification: "UNVERIFIED_GUEST",
            feedbackCount: 6,
            positiveFeedbackCount: 1,
            negativeFeedbackCount: 5,
            neutralFeedbackCount: 0,
          },
        ],
      }),
    ],
    [],
    10,
    asOf,
    false,
  )[0];
  expect(weighted.supportingFeedbackCount).toBe(5);
  expect(weighted.priorityScore).toBeCloseTo(baseline.priorityScore * 0.35, 5);
  expect(weighted.unverifiedSupportingFeedbackCount).toBe(5);
});
it("does not call guest-only changes confirmed improvement", () => {
  const unverified = [
    {
      classification: "UNVERIFIED_GUEST",
      feedbackCount: 10,
      positiveFeedbackCount: 8,
      negativeFeedbackCount: 1,
      neutralFeedbackCount: 0,
    },
  ];
  const result = themeImprovement(
    {
      recent: period({ trustBreakdown: unverified }),
      previous: period({ trustBreakdown: unverified }),
    },
    R.IMPROVING,
  );
  expect(result.improvement).toBe(T.INSUFFICIENT_DATA);
});
