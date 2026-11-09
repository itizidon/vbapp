import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';
import { SkillModel } from '../common/models';
@ObjectType()
export class DailyCategoryRating {
  @Field(() => ID) skillId!: string;
  @Field() average!: number;
  @Field(() => Int) count!: number;
}
@ObjectType()
export class DailyAnalyticsPoint {
  @Field() date!: string;
  @Field(() => Number, { nullable: true }) winRate!: number | null;
  @Field(() => Int) wins!: number;
  @Field(() => Int) losses!: number;
  @Field(() => [DailyCategoryRating]) ratings!: DailyCategoryRating[];
}
@ObjectType()
export class AnalyticsDashboard {
  @Field(() => [SkillModel]) categories!: SkillModel[];
  @Field(() => [DailyAnalyticsPoint]) points!: DailyAnalyticsPoint[];
  @Field(() => Int) wins!: number;
  @Field(() => Int) losses!: number;
  @Field(() => Int) ratingCount!: number;
  @Field(() => GraphQLISODateTime, { nullable: true }) from!: Date | null;
  @Field(() => GraphQLISODateTime) before!: Date;
  @Field() timeZone!: string;
}

@ObjectType()
export class IndividualCategoryFeedback {
  @Field(() => ID) id!: string;
  @Field(() => GraphQLISODateTime) submittedAt!: Date;
  @Field(() => Int) rating!: number;
}
