-- Existing accounts retain access, without fabricating email-verification evidence.
ALTER TABLE "User" ADD COLUMN "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ALTER COLUMN "emailVerificationRequired" SET DEFAULT true;
-- Reuse the existing authentication challenge store; no duplicate token table.
ALTER TABLE "AuthEmailChallenge" ADD COLUMN "tokenHash" TEXT, ADD COLUMN "deliveryStatus" TEXT;
CREATE UNIQUE INDEX "AuthEmailChallenge_tokenHash_key" ON "AuthEmailChallenge"("tokenHash");
CREATE INDEX "AuthEmailChallenge_userId_purpose_createdAt_idx" ON "AuthEmailChallenge"("userId", "purpose", "createdAt");
ALTER TABLE "AuthEmailChallenge" DROP CONSTRAINT "auth_email_purpose";
ALTER TABLE "AuthEmailChallenge" ADD CONSTRAINT "auth_email_purpose" CHECK (purpose IN ('SIGNUP','VERIFY_ACCOUNT','PASSWORD_RESET','EMAIL_VERIFICATION_LINK','EMAIL_CHANGE_LINK'));
ALTER TABLE "AuthEmailChallenge" ADD CONSTRAINT "auth_link_token" CHECK (purpose NOT IN ('EMAIL_VERIFICATION_LINK','EMAIL_CHANGE_LINK') OR ("tokenHash" IS NOT NULL AND length("tokenHash")=64));
ALTER TABLE "AuthEmailChallenge" ADD CONSTRAINT "auth_email_delivery" CHECK ("deliveryStatus" IS NULL OR "deliveryStatus" IN ('PENDING','SENT','FAILED'));
