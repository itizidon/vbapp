import {
  ObjectType,
  InputType,
  Field,
  ID,
  Int,
  Float,
  GraphQLISODateTime,
  PartialType,
  registerEnumType,
  Scalar,
  CustomScalar,
} from "@nestjs/graphql";
import {
  IsString,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  Length,
  Matches,
  IsNumber,
  Allow,
  ValidateNested,
  IsIn,
} from "class-validator";
import { Type } from "class-transformer";
import { Kind, ValueNode, valueFromASTUntyped } from "graphql";
import { contentJson } from "./validation";
import {
  TrainingTier,
  TrainingContentStatus,
  DrillDifficulty,
  DrillSkillRole,
  TrainingRuleEffect,
  VideoSubmissionStatus,
  VideoAnalysisStatus,
  VideoJobType,
  VideoJobStatus,
} from "@prisma/client";
registerEnumType(TrainingTier, { name: "TrainingTier" });
registerEnumType(TrainingContentStatus, { name: "TrainingContentStatus" });
registerEnumType(DrillDifficulty, { name: "DrillDifficulty" });
registerEnumType(DrillSkillRole, { name: "DrillSkillRole" });
registerEnumType(TrainingRuleEffect, { name: "TrainingRuleEffect" });
registerEnumType(VideoSubmissionStatus, { name: "VideoSubmissionStatus" });
registerEnumType(VideoAnalysisStatus, { name: "VideoAnalysisStatus" });
registerEnumType(VideoJobType, { name: "VideoJobType" });
registerEnumType(VideoJobStatus, { name: "VideoJobStatus" });
@Scalar("TrainingJSON")
export class TrainingJSON implements CustomScalar<unknown, unknown> {
  description = "Bounded structured training content";
  parseValue(v: unknown) {
    return contentJson(v);
  }
  serialize(v: unknown) {
    const encoded = JSON.stringify(v);
    if (Buffer.byteLength(encoded) > 4 * 1024 * 1024)
      throw new Error(
        "Training response exceeds size limit; request fewer records",
      );
    return JSON.parse(encoded);
  }
  parseLiteral(ast: ValueNode) {
    let count = 0;
    const bound = (node: ValueNode, depth: number) => {
      if (++count > 2000 || depth > 8)
        throw new Error("Structured literal is too complex");
      if (node.kind === Kind.OBJECT)
        node.fields.forEach((f) => bound(f.value, depth + 1));
      if (node.kind === Kind.LIST)
        node.values.forEach((v) => bound(v, depth + 1));
    };
    bound(ast, 0);
    return contentJson(valueFromASTUntyped(ast));
  }
}
@ObjectType()
export class SkillTreeNodeModel {
  @Field(() => ID) id!: string;
  @Field(() => String) slug!: string;
  @Field(() => ID) categoryId!: string;
  @Field(() => String) name!: string;
  @Field(() => String) description!: string;
  @Field(() => TrainingTier) tier!: TrainingTier;
  @Field(() => Int) difficulty!: number;
  @Field(() => String) learningObjective!: string;
  @Field(() => String) whyItMatters!: string;
  @Field(() => TrainingJSON, { nullable: true }) technique?: unknown;
  @Field(() => TrainingJSON, { nullable: true }) commonMistakes?: unknown;
  @Field(() => TrainingJSON, { nullable: true }) successCriteria?: unknown;
  @Field(() => String, { nullable: true }) aiDescription?: string;
  @Field(() => [String]) tags!: string[];
  @Field(() => Int) sortOrder!: number;
  @Field(() => TrainingContentStatus) status!: TrainingContentStatus;
}
@InputType()
export class CreateSkillTreeNodeInput {
  @Field(() => String)
  @IsString()
  @Length(1, 120)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  slug!: string;
  @Field(() => ID) @IsUUID() categoryId!: string;
  @Field(() => String) @IsString() @Length(1, 120) name!: string;
  @Field(() => String) @IsString() @Length(1, 5000) description!: string;
  @Field(() => TrainingTier, { nullable: true })
  @IsOptional()
  @IsEnum(TrainingTier)
  tier?: TrainingTier;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  difficulty?: number;
  @Field(() => String) @IsString() @Length(1, 5000) learningObjective!: string;
  @Field(() => String) @IsString() @Length(1, 5000) whyItMatters!: string;
  @Field(() => TrainingJSON, { nullable: true })
  @IsOptional()
  @Allow()
  technique?: unknown;
  @Field(() => TrainingJSON, { nullable: true })
  @IsOptional()
  @Allow()
  commonMistakes?: unknown;
  @Field(() => TrainingJSON, { nullable: true })
  @IsOptional()
  @Allow()
  successCriteria?: unknown;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  aiDescription?: string;
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  tags?: string[];
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
  @Field(() => TrainingContentStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TrainingContentStatus)
  status?: TrainingContentStatus;
}
@InputType()
export class UpdateSkillTreeNodeInput extends PartialType(
  CreateSkillTreeNodeInput,
) {}
@ObjectType()
export class DrillModel {
  @Field(() => ID) id!: string;
  @Field(() => String) slug!: string;
  @Field(() => String) name!: string;
  @Field(() => String) description!: string;
  @Field(() => String) objective!: string;
  @Field(() => String) setup!: string;
  @Field(() => DrillDifficulty) difficulty!: DrillDifficulty;
  @Field(() => Int) durationMinutes!: number;
  @Field(() => Int) minPlayers!: number;
  @Field(() => Int) maxPlayers!: number;
  @Field(() => [String]) equipment!: string[];
  @Field(() => [String]) coachingCues!: string[];
  @Field(() => [String]) commonMistakes!: string[];
  @Field(() => String, { nullable: true }) safetyNotes?: string;
  @Field(() => TrainingJSON, { nullable: true }) successCriteria?: unknown;
  @Field(() => TrainingJSON, { nullable: true }) metricConfig?: unknown;
  @Field(() => String, { nullable: true }) bestForSummary?: string;
  @Field(() => String, { nullable: true }) notIdealWhen?: string;
  @Field(() => TrainingContentStatus) status!: TrainingContentStatus;
}
@InputType()
export class CreateDrillInput {
  @Field(() => String)
  @IsString()
  @Length(1, 120)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  slug!: string;
  @Field(() => String) @IsString() @Length(1, 120) name!: string;
  @Field(() => String) @IsString() @Length(1, 5000) description!: string;
  @Field(() => String) @IsString() @Length(1, 5000) objective!: string;
  @Field(() => String) @IsString() @Length(1, 5000) setup!: string;
  @Field(() => DrillDifficulty, { nullable: true })
  @IsOptional()
  @IsEnum(DrillDifficulty)
  difficulty?: DrillDifficulty;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  durationMinutes?: number;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  minPlayers?: number;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxPlayers?: number;
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  equipment?: string[];
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  coachingCues?: string[];
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  commonMistakes?: string[];
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  safetyNotes?: string;
  @Field(() => TrainingJSON, { nullable: true })
  @IsOptional()
  @Allow()
  successCriteria?: unknown;
  @Field(() => TrainingJSON, { nullable: true })
  @IsOptional()
  @Allow()
  metricConfig?: unknown;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  bestForSummary?: string;
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  notIdealWhen?: string;
  @Field(() => TrainingContentStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TrainingContentStatus)
  status?: TrainingContentStatus;
}
@InputType()
export class UpdateDrillInput extends PartialType(CreateDrillInput) {}
@ObjectType()
export class CoachingSituationModel {
  @Field(() => ID) id!: string;
  @Field(() => String) slug!: string;
  @Field(() => String) name!: string;
  @Field(() => String) description!: string;
  @Field(() => ID, { nullable: true }) categoryId?: string;
  @Field(() => [String]) tags!: string[];
  @Field(() => TrainingContentStatus) status!: TrainingContentStatus;
}
@InputType()
export class CreateCoachingSituationInput {
  @Field(() => String)
  @IsString()
  @Length(1, 120)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  slug!: string;
  @Field(() => String) @IsString() @Length(1, 120) name!: string;
  @Field(() => String) @IsString() @Length(1, 5000) description!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  tags?: string[];
  @Field(() => TrainingContentStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TrainingContentStatus)
  status?: TrainingContentStatus;
}
@InputType()
export class UpdateCoachingSituationInput extends PartialType(
  CreateCoachingSituationInput,
) {}
@ObjectType()
export class DrillTechniqueVariantModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) drillId!: string;
  @Field(() => String) slug!: string;
  @Field(() => String) name!: string;
  @Field(() => String) description!: string;
  @Field(() => Boolean) isDefault!: boolean;
  @Field(() => TrainingContentStatus) status!: TrainingContentStatus;
}
@InputType()
export class CreateDrillTechniqueVariantInput {
  @Field(() => ID) @IsUUID() drillId!: string;
  @Field(() => String)
  @IsString()
  @Length(1, 120)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  slug!: string;
  @Field(() => String) @IsString() @Length(1, 120) name!: string;
  @Field(() => String) @IsString() @Length(1, 5000) description!: string;
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
  @Field(() => TrainingContentStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TrainingContentStatus)
  status?: TrainingContentStatus;
}
@InputType()
export class UpdateDrillTechniqueVariantInput extends PartialType(
  CreateDrillTechniqueVariantInput,
) {}
@ObjectType()
export class TechniqueCheckpointModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) drillId!: string;
  @Field(() => ID, { nullable: true }) techniqueVariantId?: string;
  @Field(() => String) name!: string;
  @Field(() => String) description!: string;
  @Field(() => String) phaseKey!: string;
  @Field(() => Int) sortOrder!: number;
  @Field(() => Float) importance!: number;
  @Field(() => TrainingJSON, { nullable: true }) measurementConfig?: unknown;
  @Field(() => String) coachingExplanation!: string;
  @Field(() => TrainingContentStatus) status!: TrainingContentStatus;
}
@InputType()
export class CreateTechniqueCheckpointInput {
  @Field(() => ID) @IsUUID() drillId!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  techniqueVariantId?: string;
  @Field(() => String) @IsString() @Length(1, 120) name!: string;
  @Field(() => String) @IsString() @Length(1, 5000) description!: string;
  @Field(() => String) @IsString() @Length(1, 120) phaseKey!: string;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1073741824)
  importance?: number;
  @Field(() => TrainingJSON, { nullable: true })
  @IsOptional()
  @Allow()
  measurementConfig?: unknown;
  @Field(() => String)
  @IsString()
  @Length(1, 5000)
  coachingExplanation!: string;
  @Field(() => TrainingContentStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TrainingContentStatus)
  status?: TrainingContentStatus;
}
@InputType()
export class UpdateTechniqueCheckpointInput extends PartialType(
  CreateTechniqueCheckpointInput,
) {}
@ObjectType()
export class DrillRecommendationRuleModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) drillId!: string;
  @Field(() => ID, { nullable: true }) situationId?: string;
  @Field(() => String) name!: string;
  @Field(() => String) rationale!: string;
  @Field(() => TrainingJSON) conditions!: unknown;
  @Field(() => TrainingRuleEffect) effect!: TrainingRuleEffect;
  @Field(() => Int) priority!: number;
  @Field(() => Boolean) enabled!: boolean;
  @Field(() => Int) version!: number;
}
@InputType()
export class CreateDrillRecommendationRuleInput {
  @Field(() => ID) @IsUUID() drillId!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  situationId?: string;
  @Field(() => String) @IsString() @Length(1, 120) name!: string;
  @Field(() => String) @IsString() @Length(1, 5000) rationale!: string;
  @Field(() => TrainingJSON) @Allow() conditions!: unknown;
  @Field(() => TrainingRuleEffect)
  @IsEnum(TrainingRuleEffect)
  effect!: TrainingRuleEffect;
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  priority?: number;
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
@InputType()
export class UpdateDrillRecommendationRuleInput extends PartialType(
  CreateDrillRecommendationRuleInput,
) {}
@ObjectType()
export class DrillStepModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) drillId!: string;
  @Field(() => Int) sortOrder!: number;
  @Field(() => String) instruction!: string;
  @Field(() => TrainingJSON, { nullable: true }) metadata?: unknown;
}
@ObjectType()
export class DrillSkillModel {
  @Field(() => ID) drillId!: string;
  @Field(() => ID) skillTreeNodeId!: string;
  @Field(() => DrillSkillRole) role!: DrillSkillRole;
}
@ObjectType()
export class SkillPrerequisiteModel {
  @Field(() => ID) skillId!: string;
  @Field(() => ID) prerequisiteId!: string;
  @Field(() => Boolean) required!: boolean;
}
@ObjectType()
export class DrillReferenceVideoModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) drillId!: string;
  @Field(() => ID, { nullable: true }) techniqueVariantId?: string;
  @Field(() => String) title!: string;
  @Field(() => String, { nullable: true }) description?: string;
  @Field(() => String) mimeType!: string;
  @Field(() => Float) fileSizeBytes!: number;
  @Field(() => Int, { nullable: true }) durationMs?: number;
  @Field(() => Int, { nullable: true }) width?: number;
  @Field(() => Int, { nullable: true }) height?: number;
  @Field(() => Float, { nullable: true }) frameRate?: number;
  @Field(() => String) cameraAngle!: string;
  @Field(() => String, { nullable: true }) handedness?: string;
  @Field(() => Boolean) isPrimary!: boolean;
  @Field(() => TrainingContentStatus) status!: TrainingContentStatus;
  @Field(() => VideoSubmissionStatus) uploadStatus!: VideoSubmissionStatus;
  @Field(() => Int) referenceVersion!: number;
}
@ObjectType()
export class DrillVideoSubmissionModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) userId!: string;
  @Field(() => ID) drillId!: string;
  @Field(() => ID, { nullable: true }) techniqueVariantId?: string;
  @Field(() => ID, { nullable: true }) referenceVideoId?: string;
  @Field(() => String) mimeType!: string;
  @Field(() => Float) fileSizeBytes!: number;
  @Field(() => Int, { nullable: true }) durationMs?: number;
  @Field(() => String) cameraAngle!: string;
  @Field(() => VideoSubmissionStatus) status!: VideoSubmissionStatus;
  @Field(() => GraphQLISODateTime) createdAt!: Date;
  @Field(() => GraphQLISODateTime, { nullable: true }) uploadedAt?: Date;
  @Field(() => GraphQLISODateTime, { nullable: true }) deletedAt?: Date;
}
@ObjectType()
export class VideoAnalysisReferenceModel {
  @Field(() => ID) analysisId!: string;
  @Field(() => ID) referenceVideoId!: string;
  @Field(() => Int) referenceVersion!: number;
  @Field(() => String) selectionReason!: string;
}
@ObjectType()
export class VideoAnalysisModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) submissionId!: string;
  @Field(() => VideoAnalysisStatus) status!: VideoAnalysisStatus;
  @Field(() => String) analysisVersion!: string;
  @Field(() => String, { nullable: true }) analysisProvider?: string;
  @Field(() => String, { nullable: true }) poseModelVersion?: string;
  @Field(() => String, { nullable: true }) comparisonAlgorithmVersion?: string;
  @Field(() => TrainingJSON, { nullable: true }) result?: unknown;
  @Field(() => Float, { nullable: true }) confidence?: number;
  @Field(() => String, { nullable: true }) errorCode?: string;
  @Field(() => GraphQLISODateTime, { nullable: true }) startedAt?: Date;
  @Field(() => GraphQLISODateTime, { nullable: true }) completedAt?: Date;
}
@ObjectType()
export class VideoProcessingJobModel {
  @Field(() => ID) id!: string;
  @Field(() => VideoJobType) type!: VideoJobType;
  @Field(() => VideoJobStatus) status!: VideoJobStatus;
  @Field(() => Int) attempts!: number;
  @Field(() => String, { nullable: true }) errorCode?: string;
}

