-- DESTRUCTIVE FRESH START. Run only through the backup-gated clerk:cutover procedure.

BEGIN;

SET LOCAL lock_timeout='10s';

SET LOCAL TIME ZONE 'UTC';
DO $$ DECLARE permit record; item record; actual text; BEGIN
 IF to_regclass('public."_ClerkCutoverPermit"') IS NULL THEN RAISE EXCEPTION 'Clerk cutover requires clerk:cutover and a verified backup'; END IF;
 SELECT * INTO permit FROM "_ClerkCutoverPermit" WHERE id='clerk-fresh-start' AND database=current_database() AND "expiresAt">now();
 IF NOT FOUND OR permit."backupSha256" !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Clerk cutover backup authorization is missing or expired'; END IF;
 FOR item IN SELECT key,value FROM jsonb_each(permit.snapshot) LOOP
   EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE',item.key);
   EXECUTE format($check$SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) FROM %I t$check$,item.key) INTO actual;
   IF actual IS DISTINCT FROM item.value->>'hash' THEN RAISE EXCEPTION 'Database changed after backup: %',item.key; END IF;
 END LOOP;
END $$;

CREATE TEMP TABLE clerk_content_fingerprints(name text PRIMARY KEY, fingerprint text) ON COMMIT DROP;

INSERT INTO clerk_content_fingerprints SELECT 'Sport',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "Sport" t;

INSERT INTO clerk_content_fingerprints SELECT 'Skill',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "Skill" t;

INSERT INTO clerk_content_fingerprints SELECT 'FeedbackTheme',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "FeedbackTheme" t;

INSERT INTO clerk_content_fingerprints SELECT 'SkillTreeNode',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "SkillTreeNode" t;

INSERT INTO clerk_content_fingerprints SELECT 'SkillPrerequisite',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "SkillPrerequisite" t;

INSERT INTO clerk_content_fingerprints SELECT 'Drill',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "Drill" t;

INSERT INTO clerk_content_fingerprints SELECT 'DrillStep',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "DrillStep" t;

INSERT INTO clerk_content_fingerprints SELECT 'DrillSkill',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "DrillSkill" t;

INSERT INTO clerk_content_fingerprints SELECT 'CoachingSituation',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "CoachingSituation" t;

INSERT INTO clerk_content_fingerprints SELECT 'DrillRecommendationRule',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "DrillRecommendationRule" t;

INSERT INTO clerk_content_fingerprints SELECT 'DrillTechniqueVariant',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "DrillTechniqueVariant" t;

INSERT INTO clerk_content_fingerprints SELECT 'DrillReferenceVideo',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "DrillReferenceVideo" t;

INSERT INTO clerk_content_fingerprints SELECT 'TechniqueCheckpoint',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "TechniqueCheckpoint" t;

INSERT INTO clerk_content_fingerprints SELECT 'VideoWorkerHeartbeat',md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) FROM "VideoWorkerHeartbeat" t;

CREATE TEMP TABLE clerk_reference_poses ON COMMIT DROP AS SELECT * FROM "VideoPoseArtifact" WHERE "referenceVideoId" IS NOT NULL AND "submissionId" IS NULL;

CREATE TEMP TABLE clerk_reference_jobs ON COMMIT DROP AS SELECT * FROM "VideoProcessingJob" WHERE "referenceVideoId" IS NOT NULL AND "submissionId" IS NULL AND "analysisId" IS NULL;

CREATE TEMP TABLE clerk_private_objects ON COMMIT DROP AS
 SELECT "storageKey" AS key FROM "DrillVideoSubmission"
 UNION SELECT "storageKey" FROM "VideoPoseArtifact" WHERE "submissionId" IS NOT NULL
 UNION SELECT unnest("artifactKeys") FROM "VideoAnalysis";

-- Explicitly enumerated player-owned/mixed tables only; no User CASCADE reset.

TRUNCATE "Match", "MatchTeam", "MatchParticipant", "Feedback", "FeedbackRating", "SelfAssessment", "SelfAssessmentRating", "FeedbackReviewerSkillSnapshot", "PlayerInternalRating", "PlayerInternalRatingEvent", "SelfAssessmentRatingEvent", "InternalRatingContribution", "FeedbackLink", "FeedbackRequestMatch", "FeedbackMatch", "FeedbackSubmission", "FeedbackAnalysisJob", "FeedbackExtractionRun", "FeedbackObservation", "FeedbackEmbeddingJob", "FeedbackObservationEmbedding", "PlayerFeedbackAnalysisProfile", "AiCoachConversation", "AiCoachTurn", "AiCoachUsage", "FeedbackPrivacyEvent", "DrillVideoSubmission", "VideoAnalysis", "VideoAnalysisReference", "PlayerTrainingProfile", "PlayerSkillProgress", "DrillCompletion", "LegacyPlayerSkillRating", "LegacyPlayerSportRating", "VideoProcessingJob", "VideoPoseArtifact" RESTART IDENTITY CASCADE;

DROP VIEW IF EXISTS "EligibleFeedbackObservation" CASCADE;

DROP VIEW IF EXISTS "PrivateAnalyticsEligibleFeedback" CASCADE;

DROP VIEW IF EXISTS "AnalysisEligibleFeedback" CASCADE;

DROP FUNCTION IF EXISTS touch_assessment() CASCADE;

DROP FUNCTION IF EXISTS validate_skill_sport() CASCADE;

DROP FUNCTION IF EXISTS recipient_coaching_preference_changed() CASCADE;

DROP FUNCTION IF EXISTS feedback_profile_assessment_deleted() CASCADE;

DROP FUNCTION IF EXISTS record_self_rating_change() CASCADE;

DROP FUNCTION IF EXISTS feedback_profile_self_changed() CASCADE;

DROP FUNCTION IF EXISTS invalidate_feedback_profile(uuid,uuid) CASCADE;

-- Trigger WHEN/UPDATE OF dependencies must be removed before UUID-to-text conversion.
DROP TRIGGER IF EXISTS "training_drill_publication" ON "Drill";
DROP TRIGGER IF EXISTS "training_reference_revision" ON "DrillReferenceVideo";
DROP TRIGGER IF EXISTS "training_drill_skills" ON "DrillSkill";
DROP TRIGGER IF EXISTS "training_drill_steps" ON "DrillStep";
DROP TRIGGER IF EXISTS "training_submission_immutable" ON "DrillVideoSubmission";
DROP TRIGGER IF EXISTS "Feedback_consistent_matches" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_ai_submission_update" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_analysis_delete" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_analysis_insert" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_analysis_update" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_pending_ai_answers" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_privacy_answers" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_private_permission_update" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_profile_timestamp" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_snapshot_no_update" ON "Feedback";
DROP TRIGGER IF EXISTS "feedback_profile_job" ON "FeedbackAnalysisJob";
DROP TRIGGER IF EXISTS "FeedbackMatch_consistent" ON "FeedbackMatch";
DROP TRIGGER IF EXISTS "feedback_profile_observation" ON "FeedbackObservation";
DROP TRIGGER IF EXISTS "FeedbackRating_protect_reviewer_weight_snapshot" ON "FeedbackRating";
DROP TRIGGER IF EXISTS "feedback_rating_analysis" ON "FeedbackRating";
DROP TRIGGER IF EXISTS "feedback_rating_sport" ON "FeedbackRating";
DROP TRIGGER IF EXISTS "snapshot_no_delete" ON "FeedbackReviewerSkillSnapshot";
DROP TRIGGER IF EXISTS "snapshot_no_update" ON "FeedbackReviewerSkillSnapshot";
DROP TRIGGER IF EXISTS "snapshot_rating_sport" ON "FeedbackReviewerSkillSnapshot";
DROP TRIGGER IF EXISTS "feedback_profile_theme_catalog" ON "FeedbackTheme";
DROP TRIGGER IF EXISTS "feedback_theme_analysis" ON "FeedbackTheme";
DROP TRIGGER IF EXISTS "contribution_no_delete" ON "InternalRatingContribution";
DROP TRIGGER IF EXISTS "contribution_snapshot_immutable" ON "InternalRatingContribution";
DROP TRIGGER IF EXISTS "feedback_profile_internal" ON "PlayerInternalRating";
DROP TRIGGER IF EXISTS "internal_event_immutable" ON "PlayerInternalRatingEvent";
DROP TRIGGER IF EXISTS "feedback_profile_assessment" ON "SelfAssessment";
DROP TRIGGER IF EXISTS "assessment_rating_sport" ON "SelfAssessmentRating";
DROP TRIGGER IF EXISTS "feedback_profile_self" ON "SelfAssessmentRating";
DROP TRIGGER IF EXISTS "self_rating_history" ON "SelfAssessmentRating";
DROP TRIGGER IF EXISTS "touch_assessment_rating" ON "SelfAssessmentRating";
DROP TRIGGER IF EXISTS "self_event_immutable" ON "SelfAssessmentRatingEvent";
DROP TRIGGER IF EXISTS "feedback_profile_catalog" ON "Skill";
DROP TRIGGER IF EXISTS "training_dag" ON "SkillPrerequisite";
DROP TRIGGER IF EXISTS "feedback_sport_analysis" ON "Sport";
DROP TRIGGER IF EXISTS "recipient_coaching_preference" ON "User";
DROP TRIGGER IF EXISTS "training_job_consistency" ON "VideoProcessingJob";

