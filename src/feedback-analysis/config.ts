export const PROFILE_ALGORITHM_VERSION = 2;
export const PRIMARY_SKILL_SLUGS = [
  "attack",
  "defense",
  "passing",
  "setting",
  "serving",
];
export const ANALYSIS_CONFIG = Object.freeze({
  minReviews: 5,
  minPeriodRatings: 5,
  minThemeMentions: 3,
  minVerifiedReviewers: 2,
  meaningfulRatingChange: 0.3,
  meaningfulMentionRateChange: 0.15,
  recentDays: 90,
  precedingDays: 90,
  recencyDays: 30,
  recentRatingWindow: 5,
  maxWeaknesses: 5,
  limitedDiversityFactor: 0.5,
  epsilon: 1e-9,
});
export const WEAKNESS_PRIORITY_WEIGHTS = Object.freeze({
  lowSkillRating: 0.3,
  negativeMentionRate: 0.3,
  reviewerAgreement: 0.2,
  recency: 0.1,
  persistence: 0.1,
});
export const PROFILE_REBUILD_RETRY_MS = 60_000;
export const PROFILE_QUERY_TIMEOUT_MS = 5_000;
export const PROFILE_TRANSACTION_TIMEOUT_MS = 20_000;
export const DAY_MS = 86_400_000;
