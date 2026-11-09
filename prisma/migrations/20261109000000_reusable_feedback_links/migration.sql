-- Retain invite audit fields while allowing multiple submissions per link.
ALTER TABLE "Feedback" DROP CONSTRAINT IF EXISTS "Feedback_guestInviteNonce_key";
DROP INDEX IF EXISTS "Feedback_guestInviteNonce_key";
CREATE INDEX IF NOT EXISTS "Feedback_guestInviteNonce_idx" ON "Feedback"("guestInviteNonce");
