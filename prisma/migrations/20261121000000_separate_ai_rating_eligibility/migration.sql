BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Feedback" ADD COLUMN "submittedAt" TIMESTAMP(3), ADD COLUMN "pendingAiAllowed" boolean NOT NULL DEFAULT false,
 ADD COLUMN "pendingAiConsentAt" TIMESTAMP(3), ADD COLUMN "pendingAiNoticeVersion" text;
ALTER TABLE "FeedbackAnalysisJob" ADD COLUMN "trustClassification" text, ADD COLUMN "trustAtExtraction" text;
-- Existing application creates published reviews only at submission. Pending requires provenance AND content.
-- Do not grant any permission, claim a historical approval, or alter internal rating history.
UPDATE "Feedback" f SET "submittedAt"=f."createdAt" WHERE f.status <> 'PENDING' OR
 (f."approvalRequired" AND (f."submissionId" IS NOT NULL OR f."feedbackLinkId" IS NOT NULL OR f."submittedById" IS NOT NULL)
 AND (NULLIF(btrim(f."overallComment"),'') IS NOT NULL OR EXISTS(SELECT 1 FROM "FeedbackRating" r WHERE r."feedbackId"=f.id)));
CREATE FUNCTION feedback_reviewer_approved(f "Feedback") RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(f."reviewerId" IS NOT NULL AND f."reviewerId"<>f."recipientId" AND f."rejectedAt" IS NULL AND
 ((f."approvedAt" IS NOT NULL AND f."approvedById"=f."reviewerId") OR
 (NOT f."approvalRequired" AND f."submittedById"=f."reviewerId")),false)
$$;
CREATE FUNCTION feedback_internal_rating_eligible(f "Feedback") RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT f."submittedAt" IS NOT NULL AND f.status='PUBLISHED' AND feedback_reviewer_approved(f)
$$;
CREATE FUNCTION feedback_trust_classification(f "Feedback") RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN f.status='PUBLISHED' AND feedback_reviewer_approved(f) THEN 'VERIFIED_APPROVED'
 WHEN f."reviewerId" IS NULL THEN 'UNVERIFIED_GUEST' ELSE 'AWAITING_REVIEWER_APPROVAL' END
$$;
CREATE FUNCTION feedback_ai_submission_permitted(f "Feedback") RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(f."submittedAt" IS NOT NULL AND f."rejectedAt" IS NULL AND
 ((f.status='PUBLISHED' AND (NOT f."approvalRequired" OR feedback_reviewer_approved(f))) OR (f.status='PENDING' AND f."approvalRequired" AND f."reviewerId" IS NOT NULL
  AND f."pendingAiAllowed" AND f."pendingAiConsentAt" IS NOT NULL AND f."pendingAiNoticeVersion"='pending-ai-disclosure-v1'))
 AND f."privateAnalyticsAllowed" AND f."privateAnalyticsConsentAt" IS NOT NULL AND f."privacyNoticeVersion"='feedback-privacy-v1'
 AND f."privateCoachingAllowed" AND f."privateCoachingConsentAt" IS NOT NULL
 AND EXISTS(SELECT 1 FROM "User" u WHERE u.id=f."recipientId" AND u."aiCoachingEnabled")
 AND EXISTS(SELECT 1 FROM "Sport" s WHERE s.id=f."sportId" AND s.slug IN ('volleyball','beach-volleyball'))
 ,false)
$$;
CREATE OR REPLACE FUNCTION feedback_analysis_eligible(f "Feedback") RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT feedback_ai_submission_permitted(f) AND NOT EXISTS(SELECT 1 FROM "FeedbackAnalysisJob" j
 WHERE j."feedbackId"=f.id AND j.moderation NOT IN ('ALLOW','UNASSESSED'))
$$;
CREATE OR REPLACE VIEW "AnalysisEligibleFeedback" AS SELECT f.* FROM "Feedback" f
 WHERE feedback_analysis_eligible(f);
-- Metadata-only transitions do not delete observations, change source hashes or create paid jobs.
CREATE FUNCTION refresh_feedback_analysis_eligibility(fid uuid) RETURNS void LANGUAGE plpgsql AS $$
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
END $$;
CREATE OR REPLACE FUNCTION feedback_analysis_changed() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
CREATE OR REPLACE FUNCTION feedback_private_permission_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM refresh_feedback_analysis_eligibility(NEW.id); RETURN NULL; END $$;
CREATE TRIGGER feedback_ai_submission_update AFTER UPDATE OF "submittedAt","pendingAiAllowed","pendingAiConsentAt","pendingAiNoticeVersion","rejectedAt" ON "Feedback"
 FOR EACH ROW WHEN ((OLD."submittedAt",OLD."pendingAiAllowed",OLD."pendingAiConsentAt",OLD."pendingAiNoticeVersion",OLD."rejectedAt") IS DISTINCT FROM
 (NEW."submittedAt",NEW."pendingAiAllowed",NEW."pendingAiConsentAt",NEW."pendingAiNoticeVersion",NEW."rejectedAt")) EXECUTE FUNCTION feedback_analysis_changed();
CREATE OR REPLACE FUNCTION recipient_coaching_preference_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "Feedback";
BEGIN
 FOR f IN SELECT * FROM "Feedback" WHERE "recipientId"=NEW.id ORDER BY id FOR UPDATE LOOP
  PERFORM refresh_feedback_analysis_eligibility(f.id);
 END LOOP;
 IF NOT NEW."aiCoachingEnabled" THEN
  UPDATE "AiCoachTurn" SET response=NULL,"sourceRevision"=NULL,"errorCode"='OUTDATED',status='FAILED' WHERE "userId"=NEW.id;
 END IF;
 RETURN NULL;
END $$;
-- New disclosure withdrawal also invalidates any saved answer content immediately.
CREATE TRIGGER feedback_pending_ai_answers AFTER UPDATE OF "pendingAiAllowed","pendingAiConsentAt","pendingAiNoticeVersion","submittedAt","rejectedAt" ON "Feedback"
 FOR EACH ROW EXECUTE FUNCTION feedback_privacy_remove_answers();
UPDATE "FeedbackAnalysisJob" j SET "trustClassification"=feedback_trust_classification(f) FROM "Feedback" f WHERE f.id=j."feedbackId";
UPDATE "PlayerFeedbackAnalysisProfile" SET stale=true,revision=revision+1,data='{}',"invalidatedAt"=CURRENT_TIMESTAMP;
UPDATE "AiCoachTurn" SET response=NULL,"sourceRevision"=NULL,"errorCode"='OUTDATED',status='FAILED';
COMMIT;
