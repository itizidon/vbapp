BEGIN;
-- Assigned feedback can originate from a validated link or an authenticated preparer.
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_identity_check";
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_identity_check" CHECK (
  ("approvalRequired" AND "reviewerId" IS NOT NULL
    AND ("feedbackLinkId" IS NOT NULL OR "submittedById" IS NOT NULL))
  OR (NOT "approvalRequired" AND (
    ("reviewerId" IS NOT NULL AND "guestName" IS NULL)
    OR ("reviewerId" IS NULL AND NULLIF(BTRIM("guestName"),'') IS NOT NULL)
  ))
);
COMMIT;
