BEGIN;
CREATE TYPE "FeedbackReviewMode" AS ENUM ('INDIVIDUAL_MATCHES', 'COMBINED_MATCHES');
ALTER TABLE "FeedbackLink" ADD COLUMN "mode" "FeedbackReviewMode" NOT NULL DEFAULT 'INDIVIDUAL_MATCHES', ADD COLUMN "lastSubmittedAt" TIMESTAMP(3);
CREATE TABLE "FeedbackRequestMatch" (
 "feedbackLinkId" UUID NOT NULL REFERENCES "FeedbackLink"("id") ON DELETE CASCADE,
 "matchId" UUID NOT NULL REFERENCES "Match"("id") ON DELETE RESTRICT,
 "displayOrder" INTEGER NOT NULL CHECK ("displayOrder" >= 0),
 PRIMARY KEY ("feedbackLinkId", "matchId"), UNIQUE ("feedbackLinkId", "displayOrder")
);
CREATE INDEX "FeedbackRequestMatch_matchId_idx" ON "FeedbackRequestMatch"("matchId");
CREATE TABLE "FeedbackMatch" (
 "feedbackId" UUID NOT NULL REFERENCES "Feedback"("id") ON DELETE CASCADE,
 "matchId" UUID NOT NULL REFERENCES "Match"("id") ON DELETE RESTRICT,
 PRIMARY KEY ("feedbackId", "matchId")
);
CREATE INDEX "FeedbackMatch_matchId_idx" ON "FeedbackMatch"("matchId");
CREATE TABLE "FeedbackSubmission" (
 "id" UUID NOT NULL PRIMARY KEY,
 "feedbackLinkId" UUID NOT NULL REFERENCES "FeedbackLink"("id") ON DELETE RESTRICT,
 "clientSubmissionId" UUID NOT NULL, "payloadHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("feedbackLinkId", "clientSubmissionId")
);
ALTER TABLE "Feedback" ADD COLUMN "submissionId" UUID REFERENCES "FeedbackSubmission"("id") ON DELETE RESTRICT;
CREATE INDEX "Feedback_submissionId_idx" ON "Feedback"("submissionId");
-- A combined review uses the junction exclusively; legacy and individual rows use matchId.
CREATE FUNCTION check_feedback_match_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fid UUID;
BEGIN
 IF TG_TABLE_NAME = 'FeedbackMatch' THEN fid := NEW."feedbackId"; ELSE fid := NEW.id; END IF;
 IF EXISTS (SELECT 1 FROM "Feedback" f JOIN "FeedbackMatch" fm ON fm."feedbackId"=f.id WHERE f.id=fid AND f."matchId" IS NOT NULL) THEN
  RAISE EXCEPTION 'Feedback cannot mix single and combined match associations';
 END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "FeedbackMatch_consistent" AFTER INSERT OR UPDATE ON "FeedbackMatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_feedback_match_consistency();
CREATE CONSTRAINT TRIGGER "Feedback_consistent_matches" AFTER INSERT OR UPDATE ON "Feedback" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_feedback_match_consistency();
COMMIT;