-- DropForeignKey
ALTER TABLE "AiCoachConversation" DROP CONSTRAINT "AiCoachConversation_userId_fkey";

-- DropForeignKey
ALTER TABLE "AiCoachTurn" DROP CONSTRAINT "AiCoachTurn_userId_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "AiCoachTurn" DROP CONSTRAINT "AiCoachTurn_userId_fkey";

-- DropForeignKey
ALTER TABLE "AiCoachUsage" DROP CONSTRAINT "AiCoachUsage_userId_fkey";

-- DropForeignKey
ALTER TABLE "AuthEmailChallenge" DROP CONSTRAINT "AuthEmailChallenge_userId_fkey";

-- DropForeignKey
ALTER TABLE "Drill" DROP CONSTRAINT "Drill_createdById_fkey";

-- DropForeignKey
ALTER TABLE "DrillCompletion" DROP CONSTRAINT "DrillCompletion_userId_fkey";

-- DropForeignKey
ALTER TABLE "DrillReferenceVideo" DROP CONSTRAINT "DrillReferenceVideo_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "DrillVideoSubmission" DROP CONSTRAINT "DrillVideoSubmission_userId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_matchId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_recipientId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_rejectedById_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_sportId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_submissionId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_submittedById_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackLink" DROP CONSTRAINT "FeedbackLink_assignedReviewerId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackLink" DROP CONSTRAINT "FeedbackLink_recipientId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackMatch" DROP CONSTRAINT "FeedbackMatch_feedbackId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackMatch" DROP CONSTRAINT "FeedbackMatch_matchId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackRating" DROP CONSTRAINT "FeedbackRating_feedbackId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackRating" DROP CONSTRAINT "FeedbackRating_skillId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackRequestMatch" DROP CONSTRAINT "FeedbackRequestMatch_feedbackLinkId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackRequestMatch" DROP CONSTRAINT "FeedbackRequestMatch_matchId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackReviewerSkillSnapshot" DROP CONSTRAINT "FeedbackReviewerSkillSnapshot_feedbackId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackReviewerSkillSnapshot" DROP CONSTRAINT "FeedbackReviewerSkillSnapshot_skillId_fkey";

-- DropForeignKey
ALTER TABLE "FeedbackSubmission" DROP CONSTRAINT "FeedbackSubmission_feedbackLinkId_fkey";

-- DropForeignKey
ALTER TABLE "InternalRatingContribution" DROP CONSTRAINT "InternalRatingContribution_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "InternalRatingContribution" DROP CONSTRAINT "InternalRatingContribution_userId_skillId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyPlayerSkillRating" DROP CONSTRAINT "PlayerSkillRating_skillId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyPlayerSkillRating" DROP CONSTRAINT "PlayerSkillRating_userId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyPlayerSportRating" DROP CONSTRAINT "PlayerSportRating_sportId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyPlayerSportRating" DROP CONSTRAINT "PlayerSportRating_userId_fkey";

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_sportId_fkey";

-- DropForeignKey
ALTER TABLE "MatchParticipant" DROP CONSTRAINT "MatchParticipant_matchId_fkey";

-- DropForeignKey
ALTER TABLE "MatchParticipant" DROP CONSTRAINT "MatchParticipant_team_fk";

-- DropForeignKey
ALTER TABLE "MatchParticipant" DROP CONSTRAINT "MatchParticipant_userId_fkey";

-- DropForeignKey
ALTER TABLE "MatchTeam" DROP CONSTRAINT "MatchTeam_matchId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerFeedbackAnalysisProfile" DROP CONSTRAINT "PlayerFeedbackAnalysisProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerInternalRating" DROP CONSTRAINT "PlayerInternalRating_userId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerInternalRatingEvent" DROP CONSTRAINT "PlayerInternalRatingEvent_userId_skillId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerSkillProgress" DROP CONSTRAINT "PlayerSkillProgress_userId_fkey";

-- DropForeignKey
ALTER TABLE "PlayerTrainingProfile" DROP CONSTRAINT "PlayerTrainingProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "SelfAssessment" DROP CONSTRAINT "SelfAssessment_sportId_fkey";

-- DropForeignKey
ALTER TABLE "SelfAssessment" DROP CONSTRAINT "SelfAssessment_userId_fkey";

-- DropForeignKey
ALTER TABLE "SelfAssessmentRating" DROP CONSTRAINT "SelfAssessmentRating_selfAssessmentId_fkey";

-- DropForeignKey
ALTER TABLE "SelfAssessmentRating" DROP CONSTRAINT "SelfAssessmentRating_skillId_fkey";

-- DropForeignKey
ALTER TABLE "SelfAssessmentRatingEvent" DROP CONSTRAINT "SelfAssessmentRatingEvent_selfAssessmentId_fkey";

-- DropForeignKey
ALTER TABLE "SelfAssessmentRatingEvent" DROP CONSTRAINT "SelfAssessmentRatingEvent_userId_fkey";

-- DropForeignKey
ALTER TABLE "Skill" DROP CONSTRAINT "Skill_sportId_fkey";

-- DropForeignKey
ALTER TABLE "UserAuthProvider" DROP CONSTRAINT "UserAuthProvider_userId_fkey";

-- AlterTable
ALTER TABLE "AiCoachConversation" ALTER COLUMN "userId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "AiCoachTurn" ALTER COLUMN "userId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "AiCoachUsage" DROP CONSTRAINT "AiCoachUsage_pkey",
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ADD CONSTRAINT "AiCoachUsage_pkey" PRIMARY KEY ("userId", "day");

