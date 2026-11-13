BEGIN;
ALTER TABLE "FeedbackRating"
  ADD COLUMN "reviewerInternalRatingAtSubmission" DECIMAL(12,8),
  ADD COLUMN "reviewerConfidenceAtSubmission" DECIMAL(14,12),
  ADD COLUMN "reviewerRawWeightAtSubmission" DECIMAL(20,12),
  ADD COLUMN "reviewerEffectiveRateAtSubmission" DECIMAL(14,12),
  ADD COLUMN "reviewerFinalRateAtSubmission" DECIMAL(14,12),
  ADD COLUMN "reviewerAlgorithmVersionAtSubmission" INTEGER,
  ADD COLUMN "reviewerInternalSnapshotCapturedAt" TIMESTAMP(3);
ALTER TABLE "FeedbackRating" ADD CONSTRAINT "FeedbackRating_reviewer_snapshot_complete" CHECK (
  ("reviewerInternalSnapshotCapturedAt" IS NULL AND "reviewerInternalRatingAtSubmission" IS NULL AND "reviewerConfidenceAtSubmission" IS NULL AND "reviewerRawWeightAtSubmission" IS NULL AND "reviewerEffectiveRateAtSubmission" IS NULL AND "reviewerFinalRateAtSubmission" IS NULL AND "reviewerAlgorithmVersionAtSubmission" IS NULL) OR
  ("reviewerInternalSnapshotCapturedAt" IS NOT NULL AND "reviewerConfidenceAtSubmission" IS NOT NULL AND "reviewerRawWeightAtSubmission" IS NOT NULL AND "reviewerEffectiveRateAtSubmission" IS NOT NULL AND "reviewerFinalRateAtSubmission" IS NOT NULL AND "reviewerAlgorithmVersionAtSubmission" IS NOT NULL AND
   ("reviewerInternalRatingAtSubmission" IS NULL OR "reviewerInternalRatingAtSubmission" BETWEEN 1 AND 5) AND
   "reviewerConfidenceAtSubmission" BETWEEN 0 AND 1 AND
   "reviewerRawWeightAtSubmission" > 0 AND
   "reviewerEffectiveRateAtSubmission" BETWEEN 0 AND 1 AND
   "reviewerFinalRateAtSubmission" BETWEEN 0 AND 1)
);
CREATE FUNCTION protect_feedback_reviewer_weight_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD."reviewerInternalRatingAtSubmission", OLD."reviewerConfidenceAtSubmission", OLD."reviewerRawWeightAtSubmission", OLD."reviewerEffectiveRateAtSubmission", OLD."reviewerFinalRateAtSubmission", OLD."reviewerAlgorithmVersionAtSubmission", OLD."reviewerInternalSnapshotCapturedAt") IS DISTINCT FROM
     ROW(NEW."reviewerInternalRatingAtSubmission", NEW."reviewerConfidenceAtSubmission", NEW."reviewerRawWeightAtSubmission", NEW."reviewerEffectiveRateAtSubmission", NEW."reviewerFinalRateAtSubmission", NEW."reviewerAlgorithmVersionAtSubmission", NEW."reviewerInternalSnapshotCapturedAt") THEN
    RAISE EXCEPTION 'Feedback reviewer weight snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FeedbackRating_protect_reviewer_weight_snapshot"
BEFORE UPDATE ON "FeedbackRating" FOR EACH ROW
EXECUTE FUNCTION protect_feedback_reviewer_weight_snapshot();
COMMIT;
