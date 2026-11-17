-- Requires pgvector on the database server. Does not backfill historical feedback.
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "FeedbackTheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skillSlugs" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FeedbackTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackAnalysisJob" (
    "feedbackId" UUID NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "sourceHash" TEXT,
    "provider" TEXT,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "moderation" TEXT NOT NULL DEFAULT 'UNASSESSED',
    "errorCode" TEXT,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackAnalysisJob_pkey" PRIMARY KEY ("feedbackId")
);

-- CreateTable
CREATE TABLE "FeedbackExtractionRun" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "provider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "sourceHash" TEXT,
    "apiAttempts" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "moderation" TEXT,
    "unknownThemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "FeedbackExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackObservation" (
    "id" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "skillId" UUID,
    "themeId" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "feedbackCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackEmbeddingJob" (
    "observationId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackEmbeddingJob_pkey" PRIMARY KEY ("observationId","provider","model","modelVersion","dimensions","templateVersion")
);

-- CreateTable
CREATE TABLE "FeedbackObservationEmbedding" (
    "observationId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "vector" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackObservationEmbedding_pkey" PRIMARY KEY ("observationId","provider","model","modelVersion","dimensions","templateVersion")
);

-- CreateTable
CREATE TABLE "PlayerFeedbackAnalysisProfile" (
    "userId" UUID NOT NULL,
    "sportId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "builtRevision" INTEGER NOT NULL DEFAULT 0,
    "stale" BOOLEAN NOT NULL DEFAULT true,
    "data" JSONB NOT NULL DEFAULT '{}',
    "builtAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerFeedbackAnalysisProfile_pkey" PRIMARY KEY ("userId","sportId")
);

-- CreateIndex
CREATE INDEX "FeedbackAnalysisJob_status_runAfter_idx" ON "FeedbackAnalysisJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "FeedbackExtractionRun_feedbackId_startedAt_idx" ON "FeedbackExtractionRun"("feedbackId", "startedAt");

