import { Args, Context, ID, Query, Resolver } from "@nestjs/graphql";
import { UseGuards } from "@nestjs/common";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import { AuthUser, CurrentUser } from "../common/current-user.decorator";
import {
  FeedbackAnalysisResult,
  FeedbackSkillAnalysisResult,
  FeedbackThemeAnalysisResult,
  FeedbackWeaknessResult,
} from "./models";
import { FeedbackAnalysisService, ProfileRequestCache } from "./service";
const requestCache = Symbol("feedback-analysis-cache");
type RequestContext = { req: { [requestCache]?: ProfileRequestCache } };
@UseGuards(GqlAuthGuard)
@Resolver()
export class FeedbackAnalysisResolver {
  constructor(private readonly service: FeedbackAnalysisService) {}
  private profile(user: AuthUser, sportId: string, ctx: RequestContext) {
    ctx.req[requestCache] ??= new Map();
    return this.service.get(user.id, sportId, ctx.req[requestCache]);
  }
  @Query(() => FeedbackAnalysisResult)
  myFeedbackAnalysisProfile(
    @CurrentUser() user: AuthUser,
    @Args("sportId", { type: () => ID }) sportId: string,
    @Context() ctx: RequestContext,
  ) {
    return this.profile(user, sportId, ctx);
  }
  @Query(() => FeedbackSkillAnalysisResult)
  async mySkillAnalysis(
    @CurrentUser() user: AuthUser,
    @Args("sportId", { type: () => ID }) sportId: string,
    @Context() ctx: RequestContext,
  ) {
    const row = await this.profile(user, sportId, ctx);
    return { ...row, skills: row.profile?.skills ?? [] };
  }
  @Query(() => FeedbackThemeAnalysisResult)
  async myThemeTrends(
    @CurrentUser() user: AuthUser,
    @Args("sportId", { type: () => ID }) sportId: string,
    @Context() ctx: RequestContext,
  ) {
    const row = await this.profile(user, sportId, ctx);
    return { ...row, themes: row.profile?.themes ?? [] };
  }
  @Query(() => FeedbackWeaknessResult)
  async myTopWeaknesses(
    @CurrentUser() user: AuthUser,
    @Args("sportId", { type: () => ID }) sportId: string,
    @Context() ctx: RequestContext,
  ) {
    const row = await this.profile(user, sportId, ctx);
    return {
      ...row,
      weaknesses: row.profile?.weaknesses ?? [],
      evidenceStatus: row.profile?.evidenceStatus ?? null,
      evidenceExplanation: row.profile?.evidenceExplanation ?? null,
    };
  }
}
