import { Prisma, PrismaClient } from "@prisma/client";
import {
  ANALYSIS_CONFIG as C,
  PROFILE_ALGORITHM_VERSION,
  PROFILE_REBUILD_RETRY_MS,
  PROFILE_QUERY_TIMEOUT_MS,
  PROFILE_TRANSACTION_TIMEOUT_MS,
} from "../feedback-analysis/config";
import {
  combinedTrend,
  compareRatings,
  evidence,
  rankWeaknesses,
  rate,
  themeImprovement,
} from "../feedback-analysis/calculations";
import {
  EvidenceStatus,
  FeedbackAnalysisProfile,
  FeedbackSkillAnalysis,
  FeedbackThemeAnalysis,
  RatingTrend,
  ThemePeriod,
  TechniqueTrend,
} from "../feedback-analysis/models";
import {
  skillQuery,
  summaryQuery,
  themeQuery,
  ThemeRow,
} from "../feedback-analysis/queries";

const iso = (date: Date | null) => date?.toISOString() ?? null;
function period(row: ThemeRow, prefix: "recent" | "previous"): ThemePeriod {
  const relevantFeedbackCount = row[`${prefix}Coverage`];
  return {
    feedbackCount: row[`${prefix}Feedback`],
    relevantFeedbackCount,
    positiveFeedbackCount: row[`${prefix}Positive`],
    negativeFeedbackCount: row[`${prefix}Negative`],
    neutralFeedbackCount: row[`${prefix}Neutral`],
    distinctVerifiedReviewers: row[`${prefix}Verified`],
    distinctNegativeReviewers: row[`${prefix}NegativeVerified`],
    negativeMentionRate: rate(row[`${prefix}Negative`], relevantFeedbackCount),
    positiveMentionRate: rate(row[`${prefix}Positive`], relevantFeedbackCount),
  };
}
export function cachedProfileReady(
  row: {
    stale: boolean;
    revision: number;
    builtRevision: number;
    algorithmVersion: number;
    expiresAt: Date | null;
  },
  now = new Date(),
) {
  return (
    !row.stale &&
    row.revision === row.builtRevision &&
    row.algorithmVersion === PROFILE_ALGORITHM_VERSION &&
    !!row.expiresAt &&
    row.expiresAt > now
  );
}
export async function readOwnAnalysisProfile(
  db: PrismaClient,
  actorId: string,
  sportId: string,
) {
  const row = await db.playerFeedbackAnalysisProfile.findUnique({
    where: { userId_sportId: { userId: actorId, sportId } },
  });
  return !row || !cachedProfileReady(row)
    ? { state: "STALE" as const, data: null }
    : { state: "READY" as const, data: row.data };
}
export async function rebuildOneProfile(
  db: PrismaClient,
  userId: string,
  sportId: string,
  asOf = new Date(),
  force = true,
): Promise<boolean> {
  if (!Number.isFinite(asOf.getTime()))
    throw new Error("Invalid analysis timestamp");
  await db.playerFeedbackAnalysisProfile.upsert({
    where: { userId_sportId: { userId, sportId } },
    create: { userId, sportId },
    update: {},
  });
  const attemptAt = new Date();
  let revision: number | undefined;
  try {
    return await db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { acquired: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(73011422,hashtext(${userId + ":" + sportId})) AS acquired`;
        if (!lock.acquired) return false;
        const row = await tx.playerFeedbackAnalysisProfile.findUniqueOrThrow({
          where: { userId_sportId: { userId, sportId } },
        });
        if (!force && cachedProfileReady(row, asOf)) return false;
        revision = row.revision;
        await tx.$queryRaw`SELECT set_config('statement_timeout',${String(PROFILE_QUERY_TIMEOUT_MS)},true)`;
        const summary = await summaryQuery(tx, userId, sportId, asOf);
        const rawSkills = await skillQuery(tx, userId, sportId, asOf);
        const rawThemes = await themeQuery(tx, userId, sportId, asOf);
        const partial = summary.awaiting > 0 || summary.failed > 0;
        const skills: FeedbackSkillAnalysis[] = rawSkills.map((s) => {
          const lastFiveComparison = compareRatings(
            { count: s.recent5Count, average: s.recent5Average },
            { count: s.previous5Count, average: s.previous5Average },
          );
          const ninetyDayComparison = compareRatings(
            { count: s.recent90Count, average: s.recent90Average },
            { count: s.previous90Count, average: s.previous90Average },
          );
          const trend = combinedTrend(lastFiveComparison, ninetyDayComparison);
          return {
            skillId: s.skillId,
            name: s.name,
            slug: s.slug,
            peer: { count: s.count, average: s.average },
            latestRatingAt: iso(s.latest),
            last30Days: { count: s.recent30Count, average: s.recent30Average },
            last90Days: ninetyDayComparison.recent,
            previous90Days: ninetyDayComparison.previous,
            lastFiveComparison,
            ninetyDayComparison,
            trend,
            explanation: `Last-five trend ${lastFiveComparison.trend}; 90-day trend ${ninetyDayComparison.trend}. Opposing supported comparisons are MIXED.`,
            selfAssessment: s.selfRating,
            internalRating: s.internalRating,
            selfMinusPeer:
              s.selfRating !== null && s.average !== null
                ? s.selfRating - s.average
                : null,
            evidenceStatus:
              s.count >= C.minReviews
                ? EvidenceStatus.SUFFICIENT
                : s.count
                  ? EvidenceStatus.INSUFFICIENT_DATA
                  : EvidenceStatus.NO_DATA,
          };
        });
        const themes: FeedbackThemeAnalysis[] = rawThemes.map((t) => {
          const recent = period(t, "recent"),
            previous = period(t, "previous");
          const related = skills.filter((s) => t.skillIds.includes(s.skillId));
          const supported = related
            .map((s) => s.ninetyDayComparison.trend)
            .filter((trend) => trend !== RatingTrend.INSUFFICIENT_DATA);
          const rating =
            supported.includes(RatingTrend.IMPROVING) &&
            supported.includes(RatingTrend.DECLINING)
              ? RatingTrend.MIXED
              : (supported.find((x) => x !== RatingTrend.STABLE) ??
                supported[0] ??
                RatingTrend.INSUFFICIENT_DATA);
          const classification = themeImprovement({ recent, previous }, rating);
          const improvement = partial
            ? {
                improvement: TechniqueTrend.INSUFFICIENT_DATA,
                explanation:
                  classification.explanation +
                  " Extraction is incomplete; technique classifications are withheld.",
              }
            : classification;
          return {
            themeId: t.themeId,
            name: t.name,
            skillIds: t.skillIds,
            rawObservationCount: t.raw,
            feedbackCount: t.feedback,
            positiveFeedbackCount: t.positive,
            negativeFeedbackCount: t.negative,
            neutralFeedbackCount: t.neutral,
            distinctVerifiedReviewers: t.verified,
            distinctNegativeReviewers: t.negativeVerified,
            guestFeedbackCount: t.guests,
            relevantFeedbackCount: t.coverage,
            verifiedReviewerCoverage: t.verifiedCoverage,
            totalEligibleFeedbackCount: summary.feedback,
            denominatorKind: t.denominatorKind,
            negativeMentionRate: rate(t.negative, t.coverage),
            firstObservedAt: iso(t.first),
            lastObservedAt: iso(t.last),
            lastNegativeAt: iso(t.lastNegative),
            recent,
            previous,
            ...improvement,
            evidenceStatus:
              t.feedback < C.minThemeMentions
                ? EvidenceStatus.INSUFFICIENT_DATA
                : evidence(t.coverage, t.verified, partial),
          };
        });
        const calculatedAt = new Date();
        const expiresAt = new Date(
          Date.UTC(
            asOf.getUTCFullYear(),
            asOf.getUTCMonth(),
            asOf.getUTCDate() + 1,
          ),
        );
        const data: FeedbackAnalysisProfile = {
          playerId: userId,
          sportId,
          algorithmVersion: PROFILE_ALGORITHM_VERSION,
          calculatedAt: calculatedAt.toISOString(),
          asOf: asOf.toISOString(),
          expiresAt: expiresAt.toISOString(),
          latestEligibleFeedbackAt: iso(summary.latest),
          feedback: summary.feedback,
          totalEligibleFeedbackCount: summary.feedback,
          writtenFeedbackCount: summary.written,
          distinctVerifiedReviewers: summary.verified,
          guestFeedbackCount: summary.guests,
          awaiting: summary.awaiting,
          failed: summary.failed,
          moderated: summary.moderated,
          state: partial ? "PARTIAL" : "COMPLETE",
          evidenceStatus: evidence(summary.feedback, summary.verified, partial),
          evidenceExplanation: `Requires ${C.minReviews} distinct eligible feedback IDs for rankings and ${C.minThemeMentions} negative submissions per recurring theme. Verified identity means a registered reviewer or completed assigned-review approval. Guest names cannot establish independent people. Rankings with limited verified diversity are tentative; incomplete extraction suppresses rankings.`,
          skills,
          themes,
          weaknesses: rankWeaknesses(
            themes,
            skills,
            summary.feedback,
            asOf,
            partial,
          ),
        };
        const updated = await tx.playerFeedbackAnalysisProfile.updateMany({
          where: { userId, sportId, revision: row.revision },
          data: {
            data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
            stale: false,
            builtRevision: row.revision,
            algorithmVersion: PROFILE_ALGORITHM_VERSION,
            builtAt: calculatedAt,
            expiresAt,
            rebuildError: null,
            rebuildErrorAt: null,
            rebuildAttemptAt: attemptAt,
            rebuildRetryAt: null,
          },
        });
        return updated.count === 1;
      },
      { timeout: PROFILE_TRANSACTION_TIMEOUT_MS, maxWait: 2000 },
    );
  } catch {
    await db.playerFeedbackAnalysisProfile
      .updateMany({
        where: {
          userId,
          sportId,
          ...(revision !== undefined ? { revision } : {}),
          OR: [
            { rebuildAttemptAt: null },
            { rebuildAttemptAt: { lt: attemptAt } },
          ],
        },
        data: {
          stale: true,
          rebuildError: "PROFILE_REBUILD_FAILED",
          rebuildErrorAt: new Date(),
          rebuildAttemptAt: attemptAt,
          rebuildRetryAt: new Date(Date.now() + PROFILE_REBUILD_RETRY_MS),
        },
      })
      .catch(() => undefined);
    return false;
  }
}
export async function rebuildProfiles(
  db: PrismaClient,
  limit = 100,
  playerId?: string,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Profile batch limit must be 1–1000");
  const now = new Date();
  const rows = await db.playerFeedbackAnalysisProfile.findMany({
    where: {
      ...(playerId ? { userId: playerId } : {}),
      AND: [
        {
          OR: [
            { stale: true },
            { algorithmVersion: { not: PROFILE_ALGORITHM_VERSION } },
            { expiresAt: null },
            { expiresAt: { lte: now } },
          ],
        },
        { OR: [{ rebuildRetryAt: null }, { rebuildRetryAt: { lte: now } }] },
      ],
    },
    take: limit,
    orderBy: [{ invalidatedAt: "asc" }, { userId: "asc" }, { sportId: "asc" }],
  });
  let rebuilt = 0;
  for (const row of rows)
    if (await rebuildOneProfile(db, row.userId, row.sportId, now, false))
      rebuilt++;
  return rebuilt;
}
