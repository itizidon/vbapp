BEGIN;

-- AlterEnum
ALTER TYPE "FeedbackStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "feedbackLinkId" UUID,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" UUID,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "submittedById" UUID;

-- CreateTable
CREATE TABLE "FeedbackLink" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "assignedReviewerId" UUID,
    "sportId" UUID NOT NULL,
    "matchId" UUID,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackLink_tokenHash_key" ON "FeedbackLink"("tokenHash");

-- CreateIndex
CREATE INDEX "FeedbackLink_recipientId_createdAt_idx" ON "FeedbackLink"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackLink_assignedReviewerId_idx" ON "FeedbackLink"("assignedReviewerId");

-- CreateIndex
CREATE INDEX "Feedback_reviewerId_approvalRequired_status_createdAt_id_idx" ON "Feedback"("reviewerId", "approvalRequired", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Feedback_feedbackLinkId_idx" ON "Feedback"("feedbackLinkId");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_feedbackLinkId_fkey" FOREIGN KEY ("feedbackLinkId") REFERENCES "FeedbackLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackLink" ADD CONSTRAINT "FeedbackLink_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackLink" ADD CONSTRAINT "FeedbackLink_assignedReviewerId_fkey" FOREIGN KEY ("assignedReviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackLink" ADD CONSTRAINT "FeedbackLink_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackLink" ADD CONSTRAINT "FeedbackLink_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Assigned drafts retain both the designated reviewer and the preparer's guest name.
-- Preserve the original identity rule for every pre-existing/unassigned record.
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_identity_check";
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_identity_check" CHECK (
  ("approvalRequired" AND "feedbackLinkId" IS NOT NULL AND "reviewerId" IS NOT NULL)
  OR (NOT "approvalRequired" AND (
    ("reviewerId" IS NOT NULL AND "guestName" IS NULL)
    OR ("reviewerId" IS NULL AND NULLIF(BTRIM("guestName"),'') IS NOT NULL)
  ))
);
ALTER TABLE "FeedbackLink" ADD CONSTRAINT "FeedbackLink_no_self_assignment"
CHECK ("assignedReviewerId" IS NULL OR "assignedReviewerId" <> "recipientId");
COMMIT;