-- CreateIndex
CREATE INDEX "FeedbackObservation_feedbackId_themeId_idx" ON "FeedbackObservation"("feedbackId", "themeId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackObservation_feedbackId_generation_fingerprint_key" ON "FeedbackObservation"("feedbackId", "generation", "fingerprint");

-- CreateIndex
CREATE INDEX "FeedbackEmbeddingJob_status_runAfter_idx" ON "FeedbackEmbeddingJob"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "FeedbackAnalysisJob" ADD CONSTRAINT "FeedbackAnalysisJob_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackExtractionRun" ADD CONSTRAINT "FeedbackExtractionRun_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "FeedbackAnalysisJob"("feedbackId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackObservation" ADD CONSTRAINT "FeedbackObservation_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "FeedbackAnalysisJob"("feedbackId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackObservation" ADD CONSTRAINT "FeedbackObservation_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackObservation" ADD CONSTRAINT "FeedbackObservation_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "FeedbackTheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEmbeddingJob" ADD CONSTRAINT "FeedbackEmbeddingJob_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "FeedbackObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackObservationEmbedding" ADD CONSTRAINT "FeedbackObservationEmbedding_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "FeedbackObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerFeedbackAnalysisProfile" ADD CONSTRAINT "PlayerFeedbackAnalysisProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerFeedbackAnalysisProfile" ADD CONSTRAINT "PlayerFeedbackAnalysisProfile_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackObservation" ADD CHECK (sentiment IN ('positive','neutral','negative'));
ALTER TABLE "FeedbackObservationEmbedding" ADD CHECK (dimensions > 0 AND vector_dims(vector) = dimensions);
ALTER TABLE "FeedbackAnalysisJob" ADD CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','SKIPPED'));
ALTER TABLE "FeedbackEmbeddingJob" ADD CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED'));

INSERT INTO "FeedbackTheme" (id,name,"skillSlugs") VALUES
 ('shot_selection','Shot selection',ARRAY['attack']),
 ('approach_timing','Approach timing',ARRAY['attack']),
 ('attack_placement','Attack placement',ARRAY['attack']),
 ('defensive_positioning','Defensive positioning',ARRAY['defense']),
 ('court_coverage','Court coverage',ARRAY['defense']),
 ('reaction_time','Reaction time',ARRAY['defense']),
 ('platform_control','Platform control',ARRAY['passing']),
 ('first_contact_accuracy','First contact accuracy',ARRAY['passing']),
 ('serve_receive','Serve receive',ARRAY['passing']),
 ('setting_accuracy','Setting accuracy',ARRAY['setting']),
 ('ball_height','Ball height',ARRAY['setting']),
 ('hand_positioning','Hand positioning',ARRAY['setting']),
 ('serve_consistency','Serve consistency',ARRAY['serving']),
 ('serve_placement','Serve placement',ARRAY['serving']),
 ('toss_consistency','Toss consistency',ARRAY['serving']),
 ('communication','Communication',ARRAY[]::text[]),
 ('teamwork','Teamwork',ARRAY[]::text[]),
 ('court_awareness','Court awareness',ARRAY[]::text[]),
 ('decision_making','Decision making',ARRAY[]::text[]);

CREATE FUNCTION feedback_analysis_eligible(f "Feedback") RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT f.status = 'PUBLISHED' AND f."analyticsAllowed" AND f."evidenceAllowed"
 AND (NOT f."approvalRequired" OR (f."approvedAt" IS NOT NULL AND f."approvedById" = f."reviewerId"))
 AND EXISTS (SELECT 1 FROM "Sport" s WHERE s.id=f."sportId" AND s.slug IN ('volleyball','beach-volleyball'))
$$;

CREATE FUNCTION invalidate_feedback_profile(uid uuid, sid uuid) RETURNS void
LANGUAGE sql AS $$
 INSERT INTO "PlayerFeedbackAnalysisProfile" ("userId","sportId") VALUES (uid,sid)
 ON CONFLICT ("userId","sportId") DO UPDATE SET revision="PlayerFeedbackAnalysisProfile".revision+1,
 stale=true, data='{}', "invalidatedAt"=CURRENT_TIMESTAMP
$$;

-- Queue writes and derived-data invalidation participate in the source transaction.
CREATE FUNCTION queue_feedback_analysis(fid uuid) RETURNS void LANGUAGE plpgsql AS $$
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
END $$;

CREATE FUNCTION feedback_analysis_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   PERFORM invalidate_feedback_profile(OLD."recipientId",OLD."sportId"); RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (OLD."recipientId",OLD."sportId") IS DISTINCT FROM (NEW."recipientId",NEW."sportId") THEN
   PERFORM invalidate_feedback_profile(OLD."recipientId",OLD."sportId");
 END IF;
 PERFORM queue_feedback_analysis(NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER feedback_analysis_insert AFTER INSERT ON "Feedback"
 FOR EACH ROW EXECUTE FUNCTION feedback_analysis_changed();
CREATE TRIGGER feedback_analysis_update AFTER UPDATE OF "overallComment",status,"analyticsAllowed","evidenceAllowed",
 "approvalRequired","approvedAt","approvedById","reviewerId","recipientId","sportId" ON "Feedback"
 FOR EACH ROW WHEN ((OLD."overallComment",OLD.status,OLD."analyticsAllowed",OLD."evidenceAllowed",OLD."approvalRequired",OLD."approvedAt",OLD."approvedById",OLD."reviewerId",OLD."recipientId",OLD."sportId")
 IS DISTINCT FROM (NEW."overallComment",NEW.status,NEW."analyticsAllowed",NEW."evidenceAllowed",NEW."approvalRequired",NEW."approvedAt",NEW."approvedById",NEW."reviewerId",NEW."recipientId",NEW."sportId")) EXECUTE FUNCTION feedback_analysis_changed();
CREATE TRIGGER feedback_analysis_delete BEFORE DELETE ON "Feedback"
 FOR EACH ROW EXECUTE FUNCTION feedback_analysis_changed();

CREATE FUNCTION feedback_rating_analysis_changed() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
CREATE TRIGGER feedback_rating_analysis AFTER INSERT OR UPDATE OR DELETE ON "FeedbackRating"
 FOR EACH ROW EXECUTE FUNCTION feedback_rating_analysis_changed();

-- Defense in depth: readers must still scope by authenticated recipient ID.
CREATE VIEW "EligibleFeedbackObservation" AS
 SELECT o.* FROM "FeedbackObservation" o
 JOIN "FeedbackAnalysisJob" j ON j."feedbackId"=o."feedbackId" AND j.generation=o.generation AND j."sourceHash"=o."sourceHash"
 JOIN "Feedback" f ON f.id=o."feedbackId"
 JOIN "FeedbackTheme" t ON t.id=o."themeId" AND t.active
 WHERE feedback_analysis_eligible(f) AND j.status='COMPLETED' AND j.moderation='ALLOW';

CREATE FUNCTION feedback_theme_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pair record;
BEGIN
 FOR pair IN SELECT DISTINCT f."recipientId", f."sportId" FROM "FeedbackObservation" o
   JOIN "Feedback" f ON f.id=o."feedbackId" WHERE o."themeId"=NEW.id
 LOOP PERFORM invalidate_feedback_profile(pair."recipientId",pair."sportId"); END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_theme_analysis AFTER UPDATE ON "FeedbackTheme"
 FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION feedback_theme_changed();

CREATE FUNCTION feedback_sport_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fid uuid;
BEGIN
 FOR fid IN SELECT id FROM "Feedback" WHERE "sportId"=NEW.id ORDER BY id LOOP
   PERFORM queue_feedback_analysis(fid);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_sport_analysis AFTER UPDATE OF slug ON "Sport"
 FOR EACH ROW WHEN (OLD.slug IS DISTINCT FROM NEW.slug) EXECUTE FUNCTION feedback_sport_changed();
COMMIT;
