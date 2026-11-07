CREATE EXTENSION IF NOT EXISTS "citext";
CREATE TYPE "MatchStatus" AS ENUM ('DRAFT','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE "FeedbackStatus" AS ENUM ('PENDING','PUBLISHED','HIDDEN','DELETED');

CREATE TABLE "User" ("id" UUID PRIMARY KEY, "username" CITEXT NOT NULL UNIQUE, "email" CITEXT NOT NULL UNIQUE, "passwordHash" TEXT NOT NULL, "age" INTEGER NOT NULL, "heightCm" INTEGER NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL);
CREATE TABLE "Sport" ("id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL);
CREATE TABLE "Skill" ("id" UUID PRIMARY KEY, "sportId" UUID NOT NULL REFERENCES "Sport"("id") ON DELETE RESTRICT, "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "description" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "requiredForSelfAssessment" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL, UNIQUE("sportId","slug"));
CREATE TABLE "Match" ("id" UUID PRIMARY KEY, "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "sportId" UUID REFERENCES "Sport"("id") ON DELETE SET NULL, "playedAt" TIMESTAMPTZ, "description" TEXT, "status" "MatchStatus" NOT NULL DEFAULT 'DRAFT', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL);
CREATE TABLE "MatchTeam" ("id" UUID PRIMARY KEY, "matchId" UUID NOT NULL REFERENCES "Match"("id") ON DELETE CASCADE, "teamNumber" INTEGER NOT NULL, "name" TEXT, "score" INTEGER, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL, UNIQUE("matchId","teamNumber"), UNIQUE("matchId","id"), CONSTRAINT "MatchTeam_score_check" CHECK ("score" IS NULL OR "score" >= 0), CONSTRAINT "MatchTeam_number_check" CHECK ("teamNumber" > 0));
CREATE TABLE "MatchParticipant" ("id" UUID PRIMARY KEY, "matchId" UUID NOT NULL REFERENCES "Match"("id") ON DELETE CASCADE, "teamId" UUID, "userId" UUID REFERENCES "User"("id") ON DELETE SET NULL, "guestName" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL, UNIQUE("matchId","userId"), CONSTRAINT "MatchParticipant_identity_check" CHECK (("userId" IS NOT NULL)::int + (NULLIF(BTRIM("guestName"),'') IS NOT NULL)::int = 1), CONSTRAINT "MatchParticipant_team_fk" FOREIGN KEY ("matchId","teamId") REFERENCES "MatchTeam"("matchId","id") ON DELETE RESTRICT);
CREATE TABLE "Feedback" ("id" UUID PRIMARY KEY, "recipientId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "reviewerId" UUID REFERENCES "User"("id") ON DELETE SET NULL, "sportId" UUID NOT NULL REFERENCES "Sport"("id") ON DELETE RESTRICT, "matchId" UUID REFERENCES "Match"("id") ON DELETE SET NULL, "overallComment" TEXT, "guestName" TEXT, "guestInviteNonce" UUID UNIQUE, "guestInviteExpiresAt" TIMESTAMPTZ, "status" "FeedbackStatus" NOT NULL DEFAULT 'PUBLISHED', "analyticsAllowed" BOOLEAN NOT NULL DEFAULT false, "evidenceAllowed" BOOLEAN NOT NULL DEFAULT false, "reviewerOverallLevelAtSubmission" TEXT, "reviewerSnapshotCapturedAt" TIMESTAMPTZ, "reviewerSelfAssessmentUpdatedAtAtSubmission" TIMESTAMPTZ, "reviewerSelfAssessmentIdAtSubmission" UUID, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL, CONSTRAINT "Feedback_identity_check" CHECK (("reviewerId" IS NOT NULL AND "guestName" IS NULL) OR ("reviewerId" IS NULL AND NULLIF(BTRIM("guestName"),'') IS NOT NULL)), CONSTRAINT "Feedback_no_self_review" CHECK ("reviewerId" IS NULL OR "reviewerId" <> "recipientId"));
CREATE TABLE "FeedbackRating" ("feedbackId" UUID NOT NULL REFERENCES "Feedback"("id") ON DELETE CASCADE, "skillId" UUID NOT NULL REFERENCES "Skill"("id") ON DELETE RESTRICT, "rating" INTEGER NOT NULL, "comment" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL, PRIMARY KEY("feedbackId","skillId"), CHECK ("rating" BETWEEN 1 AND 5));
CREATE TABLE "SelfAssessment" ("id" UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "sportId" UUID NOT NULL REFERENCES "Sport"("id") ON DELETE RESTRICT, "overallLevel" TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL, UNIQUE("userId","sportId"));
CREATE TABLE "SelfAssessmentRating" ("selfAssessmentId" UUID NOT NULL REFERENCES "SelfAssessment"("id") ON DELETE CASCADE, "skillId" UUID NOT NULL REFERENCES "Skill"("id") ON DELETE RESTRICT, "rating" INTEGER NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL, PRIMARY KEY("selfAssessmentId","skillId"), CHECK ("rating" BETWEEN 1 AND 5));
CREATE TABLE "FeedbackReviewerSkillSnapshot" ("feedbackId" UUID NOT NULL REFERENCES "Feedback"("id") ON DELETE CASCADE, "skillId" UUID NOT NULL REFERENCES "Skill"("id") ON DELETE RESTRICT, "ratingAtSubmission" INTEGER NOT NULL, "sourceRatingUpdatedAt" TIMESTAMPTZ NOT NULL, "capturedAt" TIMESTAMPTZ NOT NULL, PRIMARY KEY("feedbackId","skillId"), CHECK ("ratingAtSubmission" BETWEEN 1 AND 5));

ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_reviewerId_fkey";
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "MatchParticipant" DROP CONSTRAINT "MatchParticipant_userId_fkey";
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT;

CREATE INDEX "Skill_sport_active_idx" ON "Skill"("sportId","active");
CREATE INDEX "Match_creator_created_idx" ON "Match"("createdById","createdAt");
CREATE INDEX "Match_sport_idx" ON "Match"("sportId");
CREATE INDEX "MatchTeam_match_idx" ON "MatchTeam"("matchId");
CREATE INDEX "MatchParticipant_match_team_idx" ON "MatchParticipant"("matchId","teamId");
CREATE INDEX "MatchParticipant_user_idx" ON "MatchParticipant"("userId");
CREATE INDEX "Feedback_recipient_created_idx" ON "Feedback"("recipientId","createdAt");
CREATE INDEX "Feedback_sport_created_idx" ON "Feedback"("sportId","createdAt");
CREATE INDEX "Feedback_reviewer_idx" ON "Feedback"("reviewerId");
CREATE INDEX "Feedback_match_idx" ON "Feedback"("matchId");
CREATE INDEX "Feedback_level_sport_idx" ON "Feedback"("reviewerOverallLevelAtSubmission","sportId");
CREATE INDEX "FeedbackRating_skill_idx" ON "FeedbackRating"("skillId");
CREATE INDEX "SelfAssessment_user_sport_idx" ON "SelfAssessment"("userId","sportId");
CREATE INDEX "SelfAssessmentRating_skill_idx" ON "SelfAssessmentRating"("skillId");
CREATE INDEX "ReviewerSnapshot_skill_idx" ON "FeedbackReviewerSkillSnapshot"("skillId");

-- Snapshot rows and copied metadata are write-once. Only deleting the parent feedback can remove rows.
CREATE FUNCTION reject_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'historical reviewer snapshots are immutable'; END $$;
CREATE TRIGGER "snapshot_no_update" BEFORE UPDATE ON "FeedbackReviewerSkillSnapshot" FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
CREATE TRIGGER "snapshot_no_delete" BEFORE DELETE ON "FeedbackReviewerSkillSnapshot" FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION reject_snapshot_mutation();
CREATE FUNCTION preserve_feedback_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF ROW(NEW."reviewerOverallLevelAtSubmission",NEW."reviewerSnapshotCapturedAt",NEW."reviewerSelfAssessmentUpdatedAtAtSubmission",NEW."reviewerSelfAssessmentIdAtSubmission") IS DISTINCT FROM ROW(OLD."reviewerOverallLevelAtSubmission",OLD."reviewerSnapshotCapturedAt",OLD."reviewerSelfAssessmentUpdatedAtAtSubmission",OLD."reviewerSelfAssessmentIdAtSubmission") THEN
    RAISE EXCEPTION 'feedback reviewer snapshot metadata is immutable';
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER "feedback_snapshot_no_update" BEFORE UPDATE ON "Feedback" FOR EACH ROW EXECUTE FUNCTION preserve_feedback_snapshot();

-- Enforce cross-row sport consistency at the database boundary.
CREATE FUNCTION validate_skill_sport() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE expected UUID; actual UUID; BEGIN
  SELECT "sportId" INTO actual FROM "Skill" WHERE id=NEW."skillId";
  IF TG_TABLE_NAME='FeedbackRating' THEN SELECT "sportId" INTO expected FROM "Feedback" WHERE id=NEW."feedbackId";
  ELSIF TG_TABLE_NAME='SelfAssessmentRating' THEN SELECT "sportId" INTO expected FROM "SelfAssessment" WHERE id=NEW."selfAssessmentId";
  ELSE SELECT "sportId" INTO expected FROM "Feedback" WHERE id=NEW."feedbackId"; END IF;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'skill belongs to another sport'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "feedback_rating_sport" BEFORE INSERT OR UPDATE ON "FeedbackRating" FOR EACH ROW EXECUTE FUNCTION validate_skill_sport();
CREATE TRIGGER "assessment_rating_sport" BEFORE INSERT OR UPDATE ON "SelfAssessmentRating" FOR EACH ROW EXECUTE FUNCTION validate_skill_sport();
CREATE TRIGGER "snapshot_rating_sport" BEFORE INSERT OR UPDATE ON "FeedbackReviewerSkillSnapshot" FOR EACH ROW EXECUTE FUNCTION validate_skill_sport();

-- A rating update changes the assessment version timestamp used by snapshot capture.
CREATE FUNCTION touch_assessment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE "SelfAssessment" SET "updatedAt"=clock_timestamp() WHERE id=COALESCE(NEW."selfAssessmentId",OLD."selfAssessmentId"); RETURN COALESCE(NEW,OLD); END $$;
CREATE TRIGGER "touch_assessment_rating" AFTER INSERT OR UPDATE OR DELETE ON "SelfAssessmentRating" FOR EACH ROW EXECUTE FUNCTION touch_assessment();
