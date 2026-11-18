BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "FeedbackRating" ALTER COLUMN "rating" SET DATA TYPE DECIMAL(3,1);

-- AlterTable
ALTER TABLE "PlayerInternalRatingEvent" ALTER COLUMN "submittedRating" SET DATA TYPE DECIMAL(3,1);

-- AlterTable
ALTER TABLE "InternalRatingContribution" ALTER COLUMN "submittedRating" SET DATA TYPE DECIMAL(3,1);


-- Existing range checks remain in place. NUMERIC(3,1) stores exact tenths;
-- API validation rejects finer inputs before PostgreSQL's typemod coercion.
-- Only derived analytical caches are invalidated; no rating contributions/events are replayed.
UPDATE "PlayerFeedbackAnalysisProfile" SET stale=true,revision=revision+1,data='{}',"invalidatedAt"=CURRENT_TIMESTAMP;
COMMIT;
