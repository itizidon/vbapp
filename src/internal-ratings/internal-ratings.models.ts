import {
  Field,
  ID,
  Int,
  ObjectType,
  GraphQLISODateTime,
} from "@nestjs/graphql";
@ObjectType()
export class InternalSkillRatingModel {
  @Field(() => ID) skillId!: string;
  @Field() skillName!: string;
  @Field() initialRating!: number;
  @Field() currentRating!: number;
  @Field(() => Int) feedbackCount!: number;
  @Field(() => Int) revision!: number;
  @Field(() => Int) algorithmVersion!: number;
  @Field(() => GraphQLISODateTime) updatedAt!: Date;
}
@ObjectType()
export class RatingHistoryPoint {
  @Field(() => ID) id!: string;
  @Field() sequence!: string;
  @Field(() => GraphQLISODateTime) timestamp!: Date;
  @Field(() => GraphQLISODateTime) recordedAt!: Date;
  @Field({ nullable: true }) previousRating?: number;
  @Field() newRating!: number;
  @Field() delta!: number;
  @Field(() => Int, { nullable: true }) revision?: number;
  @Field() type!: string;
}
@ObjectType()
export class RatingHistoryPage {
  @Field(() => [RatingHistoryPoint]) items!: RatingHistoryPoint[];
  @Field(() => RatingHistoryPoint, { nullable: true })
  baseline?: RatingHistoryPoint;
  @Field() hasMore!: boolean;
  @Field({ nullable: true }) nextCursor?: string;
  @Field(() => Int) revision!: number;
}

@ObjectType()
export class InternalRatingSummaryModel {
  @Field({ nullable: true }) overallRating?: number;
  @Field(() => Int) ratedSkillCount!: number;
  @Field(() => Int) totalSkillCount!: number;
  @Field(() => [InternalSkillRatingModel]) ratings!: InternalSkillRatingModel[];
}

@ObjectType()
export class SkillRadarValueModel {
  @Field(() => ID) skillId!: string;
  @Field() skillName!: string;
  @Field() skillSlug!: string;
  @Field({ nullable: true }) selfRating?: number;
  @Field({ nullable: true }) internalRating?: number;
  @Field({ nullable: true }) averageFeedbackRating?: number;
  @Field(() => Int) feedbackCount!: number;
}
@ObjectType()
export class SkillRadarProfileModel {
  @Field(() => GraphQLISODateTime, { nullable: true }) asOf?: Date;
  @Field(() => [SkillRadarValueModel]) skills!: SkillRadarValueModel[];
}
