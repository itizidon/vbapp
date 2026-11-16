import { Field, ID, InputType, registerEnumType } from "@nestjs/graphql";
import { FeedbackReviewMode } from "@prisma/client";
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsOptional,
  IsString,
  IsBoolean,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { RatingInput } from "../common/inputs";
registerEnumType(FeedbackReviewMode, { name: "FeedbackReviewMode" });
@InputType()
export class MatchReviewInput {
  @Field(() => ID, { nullable: true }) @IsOptional() @IsUUID() matchId?: string;
  @Field(() => [RatingInput])
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RatingInput)
  ratings!: RatingInput[];
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  overallComment?: string;
  @Field({ nullable: true }) @IsOptional() analyticsAllowed?: boolean;
  @Field({ nullable: true }) @IsOptional() evidenceAllowed?: boolean;
}
@InputType()
export class SubmitFeedbackRequestInput {
  @Field({ nullable: true }) @IsOptional() @IsBoolean() asGuest?: boolean;
  @Field() @IsString() @Length(1, 8192) token!: string;
  @Field(() => ID) @IsUUID() submissionId!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  assignedReviewerId?: string;
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  guestName?: string;
  @Field(() => [MatchReviewInput])
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MatchReviewInput)
  reviews!: MatchReviewInput[];
}
