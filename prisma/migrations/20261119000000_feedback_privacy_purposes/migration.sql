BEGIN;
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiCoachingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "privacyNoticeVersion" TEXT,
ADD COLUMN     "privateAnalyticsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "privateAnalyticsConsentAt" TIMESTAMP(3),
ADD COLUMN     "privateCoachingAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "privateCoachingConsentAt" TIMESTAMP(3),
ADD COLUMN     "publicAnalyticsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicConsentAt" TIMESTAMP(3),
ADD COLUMN     "publicConsentVersion" TEXT;

-- CreateTable
CREATE TABLE "FeedbackPrivacyEvent" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "actorRole" TEXT NOT NULL,

    CONSTRAINT "FeedbackPrivacyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackPrivacyEvent_feedbackId_occurredAt_idx" ON "FeedbackPrivacyEvent"("feedbackId", "occurredAt");

-- AddForeignKey
ALTER TABLE "FeedbackPrivacyEvent" ADD CONSTRAINT "FeedbackPrivacyEvent_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- No historical permission is promoted. Legacy flags retain their original values.
CREATE FUNCTION feedback_private_analytics_eligible(f "Feedback") RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT f.status='PUBLISHED' AND f."privateAnalyticsAllowed"
 AND f."privateAnalyticsConsentAt" IS NOT NULL AND f."privacyNoticeVersion"='feedback-privacy-v1'
 AND (NOT f."approvalRequired" OR (f."approvedAt" IS NOT NULL AND f."approvedById"=f."reviewerId"))
 AND EXISTS(SELECT 1 FROM "Sport" s WHERE s.id=f."sportId" AND s.slug IN ('volleyball','beach-volleyball'))
$$;
CREATE OR REPLACE FUNCTION feedback_analysis_eligible(f "Feedback") RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT feedback_private_analytics_eligible(f) AND f."privateCoachingAllowed"
 AND f."privateCoachingConsentAt" IS NOT NULL
 AND EXISTS(SELECT 1 FROM "User" u WHERE u.id=f."recipientId" AND u."aiCoachingEnabled")
$$;
CREATE OR REPLACE VIEW "AnalysisEligibleFeedback" AS
 SELECT f.* FROM "Feedback" f LEFT JOIN "FeedbackAnalysisJob" j ON j."feedbackId"=f.id
 WHERE feedback_analysis_eligible(f) AND COALESCE(j.moderation,'UNASSESSED') IN ('UNASSESSED','ALLOW');
CREATE VIEW "PrivateAnalyticsEligibleFeedback" AS
 SELECT f.* FROM "Feedback" f LEFT JOIN "FeedbackAnalysisJob" j ON j."feedbackId"=f.id
 WHERE feedback_private_analytics_eligible(f) AND COALESCE(j.moderation,'UNASSESSED') IN ('UNASSESSED','ALLOW');

-- Reuse the same transactional invalidation path for the new private permissions.
CREATE FUNCTION feedback_private_permission_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m text;
BEGIN
 SELECT moderation INTO m FROM "FeedbackAnalysisJob" WHERE "feedbackId"=NEW.id;
 PERFORM queue_feedback_analysis(NEW.id);
 IF m NOT IN ('ALLOW','UNASSESSED') THEN
   UPDATE "FeedbackAnalysisJob" SET moderation=m,status='SKIPPED' WHERE "feedbackId"=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_private_permission_update AFTER UPDATE OF "privateAnalyticsAllowed","privateCoachingAllowed",
 "privacyNoticeVersion","privateAnalyticsConsentAt","privateCoachingConsentAt" ON "Feedback"
 FOR EACH ROW WHEN ((OLD."privateAnalyticsAllowed",OLD."privateCoachingAllowed",OLD."privacyNoticeVersion",OLD."privateAnalyticsConsentAt",OLD."privateCoachingConsentAt")
 IS DISTINCT FROM (NEW."privateAnalyticsAllowed",NEW."privateCoachingAllowed",NEW."privacyNoticeVersion",NEW."privateAnalyticsConsentAt",NEW."privateCoachingConsentAt"))
 EXECUTE FUNCTION feedback_private_permission_changed();

-- Withhold and remove saved answer/evidence content after source permission loss or hiding/deletion.
CREATE FUNCTION feedback_privacy_remove_answers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_OP='DELETE') OR NOT feedback_analysis_eligible(NEW) THEN
   UPDATE "AiCoachTurn" t SET response=NULL,"sourceRevision"=NULL,"errorCode"='OUTDATED',status='FAILED'
     FROM "AiCoachConversation" c WHERE c.id=t."conversationId" AND c."userId"=OLD."recipientId" AND c."sportId"=OLD."sportId";
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_privacy_answers AFTER UPDATE OF status,"privateAnalyticsAllowed","privateCoachingAllowed",
 "privacyNoticeVersion","privateAnalyticsConsentAt","privateCoachingConsentAt","approvalRequired","approvedAt","approvedById" OR DELETE ON "Feedback"
 FOR EACH ROW EXECUTE FUNCTION feedback_privacy_remove_answers();

CREATE FUNCTION recipient_coaching_preference_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "Feedback"; m text;
BEGIN
 FOR f IN SELECT * FROM "Feedback" WHERE "recipientId"=NEW.id ORDER BY id FOR UPDATE LOOP
   SELECT moderation INTO m FROM "FeedbackAnalysisJob" WHERE "feedbackId"=f.id;
   PERFORM queue_feedback_analysis(f.id);
   -- Preference changes do not undo an existing moderation exclusion.
   IF m NOT IN ('ALLOW','UNASSESSED') THEN
     UPDATE "FeedbackAnalysisJob" SET moderation=m,status='SKIPPED' WHERE "feedbackId"=f.id;
   END IF;
 END LOOP;
 IF NOT NEW."aiCoachingEnabled" THEN
   UPDATE "AiCoachTurn" SET response=NULL,"sourceRevision"=NULL,"errorCode"='OUTDATED',status='FAILED' WHERE "userId"=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER recipient_coaching_preference AFTER UPDATE OF "aiCoachingEnabled" ON "User"
 FOR EACH ROW WHEN (OLD."aiCoachingEnabled" IS DISTINCT FROM NEW."aiCoachingEnabled") EXECUTE FUNCTION recipient_coaching_preference_changed();

-- Remove now-ineligible derived observations, vectors and saved answers, without changing original reviews or permissions.
DELETE FROM "FeedbackObservation" o USING "Feedback" f WHERE o."feedbackId"=f.id AND NOT feedback_analysis_eligible(f);
UPDATE "FeedbackAnalysisJob" j SET status='SKIPPED',"leaseToken"=NULL,"leaseUntil"=NULL
 FROM "Feedback" f WHERE j."feedbackId"=f.id AND NOT feedback_analysis_eligible(f);
UPDATE "PlayerFeedbackAnalysisProfile" SET stale=true,revision=revision+1,data='{}',"invalidatedAt"=CURRENT_TIMESTAMP;
UPDATE "AiCoachTurn" SET response=NULL,"sourceRevision"=NULL,"errorCode"='OUTDATED',status='FAILED';
COMMIT;