-- AlterTable
ALTER TABLE "Drill" ALTER COLUMN "createdById" DROP NOT NULL,
ALTER COLUMN "createdById" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "DrillCompletion" ALTER COLUMN "userId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "DrillReferenceVideo" ALTER COLUMN "uploadedById" DROP NOT NULL,
ALTER COLUMN "uploadedById" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "DrillVideoSubmission" ALTER COLUMN "userId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Feedback" ALTER COLUMN "recipientId" SET DATA TYPE TEXT,
ALTER COLUMN "reviewerId" SET DATA TYPE TEXT,
ALTER COLUMN "approvedById" SET DATA TYPE TEXT,
ALTER COLUMN "rejectedById" SET DATA TYPE TEXT,
ALTER COLUMN "submittedById" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "FeedbackLink" ALTER COLUMN "recipientId" SET DATA TYPE TEXT,
ALTER COLUMN "assignedReviewerId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "FeedbackPrivacyEvent" ALTER COLUMN "actorId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "InternalRatingContribution" ALTER COLUMN "userId" SET DATA TYPE TEXT,
ALTER COLUMN "reviewerId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Match" ALTER COLUMN "createdById" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "MatchParticipant" ALTER COLUMN "userId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "PlayerFeedbackAnalysisProfile" DROP CONSTRAINT "PlayerFeedbackAnalysisProfile_pkey",
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ADD CONSTRAINT "PlayerFeedbackAnalysisProfile_pkey" PRIMARY KEY ("userId", "sportId");

-- AlterTable
ALTER TABLE "PlayerInternalRating" ALTER COLUMN "userId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "PlayerInternalRatingEvent" ALTER COLUMN "userId" SET DATA TYPE TEXT,
ALTER COLUMN "reviewerId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "PlayerSkillProgress" DROP CONSTRAINT "PlayerSkillProgress_pkey",
ALTER COLUMN "userId" SET DATA TYPE TEXT,
ADD CONSTRAINT "PlayerSkillProgress_pkey" PRIMARY KEY ("userId", "skillTreeNodeId");

-- AlterTable
ALTER TABLE "SelfAssessmentRatingEvent" ALTER COLUMN "userId" SET DATA TYPE TEXT;

-- DropTable
DROP TABLE "AuthEmailChallenge";

-- DropTable
DROP TABLE "AuthProviderDeletion";

-- DropTable
DROP TABLE "LegacyPlayerSkillRating";

-- DropTable
DROP TABLE "LegacyPlayerSportRating";

-- DropTable
DROP TABLE "OAuthTransaction";

-- DropTable
DROP TABLE "PlayerTrainingProfile";

-- DropTable
DROP TABLE "SelfAssessment";

-- DropTable
DROP TABLE "SelfAssessmentRating";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "UserAuthProvider";

-- DropEnum
DROP TYPE "AuthProvider";

-- CreateTable
CREATE TABLE "ClerkDeletionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClerkDeletionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClerkDeletionJob_status_createdAt_idx" ON "ClerkDeletionJob"("status", "createdAt");

-- CreateIndex
ALTER TABLE "SelfAssessmentRatingEvent" ADD COLUMN "sourceRevision" UUID NOT NULL;
CREATE UNIQUE INDEX "SelfAssessmentRatingEvent_userId_skillId_sourceRevision_key" ON "SelfAssessmentRatingEvent"("userId", "skillId", "sourceRevision");

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTeam" ADD CONSTRAINT "MatchTeam_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_teamId_fkey" FOREIGN KEY ("matchId", "teamId") REFERENCES "MatchTeam"("matchId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FeedbackSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRating" ADD CONSTRAINT "FeedbackRating_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRating" ADD CONSTRAINT "FeedbackRating_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReviewerSkillSnapshot" ADD CONSTRAINT "FeedbackReviewerSkillSnapshot_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReviewerSkillSnapshot" ADD CONSTRAINT "FeedbackReviewerSkillSnapshot_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInternalRatingEvent" ADD CONSTRAINT "PlayerInternalRatingEvent_userId_skillId_fkey" FOREIGN KEY ("userId", "skillId") REFERENCES "PlayerInternalRating"("userId", "skillId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRatingContribution" ADD CONSTRAINT "InternalRatingContribution_userId_skillId_fkey" FOREIGN KEY ("userId", "skillId") REFERENCES "PlayerInternalRating"("userId", "skillId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRequestMatch" ADD CONSTRAINT "FeedbackRequestMatch_feedbackLinkId_fkey" FOREIGN KEY ("feedbackLinkId") REFERENCES "FeedbackLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRequestMatch" ADD CONSTRAINT "FeedbackRequestMatch_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackMatch" ADD CONSTRAINT "FeedbackMatch_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackMatch" ADD CONSTRAINT "FeedbackMatch_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackSubmission" ADD CONSTRAINT "FeedbackSubmission_feedbackLinkId_fkey" FOREIGN KEY ("feedbackLinkId") REFERENCES "FeedbackLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCoachTurn" ADD CONSTRAINT "AiCoachTurn_userId_conversationId_fkey" FOREIGN KEY ("userId", "conversationId") REFERENCES "AiCoachConversation"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Feedback_level_sport_idx" RENAME TO "Feedback_reviewerOverallLevelAtSubmission_sportId_idx";

-- RenameIndex
ALTER INDEX "Feedback_match_idx" RENAME TO "Feedback_matchId_idx";

-- RenameIndex
ALTER INDEX "Feedback_recipient_created_idx" RENAME TO "Feedback_recipientId_createdAt_idx";

-- RenameIndex
ALTER INDEX "Feedback_reviewer_idx" RENAME TO "Feedback_reviewerId_idx";

-- RenameIndex
ALTER INDEX "Feedback_sport_created_idx" RENAME TO "Feedback_sportId_createdAt_idx";

-- RenameIndex
ALTER INDEX "FeedbackRating_skill_idx" RENAME TO "FeedbackRating_skillId_idx";

-- RenameIndex
ALTER INDEX "ReviewerSnapshot_skill_idx" RENAME TO "FeedbackReviewerSkillSnapshot_skillId_idx";

-- RenameIndex
ALTER INDEX "Match_creator_created_idx" RENAME TO "Match_createdById_createdAt_idx";

-- RenameIndex
ALTER INDEX "Match_sport_idx" RENAME TO "Match_sportId_idx";

-- RenameIndex
ALTER INDEX "MatchParticipant_match_team_idx" RENAME TO "MatchParticipant_matchId_teamId_idx";

-- RenameIndex
ALTER INDEX "MatchParticipant_user_idx" RENAME TO "MatchParticipant_userId_idx";

-- RenameIndex
ALTER INDEX "MatchTeam_match_idx" RENAME TO "MatchTeam_matchId_idx";

-- RenameIndex
ALTER INDEX "Skill_sport_active_idx" RENAME TO "Skill_sportId_active_idx";



UPDATE "Drill" SET "createdById"=NULL;

UPDATE "DrillReferenceVideo" SET "uploadedById"=NULL;

CREATE OR REPLACE FUNCTION public.check_feedback_match_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fid UUID;
BEGIN
 IF TG_TABLE_NAME = 'FeedbackMatch' THEN fid := NEW."feedbackId"; ELSE fid := NEW.id; END IF;
 IF EXISTS (SELECT 1 FROM "Feedback" f JOIN "FeedbackMatch" fm ON fm."feedbackId"=f.id WHERE f.id=fid AND f."matchId" IS NOT NULL) THEN
  RAISE EXCEPTION 'Feedback cannot mix single and combined match associations';
 END IF;
 RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.feedback_ai_submission_permitted(f "Feedback")
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 SELECT coalesce(f."submittedAt" IS NOT NULL AND f."rejectedAt" IS NULL AND
 ((f.status='PUBLISHED' AND (NOT f."approvalRequired" OR feedback_reviewer_approved(f))) OR (f.status='PENDING' AND f."approvalRequired" AND f."reviewerId" IS NOT NULL
  AND f."pendingAiAllowed" AND f."pendingAiConsentAt" IS NOT NULL AND f."pendingAiNoticeVersion"='pending-ai-disclosure-v1'))
 AND f."privateAnalyticsAllowed" AND f."privateAnalyticsConsentAt" IS NOT NULL AND f."privacyNoticeVersion"='feedback-privacy-v1'
 AND f."privateCoachingAllowed" AND f."privateCoachingConsentAt" IS NOT NULL
 AND EXISTS(SELECT 1 FROM "Sport" s WHERE s.id=f."sportId" AND s.slug IN ('volleyball','beach-volleyball'))
 ,false)
