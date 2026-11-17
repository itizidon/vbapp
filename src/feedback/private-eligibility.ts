import { PrismaClient, Prisma } from "@prisma/client";
import { PRIVACY_NOTICE_VERSION } from "./privacy";
// The basic private charts use numerical-only permission; AI profiles/tools use the stricter SQL AI view.
export function privateAnalyticsWhere(
  db: PrismaClient,
  recipientId: string,
): Prisma.FeedbackWhereInput {
  return {
    recipientId,
    status: "PUBLISHED",
    privateAnalyticsAllowed: true,
    privateAnalyticsConsentAt: { not: null },
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    sport: { slug: { in: ["volleyball", "beach-volleyball"] } },
    AND: [
      {
        OR: [
          { approvalRequired: false },
          {
            approvedAt: { not: null },
            approvedById: { equals: db.feedback.fields.reviewerId },
          },
        ],
      },
      {
        OR: [
          { analysisJob: null },
          { analysisJob: { moderation: { in: ["UNASSESSED", "ALLOW"] } } },
        ],
      },
    ],
  };
}
