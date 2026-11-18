import { privateAnalyticsWhere } from "../feedback/private-eligibility";
import { Args, ID, Query, Resolver } from "@nestjs/graphql";
import { UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser, CurrentUser } from "../common/current-user.decorator";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import {
  AverageSkillRating,
  FeedbackCount,
  MatchModel,
  SelfVsPeerRating,
  SkillRatingPoint,
  SportFeedbackSummary,
} from "../common/models";
@UseGuards(GqlAuthGuard)
@Resolver()
export class AnalyticsResolver {
  constructor(private db: PrismaService) {}
  @Query(() => AverageSkillRating, { nullable: true }) async averageSkillRating(
    @Args("skillId", { type: () => ID }) skillId: string,
  ) {
    const rows = await this.db.$queryRaw<
      { skillId: string; average: number; count: number }[]
    >`
 SELECT r."skillId",avg(r.rating)::float AS average,count(*)::int AS count FROM "FeedbackRating" r JOIN "Feedback" f ON f.id=r."feedbackId"
 LEFT JOIN "FeedbackAnalysisJob" j ON j."feedbackId"=f.id
 WHERE r."skillId"=${skillId}::uuid AND f.status='PUBLISHED' AND f."publicAnalyticsAllowed" AND f."publicConsentAt" IS NOT NULL
 AND f."publicConsentVersion"='feedback-privacy-v1' AND COALESCE(j.moderation,'UNASSESSED') IN ('ALLOW','UNASSESSED')
 AND (NOT f."approvalRequired" OR (f."approvedAt" IS NOT NULL AND f."approvedById"=f."reviewerId"))
 GROUP BY r."skillId" HAVING count(*)>=10 AND count(DISTINCT f."reviewerId")>=5`;
    return rows[0] ?? null;
  }

  @Query(() => [AverageSkillRating]) async userSkillRatings(
    @CurrentUser() u: AuthUser,
    @Args("userId", { type: () => ID }) userId: string,
    @Args("sportId", { type: () => ID, nullable: true }) sportId?: string,
  ) {
    if (u.id !== userId) return [];
    const rows = await this.db.feedbackRating.groupBy({
      by: ["skillId"],
      where: {
        ...(sportId ? { skill: { sportId, active: true } } : {}),
        feedback: {
          ...privateAnalyticsWhere(this.db, userId),
          ...(sportId ? { sportId } : {}),
        },
      },
      _avg: { rating: true },
      _count: true,
    });
    return rows.map((r) => ({
      skillId: r.skillId,
      average: r._avg.rating==null?0:Number(r._avg.rating),
      count: r._count,
    }));
  }
  @Query(() => FeedbackCount) async feedbackCount(
    @CurrentUser() u: AuthUser,
    @Args("userId", { type: () => ID, nullable: true }) userId?: string,
    @Args("sportId", { type: () => ID, nullable: true }) sportId?: string,
  ) {
    const id = userId ?? u.id;
    if (id !== u.id) return { count: 0 };
    return {
      count: await this.db.feedback.count({
        where: {
          recipientId: id,
          status: "PUBLISHED",
          ...(sportId ? { sportId } : {}),
        },
      }),
    };
  }
  @Query(() => [SkillRatingPoint]) async skillRatingTrends(
    @CurrentUser() u: AuthUser,
    @Args("skillId", { type: () => ID }) skillId: string,
  ) {
    const rows = await this.db.$queryRaw<
      { period: Date; average: number; count: bigint }[]
    >`SELECT date_trunc('month',f."createdAt") period,avg(r.rating)::float average,count(*) count FROM "FeedbackRating" r JOIN "PrivateAnalyticsEligibleFeedback" f ON f.id=r."feedbackId" WHERE r."skillId"=${skillId}::uuid AND f."recipientId"=${u.id}::uuid AND f.status='PUBLISHED' GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({ ...r, skillId, count: Number(r.count) }));
  }
  @Query(() => [SelfVsPeerRating]) async selfVsPeerRatings(
    @CurrentUser() u: AuthUser,
    @Args("sportId", { type: () => ID }) sportId: string,
  ) {
    const a = await this.db.selfAssessment.findUnique({
      where: { userId_sportId: { userId: u.id, sportId } },
      include: { ratings: true },
    });
    if (!a) return [];
    const peer = await this.db.feedbackRating.groupBy({
      by: ["skillId"],
      where: { feedback: { ...privateAnalyticsWhere(this.db, u.id), sportId } },
      _avg: { rating: true },
      _count: true,
    });
    const p = new Map(peer.map((x) => [x.skillId, x]));
    return a.ratings.map((r) => ({
      skillId: r.skillId,
      selfRating: r.rating,
      peerAverage: p.get(r.skillId)?._avg.rating==null?null:Number(p.get(r.skillId)!._avg.rating),
      peerCount: p.get(r.skillId)?._count ?? 0,
    }));
  }
  @Query(() => [SportFeedbackSummary]) async userSportFeedbackSummary(
    @CurrentUser() u: AuthUser,
  ) {
    const rows = await this.db.$queryRaw<
      { sportId: string; feedbackCount: bigint; averageRating: number }[]
    >`SELECT f."sportId",count(DISTINCT f.id) "feedbackCount",avg(r.rating)::float "averageRating" FROM "PrivateAnalyticsEligibleFeedback" f JOIN "FeedbackRating" r ON r."feedbackId"=f.id WHERE f."recipientId"=${u.id}::uuid AND f.status='PUBLISHED' GROUP BY f."sportId"`;
    return rows.map((r) => ({ ...r, feedbackCount: Number(r.feedbackCount) }));
  }
  @Query(() => [MatchModel]) userMatchHistory(@CurrentUser() u: AuthUser) {
    return this.db.match.findMany({
      where: { participants: { some: { userId: u.id } } },
      include: { teams: true, participants: true },
      orderBy: { playedAt: "desc" },
    });
  }
  @Query(() => MatchModel, { nullable: true }) matchResults(
    @CurrentUser() u: AuthUser,
    @Args("matchId", { type: () => ID }) id: string,
  ) {
    return this.db.match.findFirst({
      where: {
        id,
        status: "COMPLETED",
        OR: [
          { createdById: u.id },
          { participants: { some: { userId: u.id } } },
        ],
      },
      include: { teams: true, participants: true },
    });
  }
}