$function$
;

CREATE OR REPLACE FUNCTION public.feedback_analysis_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM invalidate_feedback_profile(OLD."recipientId",OLD."sportId"); RETURN OLD; END IF;
 IF TG_OP='INSERT' THEN PERFORM queue_feedback_analysis(NEW.id); RETURN NEW; END IF;
 IF (OLD."recipientId",OLD."sportId") IS DISTINCT FROM (NEW."recipientId",NEW."sportId") THEN
  PERFORM invalidate_feedback_profile(OLD."recipientId",OLD."sportId");
 END IF;
 IF (OLD."overallComment",OLD."recipientId",OLD."sportId") IS DISTINCT FROM (NEW."overallComment",NEW."recipientId",NEW."sportId") THEN
  PERFORM queue_feedback_analysis(NEW.id);
 ELSE PERFORM refresh_feedback_analysis_eligibility(NEW.id); END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_analysis_eligible(f "Feedback")
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 SELECT feedback_ai_submission_permitted(f) AND NOT EXISTS(SELECT 1 FROM "FeedbackAnalysisJob" j
 WHERE j."feedbackId"=f.id AND j.moderation NOT IN ('ALLOW','UNASSESSED'))
$function$
;

CREATE OR REPLACE FUNCTION public.feedback_internal_rating_eligible(f "Feedback")
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 SELECT f."submittedAt" IS NOT NULL AND f.status='PUBLISHED' AND feedback_reviewer_approved(f)
$function$
;

CREATE OR REPLACE FUNCTION public.feedback_privacy_remove_answers()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF (TG_OP='DELETE') OR NOT feedback_analysis_eligible(NEW) THEN
   UPDATE "AiCoachTurn" t SET response=NULL,"sourceRevision"=NULL,"errorCode"='OUTDATED',status='FAILED'
     FROM "AiCoachConversation" c WHERE c.id=t."conversationId" AND c."userId"=OLD."recipientId" AND c."sportId"=OLD."sportId";
 END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_private_analytics_eligible(f "Feedback")
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 SELECT f.status='PUBLISHED' AND f."privateAnalyticsAllowed"
 AND f."privateAnalyticsConsentAt" IS NOT NULL AND f."privacyNoticeVersion"='feedback-privacy-v1'
 AND (NOT f."approvalRequired" OR (f."approvedAt" IS NOT NULL AND f."approvedById"=f."reviewerId"))
 AND EXISTS(SELECT 1 FROM "Sport" s WHERE s.id=f."sportId" AND s.slug IN ('volleyball','beach-volleyball'))
$function$
;

CREATE OR REPLACE FUNCTION public.feedback_private_permission_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN PERFORM refresh_feedback_analysis_eligibility(NEW.id); RETURN NULL; END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_profile_catalog_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE p record; sid uuid;
BEGIN
 sid := CASE WHEN TG_OP='DELETE' THEN OLD."sportId" ELSE NEW."sportId" END;
 FOR p IN SELECT "userId","sportId" FROM "PlayerFeedbackAnalysisProfile" WHERE "sportId"=sid ORDER BY "userId"
 LOOP PERFORM invalidate_feedback_profile(p."userId",p."sportId"); END LOOP;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_profile_date_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN PERFORM invalidate_feedback_profile(NEW."recipientId",NEW."sportId"); RETURN NULL; END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_profile_internal_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE uid text; sid uuid; kid uuid;
BEGIN
 uid := CASE WHEN TG_OP='DELETE' THEN OLD."userId" ELSE NEW."userId" END;
 kid := CASE WHEN TG_OP='DELETE' THEN OLD."skillId" ELSE NEW."skillId" END;
 SELECT "sportId" INTO sid FROM "Skill" WHERE id=kid;
 IF FOUND THEN PERFORM invalidate_feedback_profile(uid,sid); END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_profile_job_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE f "Feedback";
BEGIN
 SELECT * INTO f FROM "Feedback" WHERE id=NEW."feedbackId";
 IF FOUND THEN PERFORM invalidate_feedback_profile(f."recipientId",f."sportId"); END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_profile_observation_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fid uuid; f "Feedback";
BEGIN
 fid := CASE WHEN TG_OP='DELETE' THEN OLD."feedbackId" ELSE NEW."feedbackId" END;
 SELECT * INTO f FROM "Feedback" WHERE id=fid;
 IF FOUND THEN PERFORM invalidate_feedback_profile(f."recipientId",f."sportId"); END IF;
 IF TG_OP='UPDATE' AND OLD."feedbackId" IS DISTINCT FROM NEW."feedbackId" THEN
  SELECT * INTO f FROM "Feedback" WHERE id=OLD."feedbackId";
  IF FOUND THEN PERFORM invalidate_feedback_profile(f."recipientId",f."sportId"); END IF;
 END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_profile_theme_catalog()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE p record;
BEGIN
 FOR p IN SELECT "userId","sportId" FROM "PlayerFeedbackAnalysisProfile" ORDER BY "userId","sportId"
 LOOP PERFORM invalidate_feedback_profile(p."userId",p."sportId"); END LOOP;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_rating_analysis_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fid uuid; f "Feedback";
BEGIN
 fid := CASE WHEN TG_OP='DELETE' THEN OLD."feedbackId" ELSE NEW."feedbackId" END;
 IF TG_OP='UPDATE' AND OLD."feedbackId" IS DISTINCT FROM NEW."feedbackId" THEN
   PERFORM queue_feedback_analysis(OLD."feedbackId");
 END IF;
 IF TG_OP!='UPDATE' OR (OLD.comment,OLD."skillId",OLD."feedbackId") IS DISTINCT FROM (NEW.comment,NEW."skillId",NEW."feedbackId") THEN
   PERFORM queue_feedback_analysis(fid);
 ELSE
   SELECT * INTO f FROM "Feedback" WHERE id=fid;
   IF FOUND THEN PERFORM invalidate_feedback_profile(f."recipientId",f."sportId"); END IF;
 END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_reviewer_approved(f "Feedback")
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
 SELECT coalesce(f."reviewerId" IS NOT NULL AND f."reviewerId"<>f."recipientId" AND f."rejectedAt" IS NULL AND
 ((f."approvedAt" IS NOT NULL AND f."approvedById"=f."reviewerId") OR
 (NOT f."approvalRequired" AND f."submittedById"=f."reviewerId")),false)
$function$
;

CREATE OR REPLACE FUNCTION public.feedback_sport_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fid uuid;
BEGIN
 FOR fid IN SELECT id FROM "Feedback" WHERE "sportId"=NEW.id ORDER BY id LOOP
   PERFORM queue_feedback_analysis(fid);
 END LOOP;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_theme_changed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE pair record;
BEGIN
 FOR pair IN SELECT DISTINCT f."recipientId", f."sportId" FROM "FeedbackObservation" o
   JOIN "Feedback" f ON f.id=o."feedbackId" WHERE o."themeId"=NEW.id
 LOOP PERFORM invalidate_feedback_profile(pair."recipientId",pair."sportId"); END LOOP;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.feedback_trust_classification(f "Feedback")
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
 SELECT CASE WHEN f.status='PUBLISHED' AND feedback_reviewer_approved(f) THEN 'VERIFIED_APPROVED'
 WHEN f."reviewerId" IS NULL THEN 'UNVERIFIED_GUEST' ELSE 'AWAITING_REVIEWER_APPROVAL' END
