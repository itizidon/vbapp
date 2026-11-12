import {
  Args,
  GraphQLISODateTime,
  ID,
  Int,
  Query,
  Resolver,
} from "@nestjs/graphql";
import { UseGuards } from "@nestjs/common";
import { CurrentUser, AuthUser } from "../common/current-user.decorator";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import { InternalRatingsService } from "./internal-ratings.service";
import {
  InternalSkillRatingModel,
  InternalRatingSummaryModel,
  SkillRadarProfileModel,
  RatingHistoryPage,
} from "./internal-ratings.models";
@Resolver()
@UseGuards(GqlAuthGuard)
export class InternalRatingsResolver {
  constructor(private ratings: InternalRatingsService) {}
  @Query(() => [InternalSkillRatingModel])
  internalRatings(
    @CurrentUser() actor: AuthUser,
    @Args("userId", { type: () => ID }) userId: string,
    @Args("sportId", { type: () => ID }) sportId: string,
  ) {
    return this.ratings.current(actor.id, userId, sportId);
  }
  @Query(() => InternalRatingSummaryModel)
  internalRatingSummary(
    @CurrentUser() actor: AuthUser,
    @Args("userId", { type: () => ID }) userId: string,
    @Args("sportId", { type: () => ID }) sportId: string,
  ) {
    return this.ratings.summary(actor.id, userId, sportId);
  }
  @Query(() => SkillRadarProfileModel)
  skillRadarProfile(
    @CurrentUser() actor: AuthUser,
    @Args("userId", { type: () => ID }) userId: string,
    @Args("sportId", { type: () => ID }) sportId: string,
    @Args("asOf", { type: () => GraphQLISODateTime, nullable: true })
    asOf?: Date,
  ) {
    return this.ratings.radarProfile(actor.id, userId, sportId, asOf);
  }
  @Query(() => RatingHistoryPage)
  internalRatingHistory(
    @CurrentUser() actor: AuthUser,
    @Args("userId", { type: () => ID }) userId: string,
    @Args("skillId", { type: () => ID }) skillId: string,
    @Args("from", { type: () => GraphQLISODateTime, nullable: true })
    from?: Date,
    @Args("before", { type: () => GraphQLISODateTime, nullable: true })
    before?: Date,
    @Args("cursor", { nullable: true }) cursor?: string,
    @Args("limit", { type: () => Int, defaultValue: 100 }) limit?: number,
    @Args("revision", { type: () => Int, nullable: true }) revision?: number,
  ) {
    return this.ratings.history(
      actor.id,
      userId,
      skillId,
      "internal",
      from,
      before,
      cursor,
      limit,
      revision,
    );
  }
  @Query(() => RatingHistoryPage)
  selfAssessmentHistory(
    @CurrentUser() actor: AuthUser,
    @Args("userId", { type: () => ID }) userId: string,
    @Args("skillId", { type: () => ID }) skillId: string,
    @Args("from", { type: () => GraphQLISODateTime, nullable: true })
    from?: Date,
    @Args("before", { type: () => GraphQLISODateTime, nullable: true })
    before?: Date,
    @Args("cursor", { nullable: true }) cursor?: string,
    @Args("limit", { type: () => Int, defaultValue: 100 }) limit?: number,
  ) {
    return this.ratings.history(
      actor.id,
      userId,
      skillId,
      "self",
      from,
      before,
      cursor,
      limit,
    );
  }
  @Query(() => RatingHistoryPage)
  internalRatingAudit(
    @CurrentUser() actor: AuthUser,
    @Args("userId", { type: () => ID }) userId: string,
    @Args("skillId", { type: () => ID }) skillId: string,
    @Args("from", { type: () => GraphQLISODateTime, nullable: true })
    from?: Date,
    @Args("before", { type: () => GraphQLISODateTime, nullable: true })
    before?: Date,
    @Args("cursor", { nullable: true }) cursor?: string,
    @Args("limit", { type: () => Int, defaultValue: 100 }) limit?: number,
  ) {
    return this.ratings.history(
      actor.id,
      userId,
      skillId,
      "audit",
      from,
      before,
      cursor,
      limit,
    );
  }
}
