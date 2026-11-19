BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateEnum
CREATE TYPE "TrainingContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrainingTier" AS ENUM ('FOUNDATION', 'CONTROL', 'APPLICATION', 'MASTERY');

-- CreateEnum
CREATE TYPE "DrillDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "DrillSkillRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "TrainingRuleEffect" AS ENUM ('BOOST', 'EXCLUDE');

-- CreateEnum
CREATE TYPE "VideoSubmissionStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'VALIDATION_PENDING', 'READY_FOR_ANALYSIS', 'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED', 'FAILED', 'ANALYSIS_UNAVAILABLE', 'DELETED');

-- CreateEnum
CREATE TYPE "VideoAnalysisStatus" AS ENUM ('PENDING', 'ANALYZING', 'COMPLETED', 'FAILED', 'ANALYSIS_UNAVAILABLE', 'DELETED');

-- CreateEnum
CREATE TYPE "VideoJobType" AS ENUM ('VALIDATE_VIDEO', 'EXTRACT_REFERENCE_POSE', 'EXTRACT_PLAYER_POSE', 'COMPARE_TECHNIQUE', 'GENERATE_COACHING_SUMMARY', 'CLEANUP_MEDIA');

-- CreateEnum
CREATE TYPE "VideoJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNAVAILABLE', 'CANCELLED');

-- CreateTable
CREATE TABLE "SkillTreeNode" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tier" "TrainingTier" NOT NULL DEFAULT 'FOUNDATION',
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "learningObjective" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "technique" JSONB,
    "commonMistakes" JSONB,
    "successCriteria" JSONB,
    "aiDescription" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "TrainingContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillTreeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillPrerequisite" (
    "skillId" UUID NOT NULL,
    "prerequisiteId" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SkillPrerequisite_pkey" PRIMARY KEY ("skillId","prerequisiteId")
);

-- CreateTable
CREATE TABLE "Drill" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "setup" TEXT NOT NULL,
    "difficulty" "DrillDifficulty" NOT NULL DEFAULT 'BEGINNER',
    "durationMinutes" INTEGER NOT NULL DEFAULT 10,
    "minPlayers" INTEGER NOT NULL DEFAULT 1,
    "maxPlayers" INTEGER NOT NULL DEFAULT 2,
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coachingCues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commonMistakes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "safetyNotes" TEXT,
    "successCriteria" JSONB,
    "metricConfig" JSONB,
    "bestForSummary" TEXT,
    "notIdealWhen" TEXT,
    "status" "TrainingContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillStep" (
    "id" UUID NOT NULL,
    "drillId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "DrillStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillSkill" (
    "drillId" UUID NOT NULL,
    "skillTreeNodeId" UUID NOT NULL,
    "role" "DrillSkillRole" NOT NULL,

    CONSTRAINT "DrillSkill_pkey" PRIMARY KEY ("drillId","skillTreeNodeId")
);

-- CreateTable
CREATE TABLE "CoachingSituation" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "TrainingContentStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "CoachingSituation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillRecommendationRule" (
    "id" UUID NOT NULL,
    "drillId" UUID NOT NULL,
    "situationId" UUID,
    "name" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "effect" "TrainingRuleEffect" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrillRecommendationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillTechniqueVariant" (
    "id" UUID NOT NULL,
    "drillId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "TrainingContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrillTechniqueVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillReferenceVideo" (
    "id" UUID NOT NULL,
    "drillId" UUID NOT NULL,
    "techniqueVariantId" UUID,
    "uploadedById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "frameRate" DOUBLE PRECISION,
    "cameraAngle" TEXT NOT NULL,
    "handedness" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "TrainingContentStatus" NOT NULL DEFAULT 'DRAFT',
    "uploadStatus" "VideoSubmissionStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
    "referenceVersion" INTEGER NOT NULL DEFAULT 1,
    "seriesId" UUID NOT NULL,
    "poseArtifactKey" TEXT,
    "poseModelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrillReferenceVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechniqueCheckpoint" (
    "id" UUID NOT NULL,
    "drillId" UUID NOT NULL,
    "techniqueVariantId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "phaseKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "measurementConfig" JSONB,
    "coachingExplanation" TEXT NOT NULL,
    "status" "TrainingContentStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "TechniqueCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrillVideoSubmission" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "drillId" UUID NOT NULL,
    "techniqueVariantId" UUID,
    "referenceVideoId" UUID,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "frameRate" DOUBLE PRECISION,
    "cameraAngle" TEXT NOT NULL,
    "status" "VideoSubmissionStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrillVideoSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnalysis" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "status" "VideoAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "analysisVersion" TEXT NOT NULL,
    "analysisProvider" TEXT,
    "poseModelVersion" TEXT,
    "comparisonAlgorithmVersion" TEXT,
    "checkpointSnapshot" JSONB NOT NULL,
    "result" JSONB,
    "confidence" DOUBLE PRECISION,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnalysisReference" (
    "analysisId" UUID NOT NULL,
    "referenceVideoId" UUID NOT NULL,
    "referenceVersion" INTEGER NOT NULL,
    "storageKeySnapshot" TEXT NOT NULL,
    "selectionReason" TEXT NOT NULL,

    CONSTRAINT "VideoAnalysisReference_pkey" PRIMARY KEY ("analysisId","referenceVideoId")
);