@InputType()
export class TrainingStepInput {
  @Field() @IsString() @Length(1, 2000) instruction!: string;
  @Field(() => TrainingJSON, { nullable: true })
  @IsOptional()
  @Allow()
  metadata?: unknown;
}
@InputType()
export class TrainingSkillLinkInput {
  @Field(() => ID) @IsUUID() skillTreeNodeId!: string;
  @Field(() => DrillSkillRole) @IsEnum(DrillSkillRole) role!: DrillSkillRole;
}
@InputType()
export class PrerequisiteInput {
  @Field(() => ID) @IsUUID() prerequisiteId!: string;
  @Field() @IsBoolean() required!: boolean;
}
@ObjectType()
export class TrainingGraph {
  @Field(() => [SkillTreeNodeModel]) nodes!: SkillTreeNodeModel[];
  @Field(() => [SkillPrerequisiteModel]) edges!: SkillPrerequisiteModel[];
}
@ObjectType()
export class TrainingUpload {
  @Field(() => ID) id!: string;
  @Field() url!: string;
  @Field(() => GraphQLISODateTime) expiresAt!: Date;
  @Field(() => TrainingJSON) headers!: unknown;
}
@ObjectType()
export class TrainingPlayback {
  @Field() url!: string;
  @Field(() => GraphQLISODateTime) expiresAt!: Date;
}
@ObjectType()
export class TrainingRecommendation {
  @Field(() => DrillModel) drill!: DrillModel;
  @Field(() => Float) score!: number;
  @Field() excluded!: boolean;
  @Field(() => TrainingJSON) evaluation!: unknown;
}
@InputType()
export class TrainingVideoUploadInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsIn(["LEFT", "RIGHT", "BOTH"])
  handedness?: string;
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  allowMirroring?: boolean;
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  aiExplanationAllowed?: boolean;
  @Field(() => ID) @IsUUID() drillId!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  techniqueVariantId?: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  referenceVideoId?: string;
  @Field()
  @IsIn(["video/mp4", "video/webm", "video/quicktime"])
  mimeType!: string;
  @Field(() => Float) @IsInt() @Min(1) @Max(1073741824) fileSizeBytes!: number;
  @Field()
  @IsIn(["FRONT", "SIDE", "REAR", "OBLIQUE", "UNKNOWN"])
  cameraAngle!: string;
}
@InputType()
export class ReferenceVideoUploadInput extends TrainingVideoUploadInput {
  @Field() @IsString() @Length(1, 120) title!: string;
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;
  @Field() @IsString() @Length(1, 200) originalFilename!: string;
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  replacesReferenceId?: string;
}
@InputType()
export class UpdateReferenceVideoInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;
  @Field({ nullable: true }) @IsOptional() @IsBoolean() isPrimary?: boolean;
  @Field(() => TrainingContentStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TrainingContentStatus)
  status?: TrainingContentStatus;
}

@InputType()
export class CreateDrillWithContentInput {
  @Field(() => CreateDrillInput)
  @ValidateNested()
  @Type(() => CreateDrillInput)
  drill!: CreateDrillInput;
  @Field(() => [TrainingStepInput])
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TrainingStepInput)
  steps!: TrainingStepInput[];
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  primarySkillId?: string;
  @Field(() => CreateSkillTreeNodeInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSkillTreeNodeInput)
  newPrimarySkill?: CreateSkillTreeNodeInput;
}
