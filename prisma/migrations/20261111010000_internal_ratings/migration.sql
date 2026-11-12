-- CreateEnum
CREATE TYPE "InternalRatingEventType" AS ENUM ('INITIALIZED', 'FEEDBACK_APPLIED', 'CORRECTION', 'REBUILT');

-- CreateEnum
CREATE TYPE "SelfRatingEventType" AS ENUM ('CREATED', 'UPDATED', 'BASELINE');

-- CreateTable
CREATE TABLE "PlayerInternalRating" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "initialRating" DECIMAL(12,8) NOT NULL,
    "currentRating" DECIMAL(12,8) NOT NULL,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerInternalRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerInternalRatingEvent" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "feedbackId" UUID,
    "sourceKey" TEXT,
    "type" "InternalRatingEventType" NOT NULL,
    "previousRating" DECIMAL(12,8) NOT NULL,
    "submittedRating" INTEGER,
    "reviewerId" UUID,
    "reviewerInternalRating" DECIMAL(12,8),
    "rawWeight" DECIMAL(20,12),
    "confidence" DECIMAL(14,12),
    "effectiveRate" DECIMAL(14,12),
    "finalRate" DECIMAL(14,12),
    "delta" DECIMAL(12,8) NOT NULL,
    "newRating" DECIMAL(12,8) NOT NULL,
    "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "chartPoint" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerInternalRatingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfAssessmentRatingEvent" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "selfAssessmentId" UUID NOT NULL,
    "previousRating" INTEGER,
    "newRating" INTEGER NOT NULL,
    "type" "SelfRatingEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfAssessmentRatingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalRatingContribution" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "feedbackId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewerInternalRating" DECIMAL(12,8),
    "rawWeight" DECIMAL(20,12) NOT NULL,
    "confidence" DECIMAL(14,12) NOT NULL,
    "effectiveRate" DECIMAL(14,12) NOT NULL,
    "finalRate" DECIMAL(14,12) NOT NULL,
    "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
    "identityKey" TEXT NOT NULL,
    "submittedRating" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalRatingContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerInternalRating_skillId_idx" ON "PlayerInternalRating"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInternalRating_userId_skillId_key" ON "PlayerInternalRating"("userId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInternalRatingEvent_sequence_key" ON "PlayerInternalRatingEvent"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInternalRatingEvent_sourceKey_key" ON "PlayerInternalRatingEvent"("sourceKey");

-- CreateIndex
CREATE INDEX "PlayerInternalRatingEvent_userId_skillId_revision_effective_idx" ON "PlayerInternalRatingEvent"("userId", "skillId", "revision", "effectiveAt", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SelfAssessmentRatingEvent_sequence_key" ON "SelfAssessmentRatingEvent"("sequence");

-- CreateIndex
CREATE INDEX "SelfAssessmentRatingEvent_userId_skillId_createdAt_sequence_idx" ON "SelfAssessmentRatingEvent"("userId", "skillId", "createdAt", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "InternalRatingContribution_sequence_key" ON "InternalRatingContribution"("sequence");

-- CreateIndex
CREATE INDEX "InternalRatingContribution_userId_skillId_sequence_idx" ON "InternalRatingContribution"("userId", "skillId", "sequence");

-- CreateIndex
CREATE INDEX "InternalRatingContribution_userId_skillId_eligible_reviewer_idx" ON "InternalRatingContribution"("userId", "skillId", "eligible", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalRatingContribution_feedbackId_skillId_key" ON "InternalRatingContribution"("feedbackId", "skillId");

-- AddForeignKey
ALTER TABLE "PlayerInternalRating" ADD CONSTRAINT "PlayerInternalRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInternalRating" ADD CONSTRAINT "PlayerInternalRating_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInternalRatingEvent" ADD CONSTRAINT "PlayerInternalRatingEvent_userId_skillId_fkey" FOREIGN KEY ("userId", "skillId") REFERENCES "PlayerInternalRating"("userId", "skillId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInternalRatingEvent" ADD CONSTRAINT "PlayerInternalRatingEvent_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfAssessmentRatingEvent" ADD CONSTRAINT "SelfAssessmentRatingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfAssessmentRatingEvent" ADD CONSTRAINT "SelfAssessmentRatingEvent_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfAssessmentRatingEvent" ADD CONSTRAINT "SelfAssessmentRatingEvent_selfAssessmentId_fkey" FOREIGN KEY ("selfAssessmentId") REFERENCES "SelfAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRatingContribution" ADD CONSTRAINT "InternalRatingContribution_userId_skillId_fkey" FOREIGN KEY ("userId", "skillId") REFERENCES "PlayerInternalRating"("userId", "skillId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRatingContribution" ADD CONSTRAINT "InternalRatingContribution_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRatingContribution" ADD CONSTRAINT "InternalRatingContribution_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "PlayerInternalRating" ADD CONSTRAINT "internal_rating_bounds" CHECK (
 "initialRating" BETWEEN 1 AND 5 AND "currentRating" BETWEEN 1 AND 5 AND "feedbackCount" >= 0 AND revision >= 1);
ALTER TABLE "PlayerInternalRatingEvent" ADD CONSTRAINT "internal_event_bounds" CHECK (
 "previousRating" BETWEEN 1 AND 5 AND "newRating" BETWEEN 1 AND 5 AND
 delta = "newRating" - "previousRating" AND ("submittedRating" IS NULL OR "submittedRating" BETWEEN 1 AND 5) AND
 ("finalRate" IS NULL OR "finalRate" BETWEEN 0 AND 1) AND (confidence IS NULL OR confidence BETWEEN 0 AND 1));
ALTER TABLE "SelfAssessmentRatingEvent" ADD CONSTRAINT "self_event_bounds" CHECK (
 "newRating" BETWEEN 1 AND 5 AND ("previousRating" IS NULL OR "previousRating" BETWEEN 1 AND 5));
ALTER TABLE "InternalRatingContribution" ADD CONSTRAINT "contribution_bounds" CHECK (
 "submittedRating" BETWEEN 1 AND 5 AND "rawWeight" BETWEEN 1 AND 100 AND confidence BETWEEN 0 AND 1 AND
 "effectiveRate" BETWEEN 0 AND 1 AND "finalRate" BETWEEN 0 AND 1 AND
 ("reviewerInternalRating" IS NULL OR "reviewerInternalRating" BETWEEN 1 AND 5) AND
 ("reviewerId" IS NULL OR "reviewerId" <> "userId"));

CREATE FUNCTION reject_rating_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Rating history is immutable'; END $$;
CREATE TRIGGER internal_event_immutable BEFORE UPDATE OR DELETE ON "PlayerInternalRatingEvent"
 FOR EACH ROW EXECUTE FUNCTION reject_rating_history_mutation();
CREATE TRIGGER self_event_immutable BEFORE UPDATE OR DELETE ON "SelfAssessmentRatingEvent"
 FOR EACH ROW EXECUTE FUNCTION reject_rating_history_mutation();

CREATE FUNCTION protect_internal_contribution_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."reviewerId",NEW."reviewerInternalRating",NEW."rawWeight",NEW.confidence,NEW."effectiveRate",NEW."finalRate",NEW."algorithmVersion",NEW."identityKey",NEW."effectiveAt",NEW."userId",NEW."skillId",NEW."feedbackId",NEW.sequence)
 IS DISTINCT FROM ROW(OLD."reviewerId",OLD."reviewerInternalRating",OLD."rawWeight",OLD.confidence,OLD."effectiveRate",OLD."finalRate",OLD."algorithmVersion",OLD."identityKey",OLD."effectiveAt",OLD."userId",OLD."skillId",OLD."feedbackId",OLD.sequence)
 THEN RAISE EXCEPTION 'Reviewer influence snapshots are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contribution_snapshot_immutable BEFORE UPDATE ON "InternalRatingContribution"
 FOR EACH ROW EXECUTE FUNCTION protect_internal_contribution_snapshot();

-- Covers signup, assessment edits and trusted imports, including optional demo seeds.
-- Existing data is deliberately NOT backfilled by this migration.
CREATE FUNCTION record_self_rating_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; internal_id uuid; baseline integer; has_history boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(73011421);
 SELECT "userId" INTO STRICT owner_id FROM "SelfAssessment" WHERE id=NEW."selfAssessmentId";
 baseline := CASE WHEN TG_OP='UPDATE' THEN OLD.rating ELSE NEW.rating END;
 SELECT EXISTS(SELECT 1 FROM "SelfAssessmentRatingEvent" WHERE "selfAssessmentId"=NEW."selfAssessmentId" AND "skillId"=NEW."skillId") INTO has_history;
 IF NOT has_history AND TG_OP='UPDATE' THEN
  INSERT INTO "SelfAssessmentRatingEvent" (id,"userId","skillId","selfAssessmentId","newRating",type)
  VALUES(gen_random_uuid(),owner_id,NEW."skillId",NEW."selfAssessmentId",baseline,'BASELINE');
 END IF;
 INSERT INTO "PlayerInternalRating" (id,"userId","skillId","initialRating","currentRating","updatedAt")
 VALUES(gen_random_uuid(),owner_id,NEW."skillId",baseline,baseline,timezone('UTC', clock_timestamp()))
 ON CONFLICT ("userId","skillId") DO NOTHING RETURNING id INTO internal_id;
 IF internal_id IS NOT NULL THEN
  INSERT INTO "PlayerInternalRatingEvent" (id,"userId","skillId","sourceKey",type,"previousRating","newRating",delta,"effectiveAt")
  VALUES(gen_random_uuid(),owner_id,NEW."skillId",'init:'||owner_id||':'||NEW."skillId",'INITIALIZED',baseline,baseline,0,timezone('UTC', clock_timestamp()));
 END IF;
 IF TG_OP='INSERT' OR NEW.rating IS DISTINCT FROM OLD.rating THEN
  INSERT INTO "SelfAssessmentRatingEvent" (id,"userId","skillId","selfAssessmentId","previousRating","newRating",type)
  VALUES(gen_random_uuid(),owner_id,NEW."skillId",NEW."selfAssessmentId",
         CASE WHEN TG_OP='UPDATE' THEN OLD.rating ELSE NULL END,NEW.rating,
         CASE WHEN TG_OP='UPDATE' THEN 'UPDATED'::"SelfRatingEventType" ELSE 'CREATED'::"SelfRatingEventType" END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER self_rating_history AFTER INSERT OR UPDATE ON "SelfAssessmentRating"
 FOR EACH ROW EXECUTE FUNCTION record_self_rating_change();

-- Application time, not transaction-start time, remains ordered after lock waits.
ALTER TABLE "PlayerInternalRating" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC', clock_timestamp());
ALTER TABLE "PlayerInternalRatingEvent" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC', clock_timestamp());
ALTER TABLE "SelfAssessmentRatingEvent" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC', clock_timestamp());
ALTER TABLE "InternalRatingContribution" ALTER COLUMN "createdAt" SET DEFAULT timezone('UTC', clock_timestamp()),
 ALTER COLUMN "effectiveAt" SET DEFAULT timezone('UTC', clock_timestamp());
ALTER TABLE "PlayerInternalRatingEvent" ADD CONSTRAINT "initialized_event_zero" CHECK
 (type <> 'INITIALIZED' OR (delta=0 AND "previousRating"="newRating" AND "feedbackId" IS NULL AND "submittedRating" IS NULL));
ALTER TABLE "SelfAssessmentRatingEvent" ADD CONSTRAINT "self_event_transition" CHECK
 ((type='UPDATED' AND "previousRating" IS NOT NULL AND "previousRating"<>"newRating") OR (type IN ('CREATED','BASELINE') AND "previousRating" IS NULL));
CREATE TRIGGER contribution_no_delete BEFORE DELETE ON "InternalRatingContribution"
 FOR EACH ROW EXECUTE FUNCTION reject_rating_history_mutation();