$function$
;

CREATE OR REPLACE FUNCTION public.invalidate_feedback_profile(uid text, sid uuid)
 RETURNS void
 LANGUAGE sql
AS $function$
 INSERT INTO "PlayerFeedbackAnalysisProfile" ("userId","sportId") VALUES (uid,sid)
 ON CONFLICT ("userId","sportId") DO UPDATE SET revision="PlayerFeedbackAnalysisProfile".revision+1,
 stale=true, "invalidatedAt"=CURRENT_TIMESTAMP, "rebuildRetryAt"=NULL
$function$
;

CREATE OR REPLACE FUNCTION public.preserve_feedback_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN
  IF ROW(NEW."reviewerOverallLevelAtSubmission",NEW."reviewerSnapshotCapturedAt",NEW."reviewerSelfAssessmentUpdatedAtAtSubmission",NEW."reviewerSelfAssessmentIdAtSubmission") IS DISTINCT FROM ROW(OLD."reviewerOverallLevelAtSubmission",OLD."reviewerSnapshotCapturedAt",OLD."reviewerSelfAssessmentUpdatedAtAtSubmission",OLD."reviewerSelfAssessmentIdAtSubmission") THEN
    RAISE EXCEPTION 'feedback reviewer snapshot metadata is immutable';
  END IF; RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.protect_feedback_reviewer_weight_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF ROW(OLD."reviewerInternalRatingAtSubmission", OLD."reviewerConfidenceAtSubmission", OLD."reviewerRawWeightAtSubmission", OLD."reviewerEffectiveRateAtSubmission", OLD."reviewerFinalRateAtSubmission", OLD."reviewerAlgorithmVersionAtSubmission", OLD."reviewerInternalSnapshotCapturedAt") IS DISTINCT FROM
     ROW(NEW."reviewerInternalRatingAtSubmission", NEW."reviewerConfidenceAtSubmission", NEW."reviewerRawWeightAtSubmission", NEW."reviewerEffectiveRateAtSubmission", NEW."reviewerFinalRateAtSubmission", NEW."reviewerAlgorithmVersionAtSubmission", NEW."reviewerInternalSnapshotCapturedAt") THEN
    RAISE EXCEPTION 'Feedback reviewer weight snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_internal_contribution_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF OLD."reviewerId"=current_setting('app.clerk_deletion_subject',true)
 AND NEW."reviewerId"=current_setting('app.clerk_deletion_anonymous',true)
 AND NEW."identityKey"=replace(OLD."identityKey",OLD."reviewerId",NEW."reviewerId")
 AND (to_jsonb(OLD)-'reviewerId'-'identityKey')=(to_jsonb(NEW)-'reviewerId'-'identityKey') THEN RETURN NEW; END IF;
 IF ROW(NEW."reviewerId",NEW."reviewerInternalRating",NEW."rawWeight",NEW.confidence,NEW."effectiveRate",NEW."finalRate",NEW."algorithmVersion",NEW."identityKey",NEW."effectiveAt",NEW."userId",NEW."skillId",NEW."feedbackId",NEW.sequence)
 IS DISTINCT FROM ROW(OLD."reviewerId",OLD."reviewerInternalRating",OLD."rawWeight",OLD.confidence,OLD."effectiveRate",OLD."finalRate",OLD."algorithmVersion",OLD."identityKey",OLD."effectiveAt",OLD."userId",OLD."skillId",OLD."feedbackId",OLD.sequence)
 THEN RAISE EXCEPTION 'Reviewer influence snapshots are immutable'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.queue_feedback_analysis(fid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE f "Feedback";
BEGIN
 SELECT * INTO f FROM "Feedback" WHERE id=fid FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 DELETE FROM "FeedbackObservation" WHERE "feedbackId"=fid;
 INSERT INTO "FeedbackAnalysisJob" ("feedbackId",status,"updatedAt")
 VALUES (fid,CASE WHEN feedback_analysis_eligible(f) THEN 'PENDING' ELSE 'SKIPPED' END,CURRENT_TIMESTAMP)
 ON CONFLICT ("feedbackId") DO UPDATE SET generation="FeedbackAnalysisJob".generation+1,
 status=EXCLUDED.status, attempts=0,"runAfter"=CURRENT_TIMESTAMP,"leaseToken"=NULL,"leaseUntil"=NULL,
 "sourceHash"=NULL,moderation='UNASSESSED',"errorCode"=NULL,"processedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP;
 PERFORM invalidate_feedback_profile(f."recipientId",f."sportId");
END $function$
;

CREATE OR REPLACE FUNCTION public.refresh_feedback_analysis_eligibility(fid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE f "Feedback"; j "FeedbackAnalysisJob";
BEGIN
 SELECT * INTO f FROM "Feedback" WHERE id=fid FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO j FROM "FeedbackAnalysisJob" WHERE "feedbackId"=fid;
 IF NOT feedback_analysis_eligible(f) THEN
  DELETE FROM "FeedbackObservation" WHERE "feedbackId"=fid;
  UPDATE "FeedbackAnalysisJob" SET status='SKIPPED',generation=generation+1,"leaseToken"=NULL,"leaseUntil"=NULL,
   "trustClassification"=feedback_trust_classification(f),"updatedAt"=CURRENT_TIMESTAMP WHERE "feedbackId"=fid;
 ELSIF j."feedbackId" IS NULL OR j.status='SKIPPED' THEN
  PERFORM queue_feedback_analysis(fid);
 ELSE
  UPDATE "FeedbackAnalysisJob" SET "trustClassification"=feedback_trust_classification(f) WHERE "feedbackId"=fid;
 END IF;
 PERFORM invalidate_feedback_profile(f."recipientId",f."sportId");
END $function$
;

CREATE OR REPLACE FUNCTION reject_rating_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF TG_OP='DELETE' AND OLD."userId"=current_setting('app.clerk_deletion_subject',true) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'reviewerId')=current_setting('app.clerk_deletion_subject',true)
 AND (to_jsonb(NEW)->>'reviewerId')=current_setting('app.clerk_deletion_anonymous',true)
 AND (to_jsonb(OLD)-'reviewerId')=(to_jsonb(NEW)-'reviewerId') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Rating history is immutable'; END $$;

CREATE OR REPLACE FUNCTION public.reject_snapshot_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN RAISE EXCEPTION 'historical reviewer snapshots are immutable'; END $function$
;

CREATE OR REPLACE FUNCTION public.training_job_scope()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN
 IF NEW."analysisId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "VideoAnalysis" a WHERE a.id=NEW."analysisId" AND a."submissionId"=NEW."submissionId")
 THEN RAISE EXCEPTION 'Analysis job source mismatch' USING ERRCODE='23514'; END IF; RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION public.training_prerequisite_dag()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN
 PERFORM pg_advisory_xact_lock(73012200);
 IF EXISTS(WITH RECURSIVE ancestors(id) AS (
 SELECT NEW."prerequisiteId" UNION SELECT p."prerequisiteId" FROM "SkillPrerequisite" p JOIN ancestors a ON p."skillId"=a.id)
 SELECT 1 FROM ancestors WHERE id=NEW."skillId") THEN RAISE EXCEPTION 'Training prerequisite cycle' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION public.training_published_drill()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ DECLARE did uuid; BEGIN
 IF TG_TABLE_NAME='Drill' THEN did:=coalesce(NEW.id,OLD.id); ELSE did:=coalesce(NEW."drillId",OLD."drillId"); END IF;
 IF EXISTS(SELECT 1 FROM "Drill" WHERE id=did AND status='PUBLISHED') AND
 ((SELECT count(*) FROM "DrillSkill" WHERE "drillId"=did AND role='PRIMARY')<>1 OR NOT EXISTS(SELECT 1 FROM "DrillStep" WHERE "drillId"=did AND length(btrim(instruction))>0))
 THEN RAISE EXCEPTION 'Published drill requires instructions and one primary skill' USING ERRCODE='23514'; END IF; RETURN NULL; END $function$
;

CREATE OR REPLACE FUNCTION public.training_reference_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN
 IF (OLD.id,OLD."drillId",OLD."techniqueVariantId",OLD."storageKey",OLD."referenceVersion",OLD."seriesId",OLD."fileSizeBytes",OLD."mimeType",OLD."cameraAngle",OLD.handedness)
 IS DISTINCT FROM (NEW.id,NEW."drillId",NEW."techniqueVariantId",NEW."storageKey",NEW."referenceVersion",NEW."seriesId",NEW."fileSizeBytes",NEW."mimeType",NEW."cameraAngle",NEW.handedness)
 THEN RAISE EXCEPTION 'Create a new immutable reference revision' USING ERRCODE='23514'; END IF; RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION public.training_submission_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN
 IF (OLD."userId",OLD."drillId",OLD."techniqueVariantId",OLD."storageKey",OLD."mimeType",OLD."fileSizeBytes") IS DISTINCT FROM
 (NEW."userId",NEW."drillId",NEW."techniqueVariantId",NEW."storageKey",NEW."mimeType",NEW."fileSizeBytes")
 THEN RAISE EXCEPTION 'Submission identity and object are immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $function$
;

CREATE OR REPLACE FUNCTION validate_skill_sport() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE expected uuid; actual uuid;
 BEGIN SELECT "sportId" INTO expected FROM "Feedback" WHERE id=NEW."feedbackId";
 SELECT "sportId" INTO actual FROM "Skill" WHERE id=NEW."skillId";
 IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Feedback skill belongs to another sport'; END IF;
 RETURN NEW; END $$;

CREATE OR REPLACE VIEW "EligibleFeedbackObservation" AS  SELECT o.id,
    o."feedbackId",
    o.generation,
    o."sourceKey",
    o."skillId",
    o."themeId",
    o.sentiment,
    o.evidence,
    o.fingerprint,
    o."sourceHash",
    o.provider,
    o."modelVersion",
    o."promptVersion",
    o."feedbackCreatedAt",
    o."createdAt"
   FROM ((("FeedbackObservation" o
     JOIN "FeedbackAnalysisJob" j ON (((j."feedbackId" = o."feedbackId") AND (j.generation = o.generation) AND (j."sourceHash" = o."sourceHash"))))
     JOIN "Feedback" f ON ((f.id = o."feedbackId")))
     JOIN "FeedbackTheme" t ON (((t.id = o."themeId") AND t.active)))
  WHERE (feedback_analysis_eligible(f.*) AND (j.status = 'COMPLETED'::text) AND (j.moderation = 'ALLOW'::text));

CREATE OR REPLACE VIEW "PrivateAnalyticsEligibleFeedback" AS  SELECT f.id,
    f."recipientId",
    f."reviewerId",
    f."sportId",
    f."matchId",
    f."overallComment",
    f."guestName",
    f."guestInviteNonce",
    f."guestInviteExpiresAt",
    f.status,
    f."analyticsAllowed",
    f."evidenceAllowed",
    f."reviewerOverallLevelAtSubmission",
    f."reviewerSnapshotCapturedAt",
    f."reviewerSelfAssessmentUpdatedAtAtSubmission",
    f."reviewerSelfAssessmentIdAtSubmission",
    f."createdAt",
    f."updatedAt",
    f."approvalRequired",
    f."approvedAt",
    f."approvedById",
    f."feedbackLinkId",
    f."rejectedAt",
    f."rejectedById",
    f."rejectionReason",
    f."submittedById",
    f."submissionId",
    f."privacyNoticeVersion",
    f."privateAnalyticsAllowed",
    f."privateAnalyticsConsentAt",
    f."privateCoachingAllowed",
    f."privateCoachingConsentAt",
    f."publicAnalyticsAllowed",
    f."publicConsentAt",
    f."publicConsentVersion"
   FROM ("Feedback" f
     LEFT JOIN "FeedbackAnalysisJob" j ON ((j."feedbackId" = f.id)))
  WHERE (feedback_private_analytics_eligible(f.*) AND (COALESCE(j.moderation, 'UNASSESSED'::text) = ANY (ARRAY['UNASSESSED'::text, 'ALLOW'::text])));

CREATE OR REPLACE VIEW "AnalysisEligibleFeedback" AS  SELECT id,
    "recipientId",
    "reviewerId",
    "sportId",
    "matchId",
    "overallComment",
    "guestName",
    "guestInviteNonce",
    "guestInviteExpiresAt",
    status,
    "analyticsAllowed",
    "evidenceAllowed",
    "reviewerOverallLevelAtSubmission",
    "reviewerSnapshotCapturedAt",
    "reviewerSelfAssessmentUpdatedAtAtSubmission",
    "reviewerSelfAssessmentIdAtSubmission",
    "createdAt",
    "updatedAt",
    "approvalRequired",
    "approvedAt",
    "approvedById",
    "feedbackLinkId",
    "rejectedAt",
    "rejectedById",
    "rejectionReason",
    "submittedById",
    "submissionId",
    "privacyNoticeVersion",
    "privateAnalyticsAllowed",
    "privateAnalyticsConsentAt",
    "privateCoachingAllowed",
    "privateCoachingConsentAt",
    "publicAnalyticsAllowed",
    "publicConsentAt",
    "publicConsentVersion",
    "submittedAt",
    "pendingAiAllowed",
    "pendingAiConsentAt",
    "pendingAiNoticeVersion"
   FROM "Feedback" f
  WHERE feedback_analysis_eligible(f.*);

DROP TRIGGER IF EXISTS "training_drill_publication" ON "Drill";

CREATE CONSTRAINT TRIGGER training_drill_publication AFTER INSERT OR UPDATE ON public."Drill" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION training_published_drill();

DROP TRIGGER IF EXISTS "training_reference_revision" ON "DrillReferenceVideo";

CREATE TRIGGER training_reference_revision BEFORE UPDATE ON public."DrillReferenceVideo" FOR EACH ROW EXECUTE FUNCTION training_reference_immutable();

DROP TRIGGER IF EXISTS "training_drill_skills" ON "DrillSkill";

CREATE CONSTRAINT TRIGGER training_drill_skills AFTER INSERT OR DELETE OR UPDATE ON public."DrillSkill" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION training_published_drill();

DROP TRIGGER IF EXISTS "training_drill_steps" ON "DrillStep";

CREATE CONSTRAINT TRIGGER training_drill_steps AFTER INSERT OR DELETE OR UPDATE ON public."DrillStep" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION training_published_drill();

DROP TRIGGER IF EXISTS "training_submission_immutable" ON "DrillVideoSubmission";

CREATE TRIGGER training_submission_immutable BEFORE UPDATE ON public."DrillVideoSubmission" FOR EACH ROW EXECUTE FUNCTION training_submission_identity();

DROP TRIGGER IF EXISTS "Feedback_consistent_matches" ON "Feedback";

CREATE CONSTRAINT TRIGGER "Feedback_consistent_matches" AFTER INSERT OR UPDATE ON public."Feedback" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_feedback_match_consistency();

DROP TRIGGER IF EXISTS "feedback_ai_submission_update" ON "Feedback";

CREATE TRIGGER feedback_ai_submission_update AFTER UPDATE OF "submittedAt", "pendingAiAllowed", "pendingAiConsentAt", "pendingAiNoticeVersion", "rejectedAt" ON public."Feedback" FOR EACH ROW WHEN ((((((old."submittedAt" IS DISTINCT FROM new."submittedAt") OR (old."pendingAiAllowed" IS DISTINCT FROM new."pendingAiAllowed")) OR (old."pendingAiConsentAt" IS DISTINCT FROM new."pendingAiConsentAt")) OR (old."pendingAiNoticeVersion" IS DISTINCT FROM new."pendingAiNoticeVersion")) OR (old."rejectedAt" IS DISTINCT FROM new."rejectedAt"))) EXECUTE FUNCTION feedback_analysis_changed();

DROP TRIGGER IF EXISTS "feedback_analysis_delete" ON "Feedback";

CREATE TRIGGER feedback_analysis_delete BEFORE DELETE ON public."Feedback" FOR EACH ROW EXECUTE FUNCTION feedback_analysis_changed();

DROP TRIGGER IF EXISTS "feedback_analysis_insert" ON "Feedback";

CREATE TRIGGER feedback_analysis_insert AFTER INSERT ON public."Feedback" FOR EACH ROW EXECUTE FUNCTION feedback_analysis_changed();

DROP TRIGGER IF EXISTS "feedback_analysis_update" ON "Feedback";

CREATE TRIGGER feedback_analysis_update AFTER UPDATE OF "overallComment", status, "analyticsAllowed", "evidenceAllowed", "approvalRequired", "approvedAt", "approvedById", "reviewerId", "recipientId", "sportId" ON public."Feedback" FOR EACH ROW WHEN (((((((((((old."overallComment" IS DISTINCT FROM new."overallComment") OR (old.status IS DISTINCT FROM new.status)) OR (old."analyticsAllowed" IS DISTINCT FROM new."analyticsAllowed")) OR (old."evidenceAllowed" IS DISTINCT FROM new."evidenceAllowed")) OR (old."approvalRequired" IS DISTINCT FROM new."approvalRequired")) OR (old."approvedAt" IS DISTINCT FROM new."approvedAt")) OR (old."approvedById" IS DISTINCT FROM new."approvedById")) OR (old."reviewerId" IS DISTINCT FROM new."reviewerId")) OR (old."recipientId" IS DISTINCT FROM new."recipientId")) OR (old."sportId" IS DISTINCT FROM new."sportId"))) EXECUTE FUNCTION feedback_analysis_changed();

DROP TRIGGER IF EXISTS "feedback_pending_ai_answers" ON "Feedback";

CREATE TRIGGER feedback_pending_ai_answers AFTER UPDATE OF "pendingAiAllowed", "pendingAiConsentAt", "pendingAiNoticeVersion", "submittedAt", "rejectedAt" ON public."Feedback" FOR EACH ROW EXECUTE FUNCTION feedback_privacy_remove_answers();

DROP TRIGGER IF EXISTS "feedback_privacy_answers" ON "Feedback";

CREATE TRIGGER feedback_privacy_answers AFTER DELETE OR UPDATE OF status, "privateAnalyticsAllowed", "privateCoachingAllowed", "privacyNoticeVersion", "privateAnalyticsConsentAt", "privateCoachingConsentAt", "approvalRequired", "approvedAt", "approvedById" ON public."Feedback" FOR EACH ROW EXECUTE FUNCTION feedback_privacy_remove_answers();

DROP TRIGGER IF EXISTS "feedback_private_permission_update" ON "Feedback";

CREATE TRIGGER feedback_private_permission_update AFTER UPDATE OF "privateAnalyticsAllowed", "privateCoachingAllowed", "privacyNoticeVersion", "privateAnalyticsConsentAt", "privateCoachingConsentAt" ON public."Feedback" FOR EACH ROW WHEN ((((((old."privateAnalyticsAllowed" IS DISTINCT FROM new."privateAnalyticsAllowed") OR (old."privateCoachingAllowed" IS DISTINCT FROM new."privateCoachingAllowed")) OR (old."privacyNoticeVersion" IS DISTINCT FROM new."privacyNoticeVersion")) OR (old."privateAnalyticsConsentAt" IS DISTINCT FROM new."privateAnalyticsConsentAt")) OR (old."privateCoachingConsentAt" IS DISTINCT FROM new."privateCoachingConsentAt"))) EXECUTE FUNCTION feedback_private_permission_changed();

DROP TRIGGER IF EXISTS "feedback_profile_timestamp" ON "Feedback";

CREATE TRIGGER feedback_profile_timestamp AFTER UPDATE OF "createdAt" ON public."Feedback" FOR EACH ROW WHEN ((old."createdAt" IS DISTINCT FROM new."createdAt")) EXECUTE FUNCTION feedback_profile_date_changed();

DROP TRIGGER IF EXISTS "feedback_snapshot_no_update" ON "Feedback";

CREATE TRIGGER feedback_snapshot_no_update BEFORE UPDATE ON public."Feedback" FOR EACH ROW EXECUTE FUNCTION preserve_feedback_snapshot();

DROP TRIGGER IF EXISTS "feedback_profile_job" ON "FeedbackAnalysisJob";

CREATE TRIGGER feedback_profile_job AFTER UPDATE OF status, moderation ON public."FeedbackAnalysisJob" FOR EACH ROW WHEN (((old.moderation IS DISTINCT FROM new.moderation) OR ((old.status IS DISTINCT FROM new.status) AND (new.status = ANY (ARRAY['COMPLETED'::text, 'FAILED'::text, 'SKIPPED'::text]))))) EXECUTE FUNCTION feedback_profile_job_changed();

DROP TRIGGER IF EXISTS "FeedbackMatch_consistent" ON "FeedbackMatch";

CREATE CONSTRAINT TRIGGER "FeedbackMatch_consistent" AFTER INSERT OR UPDATE ON public."FeedbackMatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_feedback_match_consistency();

DROP TRIGGER IF EXISTS "feedback_profile_observation" ON "FeedbackObservation";

CREATE TRIGGER feedback_profile_observation AFTER INSERT OR DELETE OR UPDATE ON public."FeedbackObservation" FOR EACH ROW EXECUTE FUNCTION feedback_profile_observation_changed();

DROP TRIGGER IF EXISTS "FeedbackRating_protect_reviewer_weight_snapshot" ON "FeedbackRating";

CREATE TRIGGER "FeedbackRating_protect_reviewer_weight_snapshot" BEFORE UPDATE ON public."FeedbackRating" FOR EACH ROW EXECUTE FUNCTION protect_feedback_reviewer_weight_snapshot();

DROP TRIGGER IF EXISTS "feedback_rating_analysis" ON "FeedbackRating";

CREATE TRIGGER feedback_rating_analysis AFTER INSERT OR DELETE OR UPDATE ON public."FeedbackRating" FOR EACH ROW EXECUTE FUNCTION feedback_rating_analysis_changed();

DROP TRIGGER IF EXISTS "feedback_rating_sport" ON "FeedbackRating";

CREATE TRIGGER feedback_rating_sport BEFORE INSERT OR UPDATE ON public."FeedbackRating" FOR EACH ROW EXECUTE FUNCTION validate_skill_sport();

DROP TRIGGER IF EXISTS "snapshot_no_delete" ON "FeedbackReviewerSkillSnapshot";

CREATE TRIGGER snapshot_no_delete BEFORE DELETE ON public."FeedbackReviewerSkillSnapshot" FOR EACH ROW WHEN ((pg_trigger_depth() = 0)) EXECUTE FUNCTION reject_snapshot_mutation();

DROP TRIGGER IF EXISTS "snapshot_no_update" ON "FeedbackReviewerSkillSnapshot";

CREATE TRIGGER snapshot_no_update BEFORE UPDATE ON public."FeedbackReviewerSkillSnapshot" FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();

DROP TRIGGER IF EXISTS "snapshot_rating_sport" ON "FeedbackReviewerSkillSnapshot";

CREATE TRIGGER snapshot_rating_sport BEFORE INSERT OR UPDATE ON public."FeedbackReviewerSkillSnapshot" FOR EACH ROW EXECUTE FUNCTION validate_skill_sport();

DROP TRIGGER IF EXISTS "feedback_profile_theme_catalog" ON "FeedbackTheme";

CREATE TRIGGER feedback_profile_theme_catalog AFTER INSERT OR DELETE OR UPDATE ON public."FeedbackTheme" FOR EACH ROW EXECUTE FUNCTION feedback_profile_theme_catalog();

DROP TRIGGER IF EXISTS "feedback_theme_analysis" ON "FeedbackTheme";

CREATE TRIGGER feedback_theme_analysis AFTER UPDATE ON public."FeedbackTheme" FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION feedback_theme_changed();

DROP TRIGGER IF EXISTS "contribution_no_delete" ON "InternalRatingContribution";

CREATE TRIGGER contribution_no_delete BEFORE DELETE ON public."InternalRatingContribution" FOR EACH ROW EXECUTE FUNCTION reject_rating_history_mutation();

DROP TRIGGER IF EXISTS "contribution_snapshot_immutable" ON "InternalRatingContribution";

CREATE TRIGGER contribution_snapshot_immutable BEFORE UPDATE ON public."InternalRatingContribution" FOR EACH ROW EXECUTE FUNCTION protect_internal_contribution_snapshot();

DROP TRIGGER IF EXISTS "feedback_profile_internal" ON "PlayerInternalRating";

CREATE TRIGGER feedback_profile_internal AFTER INSERT OR DELETE OR UPDATE ON public."PlayerInternalRating" FOR EACH ROW EXECUTE FUNCTION feedback_profile_internal_changed();

DROP TRIGGER IF EXISTS "internal_event_immutable" ON "PlayerInternalRatingEvent";

CREATE TRIGGER internal_event_immutable BEFORE DELETE OR UPDATE ON public."PlayerInternalRatingEvent" FOR EACH ROW EXECUTE FUNCTION reject_rating_history_mutation();

DROP TRIGGER IF EXISTS "self_event_immutable" ON "SelfAssessmentRatingEvent";

CREATE TRIGGER self_event_immutable BEFORE DELETE OR UPDATE ON public."SelfAssessmentRatingEvent" FOR EACH ROW EXECUTE FUNCTION reject_rating_history_mutation();

DROP TRIGGER IF EXISTS "feedback_profile_catalog" ON "Skill";

CREATE TRIGGER feedback_profile_catalog AFTER INSERT OR DELETE OR UPDATE ON public."Skill" FOR EACH ROW EXECUTE FUNCTION feedback_profile_catalog_changed();

DROP TRIGGER IF EXISTS "training_dag" ON "SkillPrerequisite";

CREATE TRIGGER training_dag BEFORE INSERT OR UPDATE ON public."SkillPrerequisite" FOR EACH ROW EXECUTE FUNCTION training_prerequisite_dag();

DROP TRIGGER IF EXISTS "feedback_sport_analysis" ON "Sport";

CREATE TRIGGER feedback_sport_analysis AFTER UPDATE OF slug ON public."Sport" FOR EACH ROW WHEN ((old.slug IS DISTINCT FROM new.slug)) EXECUTE FUNCTION feedback_sport_changed();

DROP TRIGGER IF EXISTS "training_job_consistency" ON "VideoProcessingJob";

CREATE TRIGGER training_job_consistency BEFORE INSERT OR UPDATE ON public."VideoProcessingJob" FOR EACH ROW EXECUTE FUNCTION training_job_scope();

CREATE FUNCTION clerk_self_rating_changed() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE sid uuid;
 BEGIN SELECT "sportId" INTO sid FROM "Skill" WHERE id=NEW."skillId";
 PERFORM invalidate_feedback_profile(NEW."userId",sid); RETURN NEW; END $$;
 CREATE TRIGGER clerk_self_rating_profile AFTER INSERT ON "SelfAssessmentRatingEvent" FOR EACH ROW EXECUTE FUNCTION clerk_self_rating_changed();

INSERT INTO "VideoPoseArtifact" SELECT * FROM clerk_reference_poses;

INSERT INTO "VideoProcessingJob" SELECT * FROM clerk_reference_jobs;

ALTER TABLE "VideoProcessingJob" DROP CONSTRAINT training_job_source;
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT training_job_source CHECK (
 num_nonnulls("submissionId","referenceVideoId")=1 OR
 (type='CLEANUP_MEDIA' AND "submissionId" IS NULL AND "referenceVideoId" IS NULL AND "analysisId" IS NULL
 AND ((coalesce(payload->>'clerkCutoverCleanup'='true' OR payload->>'clerkDeletionCleanup'='true',false) AND jsonb_typeof(payload->'keys')='array') OR (status='COMPLETED' AND payload IS NULL))));

INSERT INTO "VideoProcessingJob"(id,type,status,"idempotencyKey",payload,"createdAt","updatedAt")
 SELECT gen_random_uuid(),'CLEANUP_MEDIA','PENDING','clerk-cutover:'||md5(key),jsonb_build_object('clerkCutoverCleanup',true,'keys',jsonb_build_array(key)),now(),now()
 FROM clerk_private_objects WHERE key LIKE 'training/players/%'
 ON CONFLICT ("idempotencyKey") DO NOTHING;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "Sport" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='Sport') THEN RAISE EXCEPTION 'Independent content changed: Sport'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "Skill" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='Skill') THEN RAISE EXCEPTION 'Independent content changed: Skill'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "FeedbackTheme" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='FeedbackTheme') THEN RAISE EXCEPTION 'Independent content changed: FeedbackTheme'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "SkillTreeNode" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='SkillTreeNode') THEN RAISE EXCEPTION 'Independent content changed: SkillTreeNode'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "SkillPrerequisite" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='SkillPrerequisite') THEN RAISE EXCEPTION 'Independent content changed: SkillPrerequisite'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "Drill" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='Drill') THEN RAISE EXCEPTION 'Independent content changed: Drill'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "DrillStep" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='DrillStep') THEN RAISE EXCEPTION 'Independent content changed: DrillStep'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "DrillSkill" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='DrillSkill') THEN RAISE EXCEPTION 'Independent content changed: DrillSkill'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "CoachingSituation" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='CoachingSituation') THEN RAISE EXCEPTION 'Independent content changed: CoachingSituation'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "DrillRecommendationRule" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='DrillRecommendationRule') THEN RAISE EXCEPTION 'Independent content changed: DrillRecommendationRule'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "DrillTechniqueVariant" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='DrillTechniqueVariant') THEN RAISE EXCEPTION 'Independent content changed: DrillTechniqueVariant'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "DrillReferenceVideo" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='DrillReferenceVideo') THEN RAISE EXCEPTION 'Independent content changed: DrillReferenceVideo'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "TechniqueCheckpoint" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='TechniqueCheckpoint') THEN RAISE EXCEPTION 'Independent content changed: TechniqueCheckpoint'; END IF; END $$;

DO $$ DECLARE actual text; BEGIN SELECT md5(coalesce(string_agg((to_jsonb(t)-'createdById'-'uploadedById')::text,'|' ORDER BY (to_jsonb(t)-'createdById'-'uploadedById')::text),'')) INTO actual FROM "VideoWorkerHeartbeat" t;
 IF actual IS DISTINCT FROM (SELECT fingerprint FROM clerk_content_fingerprints WHERE name='VideoWorkerHeartbeat') THEN RAISE EXCEPTION 'Independent content changed: VideoWorkerHeartbeat'; END IF; END $$;

DROP TABLE "_ClerkCutoverPermit";

COMMIT;
