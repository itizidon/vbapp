import { Field, ID, Int, ObjectType, InputType } from "@nestjs/graphql";
import { IsOptional, IsUUID, IsString, Length } from "class-validator";
@ObjectType()
export class CoachEvidenceModel {
  @Field() factId!: string;
  @Field() claim!: string;
  @Field(() => Int) supportingReviewCount!: number;
  @Field(() => [ID]) feedbackIds!: string[];
  @Field(() => String, { nullable: true }) metricKey!: string | null;
}
@ObjectType()
export class CoachAnswerModel {
  @Field() message!: string;
  @Field(() => [CoachEvidenceModel]) evidence!: CoachEvidenceModel[];
  @Field(() => [String]) generalSuggestions!: string[];
  @Field(() => [String]) recommendedDrillIds!: string[];
  @Field() insufficientEvidence!: boolean;
  @Field() status!: string;
}
@ObjectType()
export class CoachMessageModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) conversationId!: string;
  @Field() question!: string;
  @Field() startedAt!: string;
  @Field(() => String, { nullable: true }) sourceAsOf!: string | null;
  @Field() status!: string;
  @Field(() => CoachAnswerModel) response!: CoachAnswerModel;
  @Field(() => String, { nullable: true }) model!: string | null;
  @Field() promptVersion!: string;
  @Field(() => Int) inputTokens!: number;
  @Field(() => Int) outputTokens!: number;
}
@ObjectType()
export class CoachConversationModel {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() updatedAt!: string;
}
@ObjectType()
export class CoachMessagePage {
  @Field(() => [CoachMessageModel]) messages!: CoachMessageModel[];
  @Field(() => ID, { nullable: true }) nextCursor!: string | null;
}
@InputType()
export class AskAiCoachInput {
  @Field(() => ID) @IsUUID() sportId!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
  @Field(() => ID) @IsUUID() clientRequestId!: string;
  @Field() @IsString() @Length(1, 2000) question!: string;
}
