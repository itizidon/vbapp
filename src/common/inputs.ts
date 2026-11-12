import { Field, ID, InputType, Int, GraphQLISODateTime, PartialType, OmitType } from '@nestjs/graphql';
import { FeedbackStatus, MatchStatus } from '@prisma/client';
import { ArrayMinSize, ArrayMaxSize, ArrayUnique, IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

@InputType() export class RatingInput { @Field(()=>ID) @IsUUID() skillId!:string; @Field(()=>Int) @IsInt() @Min(1) @Max(5) rating!:number; @Field({nullable:true}) @IsOptional() @IsString() @Length(0,5000) comment?:string; }
@InputType() export class AssessmentRatingInput { @Field(()=>ID) @IsUUID() skillId!:string; @Field(()=>Int) @IsInt() @Min(1) @Max(5) rating!:number; }
@InputType() export class RegisterInput { @Field() @Length(3,40) username!:string; @Field() @IsEmail() email!:string; @Field() @MinLength(12) password!:string; @Field(()=>Int) @IsInt() @Min(13) @Max(120) age!:number; @Field(()=>Int) @IsInt() @Min(50) @Max(300) heightCm!:number; @Field(()=>ID) @IsUUID() sportId!:string; @Field() @IsString() overallLevel!:string; @Field(()=>[AssessmentRatingInput]) @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>AssessmentRatingInput) ratings!:AssessmentRatingInput[]; }
@InputType() export class LoginInput { @Field() @IsString() login!:string; @Field() @IsString() password!:string; }
@InputType() export class CreateSelfAssessmentInput { @Field(()=>ID) @IsUUID() sportId!:string; @Field() @IsString() overallLevel!:string; @Field(()=>[AssessmentRatingInput]) @ValidateNested({each:true}) @Type(()=>AssessmentRatingInput) ratings!:AssessmentRatingInput[]; }
@InputType() export class UpdateSelfAssessmentInput { @Field(()=>ID) @IsUUID() id!:string; @Field() @IsString() overallLevel!:string; }
@InputType() export class UpdateSelfAssessmentRatingsInput { @Field(()=>ID) @IsUUID() id!:string; @Field(()=>[AssessmentRatingInput]) @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>AssessmentRatingInput) ratings!:AssessmentRatingInput[]; }
@InputType() export class MatchCreationTeamInput {
 @Field(()=>Int,{nullable:true}) @IsOptional() @IsInt() @Min(0) @Max(2147483647) score?:number;
 @Field({nullable:true}) @IsOptional() @Length(1,100) name?:string;
 @Field(()=>[ID],{nullable:true}) @IsOptional() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined,{each:true}) memberIds?:string[];
 @Field(()=>[String],{nullable:true}) @IsOptional() @ArrayMaxSize(50) @IsString({each:true}) @Length(1,100,{each:true}) guestNames?:string[];
}
@InputType() export class CreateMatchInput { @Field(()=>ID,{nullable:true}) @IsOptional() @IsUUID() sportId?:string; @Field(()=>GraphQLISODateTime,{nullable:true}) @IsOptional() playedAt?:Date; @Field({nullable:true}) @IsOptional() @IsString() description?:string; @Field(()=>MatchStatus,{nullable:true}) @IsOptional() status?:MatchStatus;
 @Field(()=>[ID],{nullable:true}) @IsOptional() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined,{each:true}) memberIds?:string[];
 @Field(()=>[String],{nullable:true}) @IsOptional() @ArrayMaxSize(50) @IsString({each:true}) @Length(1,100,{each:true}) guestNames?:string[];
 @Field(()=>[MatchCreationTeamInput],{nullable:true}) @IsOptional() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>MatchCreationTeamInput) teams?:MatchCreationTeamInput[];
}
@InputType() export class UpdateMatchInput extends PartialType(OmitType(CreateMatchInput,['memberIds','guestNames','teams'] as const)) { @Field(()=>ID) @IsUUID() id!:string; }
@InputType() export class CreateTeamInput { @Field(()=>ID) @IsUUID() matchId!:string; @Field(()=>Int,{nullable:true}) @IsOptional() @Min(1) teamNumber?:number; @Field({nullable:true}) @IsOptional() name?:string; @Field(()=>Int,{nullable:true}) @IsOptional() @Min(0) score?:number; }
@InputType() export class UpdateTeamInput { @Field(()=>ID) @IsUUID() id!:string; @Field({nullable:true}) @IsOptional() name?:string; @Field(()=>Int,{nullable:true}) @IsOptional() @Min(0) score?:number; }
@InputType() export class AddParticipantInput { @Field(()=>ID) @IsUUID() matchId!:string; @Field(()=>ID) @IsUUID() userId!:string; @Field(()=>ID,{nullable:true}) @IsOptional() @IsUUID() teamId?:string; }
@InputType() export class AddGuestParticipantInput { @Field(()=>ID) @IsUUID() matchId!:string; @Field() @Length(1,100) guestName!:string; @Field(()=>ID,{nullable:true}) @IsOptional() @IsUUID() teamId?:string; }
@InputType() export class SubmitFeedbackInput { @Field(()=>ID,{nullable:true}) @IsOptional() @IsUUID() assignedReviewerId?:string; @Field(()=>ID) @IsUUID() recipientId!:string; @Field(()=>ID) @IsUUID() sportId!:string; @Field(()=>ID,{nullable:true}) @IsOptional() @IsUUID() matchId?:string; @Field({nullable:true}) @IsOptional() @IsString() @Length(0,5000) overallComment?:string; @Field({nullable:true}) @IsOptional() analyticsAllowed?:boolean; @Field({nullable:true}) @IsOptional() evidenceAllowed?:boolean; @Field(()=>[RatingInput]) @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>RatingInput) ratings!:RatingInput[]; }
@InputType() export class SubmitGuestFeedbackInput extends SubmitFeedbackInput { @Field() @IsString() @MinLength(1) token!:string; @Field({nullable:true}) @IsOptional() @IsString() @Length(0,100) guestName?:string; }
@InputType() export class UpdateFeedbackInput { @Field(()=>ID) @IsUUID() id!:string; @Field({nullable:true}) @IsOptional() @IsString() @Length(0,5000) overallComment?:string; @Field(()=>FeedbackStatus,{nullable:true}) @IsOptional() status?:FeedbackStatus; @Field({nullable:true}) @IsOptional() analyticsAllowed?:boolean; @Field({nullable:true}) @IsOptional() evidenceAllowed?:boolean; @Field(()=>[RatingInput],{nullable:true}) @IsOptional() @ValidateNested({each:true}) @Type(()=>RatingInput) ratings?:RatingInput[]; }
