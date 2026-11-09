import { Args, ID, GraphQLISODateTime, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from '../common/gql-auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { AnalyticsDashboard, IndividualCategoryFeedback } from './dashboard.models';
import { DashboardService } from './dashboard.service';
@UseGuards(GqlAuthGuard)
@Resolver()
export class DashboardResolver {
  constructor(private service: DashboardService) {}
  @Query(() => [IndividualCategoryFeedback])
  myCategoryFeedback(
    @CurrentUser() user: AuthUser,
    @Args('skillId', { type: () => ID }) skillId: string,
    @Args('from', { type: () => GraphQLISODateTime, nullable: true }) from?: Date,
    @Args('before', { type: () => GraphQLISODateTime, nullable: true }) before?: Date,
  ) { return this.service.categoryFeedback(user.id, skillId, from, before); }
  @Query(() => AnalyticsDashboard)
  myAnalytics(
    @CurrentUser() user: AuthUser,
    @Args('from', { type: () => GraphQLISODateTime, nullable: true }) from?: Date,
    @Args('before', { type: () => GraphQLISODateTime, nullable: true }) before?: Date,
    @Args('timeZone', { type: () => String, defaultValue: 'UTC' }) timeZone = 'UTC',
  ) { return this.service.dashboard(user.id, from, before, timeZone); }
}