-- CreateTable
CREATE TABLE "VideoProcessingJob" (
    "id" UUID NOT NULL,
    "type" "VideoJobType" NOT NULL,
    "status" "VideoJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "submissionId" UUID,
    "referenceVideoId" UUID,
    "analysisId" UUID,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerTrainingProfile" (
    "userId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerTrainingProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PlayerSkillProgress" (
    "userId" UUID NOT NULL,
    "skillTreeNodeId" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerSkillProgress_pkey" PRIMARY KEY ("userId","skillTreeNodeId")
);

-- CreateTable
CREATE TABLE "DrillCompletion" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "drillId" UUID NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrillCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillTreeNode_slug_key" ON "SkillTreeNode"("slug");

-- CreateIndex
CREATE INDEX "SkillTreeNode_categoryId_status_sortOrder_idx" ON "SkillTreeNode"("categoryId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "SkillPrerequisite_prerequisiteId_idx" ON "SkillPrerequisite"("prerequisiteId");

-- CreateIndex
CREATE UNIQUE INDEX "Drill_slug_key" ON "Drill"("slug");

-- CreateIndex
CREATE INDEX "Drill_status_id_idx" ON "Drill"("status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DrillStep_drillId_sortOrder_key" ON "DrillStep"("drillId", "sortOrder");

-- CreateIndex
CREATE INDEX "DrillSkill_skillTreeNodeId_role_idx" ON "DrillSkill"("skillTreeNodeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "CoachingSituation_slug_key" ON "CoachingSituation"("slug");

-- CreateIndex
CREATE INDEX "DrillRecommendationRule_drillId_enabled_idx" ON "DrillRecommendationRule"("drillId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DrillTechniqueVariant_drillId_slug_key" ON "DrillTechniqueVariant"("drillId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "DrillTechniqueVariant_drillId_id_key" ON "DrillTechniqueVariant"("drillId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DrillReferenceVideo_storageKey_key" ON "DrillReferenceVideo"("storageKey");

-- CreateIndex
CREATE INDEX "DrillReferenceVideo_drillId_status_techniqueVariantId_idx" ON "DrillReferenceVideo"("drillId", "status", "techniqueVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "DrillReferenceVideo_id_referenceVersion_key" ON "DrillReferenceVideo"("id", "referenceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "DrillReferenceVideo_seriesId_referenceVersion_key" ON "DrillReferenceVideo"("seriesId", "referenceVersion");

-- CreateIndex
CREATE INDEX "TechniqueCheckpoint_drillId_sortOrder_id_idx" ON "TechniqueCheckpoint"("drillId", "sortOrder", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DrillVideoSubmission_storageKey_key" ON "DrillVideoSubmission"("storageKey");

-- CreateIndex
CREATE INDEX "DrillVideoSubmission_userId_createdAt_id_idx" ON "DrillVideoSubmission"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DrillVideoSubmission_status_uploadExpiresAt_idx" ON "DrillVideoSubmission"("status", "uploadExpiresAt");

-- CreateIndex
CREATE INDEX "DrillVideoSubmission_retentionExpiresAt_deletedAt_idx" ON "DrillVideoSubmission"("retentionExpiresAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoAnalysis_submissionId_requestId_key" ON "VideoAnalysis"("submissionId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProcessingJob_idempotencyKey_key" ON "VideoProcessingJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_status_runAfter_idx" ON "VideoProcessingJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "DrillCompletion_userId_drillId_completedAt_idx" ON "DrillCompletion"("userId", "drillId", "completedAt");

-- AddForeignKey
ALTER TABLE "SkillTreeNode" ADD CONSTRAINT "SkillTreeNode_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillPrerequisite" ADD CONSTRAINT "SkillPrerequisite_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillTreeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillPrerequisite" ADD CONSTRAINT "SkillPrerequisite_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "SkillTreeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drill" ADD CONSTRAINT "Drill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillStep" ADD CONSTRAINT "DrillStep_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillSkill" ADD CONSTRAINT "DrillSkill_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillSkill" ADD CONSTRAINT "DrillSkill_skillTreeNodeId_fkey" FOREIGN KEY ("skillTreeNodeId") REFERENCES "SkillTreeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSituation" ADD CONSTRAINT "CoachingSituation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillRecommendationRule" ADD CONSTRAINT "DrillRecommendationRule_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillRecommendationRule" ADD CONSTRAINT "DrillRecommendationRule_situationId_fkey" FOREIGN KEY ("situationId") REFERENCES "CoachingSituation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillTechniqueVariant" ADD CONSTRAINT "DrillTechniqueVariant_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillReferenceVideo" ADD CONSTRAINT "DrillReferenceVideo_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillReferenceVideo" ADD CONSTRAINT "DrillReferenceVideo_drillId_techniqueVariantId_fkey" FOREIGN KEY ("drillId", "techniqueVariantId") REFERENCES "DrillTechniqueVariant"("drillId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillReferenceVideo" ADD CONSTRAINT "DrillReferenceVideo_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechniqueCheckpoint" ADD CONSTRAINT "TechniqueCheckpoint_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechniqueCheckpoint" ADD CONSTRAINT "TechniqueCheckpoint_drillId_techniqueVariantId_fkey" FOREIGN KEY ("drillId", "techniqueVariantId") REFERENCES "DrillTechniqueVariant"("drillId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillVideoSubmission" ADD CONSTRAINT "DrillVideoSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillVideoSubmission" ADD CONSTRAINT "DrillVideoSubmission_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillVideoSubmission" ADD CONSTRAINT "DrillVideoSubmission_drillId_techniqueVariantId_fkey" FOREIGN KEY ("drillId", "techniqueVariantId") REFERENCES "DrillTechniqueVariant"("drillId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillVideoSubmission" ADD CONSTRAINT "DrillVideoSubmission_referenceVideoId_fkey" FOREIGN KEY ("referenceVideoId") REFERENCES "DrillReferenceVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysis" ADD CONSTRAINT "VideoAnalysis_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "DrillVideoSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysisReference" ADD CONSTRAINT "VideoAnalysisReference_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "VideoAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysisReference" ADD CONSTRAINT "VideoAnalysisReference_referenceVideoId_referenceVersion_fkey" FOREIGN KEY ("referenceVideoId", "referenceVersion") REFERENCES "DrillReferenceVideo"("id", "referenceVersion") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "DrillVideoSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_referenceVideoId_fkey" FOREIGN KEY ("referenceVideoId") REFERENCES "DrillReferenceVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "VideoAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTrainingProfile" ADD CONSTRAINT "PlayerTrainingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSkillProgress" ADD CONSTRAINT "PlayerSkillProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSkillProgress" ADD CONSTRAINT "PlayerSkillProgress_skillTreeNodeId_fkey" FOREIGN KEY ("skillTreeNodeId") REFERENCES "SkillTreeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillCompletion" ADD CONSTRAINT "DrillCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrillCompletion" ADD CONSTRAINT "DrillCompletion_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "SkillTreeNode" ADD CONSTRAINT training_difficulty CHECK (difficulty BETWEEN 1 AND 10);
ALTER TABLE "Drill" ADD CONSTRAINT training_players CHECK ("minPlayers">=1 AND "maxPlayers">="minPlayers" AND "maxPlayers"<=50 AND "durationMinutes" BETWEEN 1 AND 240);
ALTER TABLE "SkillPrerequisite" ADD CONSTRAINT training_no_self_prerequisite CHECK ("skillId"<>"prerequisiteId");
CREATE UNIQUE INDEX training_one_default_variant ON "DrillTechniqueVariant" ("drillId") WHERE "isDefault" AND status<>'ARCHIVED';
CREATE UNIQUE INDEX training_one_primary_reference ON "DrillReferenceVideo" ("drillId",coalesce("techniqueVariantId","drillId"),"cameraAngle",coalesce(handedness,'UNKNOWN')) WHERE "isPrimary" AND status='PUBLISHED';
CREATE FUNCTION training_prerequisite_dag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(73012200);
 IF EXISTS(WITH RECURSIVE ancestors(id) AS (
 SELECT NEW."prerequisiteId" UNION SELECT p."prerequisiteId" FROM "SkillPrerequisite" p JOIN ancestors a ON p."skillId"=a.id)
 SELECT 1 FROM ancestors WHERE id=NEW."skillId") THEN RAISE EXCEPTION 'Training prerequisite cycle' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER training_dag BEFORE INSERT OR UPDATE ON "SkillPrerequisite" FOR EACH ROW EXECUTE FUNCTION training_prerequisite_dag();
CREATE FUNCTION training_published_drill() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE did uuid; BEGIN
 IF TG_TABLE_NAME='Drill' THEN did:=coalesce(NEW.id,OLD.id); ELSE did:=coalesce(NEW."drillId",OLD."drillId"); END IF;
 IF EXISTS(SELECT 1 FROM "Drill" WHERE id=did AND status='PUBLISHED') AND
 ((SELECT count(*) FROM "DrillSkill" WHERE "drillId"=did AND role='PRIMARY')<>1 OR NOT EXISTS(SELECT 1 FROM "DrillStep" WHERE "drillId"=did AND length(btrim(instruction))>0))
 THEN RAISE EXCEPTION 'Published drill requires instructions and one primary skill' USING ERRCODE='23514'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER training_drill_publication AFTER INSERT OR UPDATE ON "Drill" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION training_published_drill();
CREATE CONSTRAINT TRIGGER training_drill_skills AFTER INSERT OR UPDATE OR DELETE ON "DrillSkill" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION training_published_drill();
CREATE CONSTRAINT TRIGGER training_drill_steps AFTER INSERT OR UPDATE OR DELETE ON "DrillStep" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION training_published_drill();
CREATE FUNCTION training_reference_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (OLD.id,OLD."drillId",OLD."techniqueVariantId",OLD."storageKey",OLD."referenceVersion",OLD."seriesId",OLD."fileSizeBytes",OLD."mimeType",OLD."cameraAngle",OLD.handedness)
 IS DISTINCT FROM (NEW.id,NEW."drillId",NEW."techniqueVariantId",NEW."storageKey",NEW."referenceVersion",NEW."seriesId",NEW."fileSizeBytes",NEW."mimeType",NEW."cameraAngle",NEW.handedness)
 THEN RAISE EXCEPTION 'Create a new immutable reference revision' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER training_reference_revision BEFORE UPDATE ON "DrillReferenceVideo" FOR EACH ROW EXECUTE FUNCTION training_reference_immutable();
CREATE UNIQUE INDEX "VideoAnalysis_submissionId_analysisVersion_key" ON "VideoAnalysis"("submissionId","analysisVersion");

ALTER TABLE "VideoAnalysis" ADD COLUMN "artifactKeys" text[] NOT NULL DEFAULT '{}';
ALTER TABLE "VideoAnalysis" ADD CONSTRAINT training_analysis_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1);
ALTER TABLE "DrillReferenceVideo" ADD CONSTRAINT training_reference_bytes CHECK ("fileSizeBytes">0 AND "referenceVersion">0);
ALTER TABLE "DrillVideoSubmission" ADD CONSTRAINT training_submission_bytes CHECK ("fileSizeBytes">0);
ALTER TABLE "PlayerSkillProgress" ADD CONSTRAINT training_progress_state CHECK (state IN ('NOT_STARTED','PRACTICING','CONFIDENT'));
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT training_job_source CHECK (num_nonnulls("submissionId","referenceVideoId")=1);
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT training_job_retry_bounds CHECK (attempts>=0 AND "maxAttempts" BETWEEN 1 AND 10);
CREATE FUNCTION training_submission_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (OLD."userId",OLD."drillId",OLD."techniqueVariantId",OLD."storageKey",OLD."mimeType",OLD."fileSizeBytes") IS DISTINCT FROM
 (NEW."userId",NEW."drillId",NEW."techniqueVariantId",NEW."storageKey",NEW."mimeType",NEW."fileSizeBytes")
 THEN RAISE EXCEPTION 'Submission identity and object are immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER training_submission_immutable BEFORE UPDATE ON "DrillVideoSubmission" FOR EACH ROW EXECUTE FUNCTION training_submission_identity();
CREATE FUNCTION training_job_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."analysisId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "VideoAnalysis" a WHERE a.id=NEW."analysisId" AND a."submissionId"=NEW."submissionId")
 THEN RAISE EXCEPTION 'Analysis job source mismatch' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER training_job_consistency BEFORE INSERT OR UPDATE ON "VideoProcessingJob" FOR EACH ROW EXECUTE FUNCTION training_job_scope();
COMMIT;
