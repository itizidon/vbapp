BEGIN;
ALTER TABLE "PlayerFeedbackAnalysisProfile"
 ADD COLUMN "algorithmVersion" integer NOT NULL DEFAULT 0,
 ADD COLUMN "expiresAt" timestamp(3),
 ADD COLUMN "rebuildError" text,
 ADD COLUMN "rebuildErrorAt" timestamp(3),
 ADD COLUMN "rebuildAttemptAt" timestamp(3),
 ADD COLUMN "rebuildRetryAt" timestamp(3);

-- Retain the last successful snapshot privately. Readers never serve stale snapshots.
CREATE OR REPLACE FUNCTION invalidate_feedback_profile(uid uuid, sid uuid) RETURNS void
LANGUAGE sql AS $$
 INSERT INTO "PlayerFeedbackAnalysisProfile" ("userId","sportId") VALUES (uid,sid)
 ON CONFLICT ("userId","sportId") DO UPDATE SET revision="PlayerFeedbackAnalysisProfile".revision+1,
 stale=true, "invalidatedAt"=CURRENT_TIMESTAMP, "rebuildRetryAt"=NULL
$$;

-- Shared eligibility for numerical statistics, theme coverage, and profile summaries.
-- Awaiting/failed extraction can still contribute consented numerical ratings; readiness is explicit.
CREATE VIEW "AnalysisEligibleFeedback" AS
 SELECT f.* FROM "Feedback" f LEFT JOIN "FeedbackAnalysisJob" j ON j."feedbackId"=f.id
 WHERE feedback_analysis_eligible(f) AND COALESCE(j.moderation,'UNASSESSED') IN ('UNASSESSED','ALLOW');

CREATE FUNCTION feedback_profile_job_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "Feedback";
BEGIN
 SELECT * INTO f FROM "Feedback" WHERE id=NEW."feedbackId";
 IF FOUND THEN PERFORM invalidate_feedback_profile(f."recipientId",f."sportId"); END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_profile_job AFTER UPDATE OF status,moderation ON "FeedbackAnalysisJob"
 FOR EACH ROW WHEN (OLD.moderation IS DISTINCT FROM NEW.moderation OR
  (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('COMPLETED','FAILED','SKIPPED')))
 EXECUTE FUNCTION feedback_profile_job_changed();

CREATE FUNCTION feedback_profile_observation_changed() RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;
CREATE TRIGGER feedback_profile_observation AFTER INSERT OR UPDATE OR DELETE ON "FeedbackObservation"
 FOR EACH ROW EXECUTE FUNCTION feedback_profile_observation_changed();

CREATE FUNCTION feedback_profile_self_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid uuid; a "SelfAssessment";
BEGIN
 aid := CASE WHEN TG_OP='DELETE' THEN OLD."selfAssessmentId" ELSE NEW."selfAssessmentId" END;
 SELECT * INTO a FROM "SelfAssessment" WHERE id=aid;
 IF FOUND THEN PERFORM invalidate_feedback_profile(a."userId",a."sportId"); END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_profile_self AFTER INSERT OR UPDATE OR DELETE ON "SelfAssessmentRating"
 FOR EACH ROW EXECUTE FUNCTION feedback_profile_self_changed();
CREATE FUNCTION feedback_profile_assessment_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM invalidate_feedback_profile(OLD."userId",OLD."sportId"); RETURN OLD; END $$;
CREATE TRIGGER feedback_profile_assessment BEFORE DELETE ON "SelfAssessment"
 FOR EACH ROW EXECUTE FUNCTION feedback_profile_assessment_deleted();

CREATE FUNCTION feedback_profile_internal_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid uuid; sid uuid; kid uuid;
BEGIN
 uid := CASE WHEN TG_OP='DELETE' THEN OLD."userId" ELSE NEW."userId" END;
 kid := CASE WHEN TG_OP='DELETE' THEN OLD."skillId" ELSE NEW."skillId" END;
 SELECT "sportId" INTO sid FROM "Skill" WHERE id=kid;
 IF FOUND THEN PERFORM invalidate_feedback_profile(uid,sid); END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_profile_internal AFTER INSERT OR UPDATE OR DELETE ON "PlayerInternalRating"
 FOR EACH ROW EXECUTE FUNCTION feedback_profile_internal_changed();

CREATE FUNCTION feedback_profile_catalog_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; sid uuid;
BEGIN
 sid := CASE WHEN TG_OP='DELETE' THEN OLD."sportId" ELSE NEW."sportId" END;
 FOR p IN SELECT "userId","sportId" FROM "PlayerFeedbackAnalysisProfile" WHERE "sportId"=sid ORDER BY "userId"
 LOOP PERFORM invalidate_feedback_profile(p."userId",p."sportId"); END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_profile_catalog AFTER INSERT OR UPDATE OR DELETE ON "Skill"
 FOR EACH ROW EXECUTE FUNCTION feedback_profile_catalog_changed();
CREATE FUNCTION feedback_profile_date_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM invalidate_feedback_profile(NEW."recipientId",NEW."sportId"); RETURN NULL; END $$;
CREATE TRIGGER feedback_profile_timestamp AFTER UPDATE OF "createdAt" ON "Feedback"
 FOR EACH ROW WHEN (OLD."createdAt" IS DISTINCT FROM NEW."createdAt") EXECUTE FUNCTION feedback_profile_date_changed();

CREATE FUNCTION feedback_profile_theme_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
 FOR p IN SELECT "userId","sportId" FROM "PlayerFeedbackAnalysisProfile" ORDER BY "userId","sportId"
 LOOP PERFORM invalidate_feedback_profile(p."userId",p."sportId"); END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER feedback_profile_theme_catalog AFTER INSERT OR UPDATE OR DELETE ON "FeedbackTheme"
 FOR EACH ROW EXECUTE FUNCTION feedback_profile_theme_catalog();
COMMIT;
