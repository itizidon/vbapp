import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ClerkUserService } from "./users";
import { isClerkUserId } from "./metadata";
import { ratingTransaction } from "../../internal-ratings/transaction";
@Injectable()
export class ClerkDeletionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    readonly db: PrismaService,
    readonly users: ClerkUserService,
  ) {}
  onModuleInit() {
    if (process.env.CLERK_DELETION_WORKER_ENABLED === "true") {
      this.timer = setInterval(() => {
        if (!this.running) {
          this.running = true;
          void this.processOne()
            .catch(() => {})
            .finally(() => {
              this.running = false;
            });
        }
      }, 5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async enqueue(eventId: string, userId: string) {
    if (!isClerkUserId(userId) || !eventId || eventId.length > 255)
      throw new Error("Invalid deletion event");
    this.users.invalidate(userId);
    await this.db.clerkDeletionJob.upsert({
      where: { id: eventId },
      create: { id: eventId, userId },
      update: {},
    });
  }
  async processOne() {
    const lease = randomUUID();
    const rows = await this.db.$queryRaw<
      { id: string; userId: string }[]
    >`UPDATE "ClerkDeletionJob" SET status='PROCESSING',attempts=attempts+1,"leaseToken"=${lease}::uuid,"leaseUntil"=now()+interval '5 minutes',"updatedAt"=now() WHERE id=(SELECT id FROM "ClerkDeletionJob" WHERE attempts<10 AND (status IN ('PENDING','FAILED') OR (status='PROCESSING' AND "leaseUntil"<now())) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,"userId"`;
    const job = rows[0];
    if (!job) return false;
    try {
      await this.anonymize(job.id, job.userId, lease);
      return true;
    } catch {
      await this.db.clerkDeletionJob.updateMany({
        where: { id: job.id, leaseToken: lease },
        data: {
          status: "FAILED",
          leaseToken: null,
          leaseUntil: null,
          errorCode: "CLEANUP_RETRY_REQUIRED",
        },
      });
      return true;
    }
  }
  private async anonymize(eventId: string, subject: string, lease: string) {
    const anonymous =
      "deleted_" + createHash("sha256").update(eventId).digest("hex");
    await ratingTransaction(this.db, async (tx) => {
      const claimed = await tx.clerkDeletionJob.findFirst({
        where: {
          id: eventId,
          leaseToken: lease,
          status: "PROCESSING",
          leaseUntil: { gt: new Date() },
        },
      });
      if (!claimed) return;
      await tx.$executeRaw`SELECT set_config('app.clerk_deletion_subject',${subject},true),set_config('app.clerk_deletion_anonymous',${anonymous},true)`;
      const submissions = await tx.drillVideoSubmission.findMany({
        where: { userId: subject },
        include: { analyses: true, poseArtifacts: true },
      });
      for (const s of submissions) {
        const keys = [
          ...new Set([
            s.storageKey,
            ...s.poseArtifacts.map((p) => p.storageKey),
            ...s.analyses.flatMap((a) => a.artifactKeys),
          ]),
        ];
        if (keys.some((key) => !key.startsWith(`training/players/${subject}/`)))
          throw Error("Private media scope mismatch");
        await tx.videoProcessingJob.upsert({
          where: { idempotencyKey: `clerk-deletion:${eventId}:${s.id}` },
          create: {
            type: "CLEANUP_MEDIA",
            idempotencyKey: `clerk-deletion:${eventId}:${s.id}`,
            payload: { clerkDeletionCleanup: true, ownerId: subject, keys },
          },
          update: {},
        });
        const analyses = s.analyses.map((a) => a.id);
        await tx.videoProcessingJob.deleteMany({
          where: {
            OR: [{ submissionId: s.id }, { analysisId: { in: analyses } }],
          },
        });
        await tx.videoAnalysisReference.deleteMany({
          where: { analysisId: { in: analyses } },
        });
        await tx.videoAnalysis.deleteMany({ where: { submissionId: s.id } });
        await tx.videoPoseArtifact.deleteMany({
          where: { submissionId: s.id },
        });
        await tx.drillVideoSubmission.delete({ where: { id: s.id } });
      }
      await tx.drillCompletion.deleteMany({ where: { userId: subject } });
      await tx.playerSkillProgress.deleteMany({ where: { userId: subject } });
      await tx.aiCoachConversation.deleteMany({ where: { userId: subject } });
      await tx.aiCoachUsage.deleteMany({ where: { userId: subject } });
      await tx.playerFeedbackAnalysisProfile.deleteMany({
        where: { userId: subject },
      });
      await tx.playerInternalRatingEvent.deleteMany({
        where: { userId: subject },
      });
      await tx.internalRatingContribution.deleteMany({
        where: { userId: subject },
      });
      await tx.playerInternalRating.deleteMany({ where: { userId: subject } });
      await tx.selfAssessmentRatingEvent.deleteMany({
        where: { userId: subject },
      });
      // Preserve other players' historical results and frozen rating inputs, with no resolvable identity.
      await tx.playerInternalRatingEvent.updateMany({
        where: { reviewerId: subject },
        data: { reviewerId: anonymous },
      });
      await tx.$executeRaw`UPDATE "InternalRatingContribution" SET "reviewerId"=${anonymous},"identityKey"=replace("identityKey",${subject},${anonymous}) WHERE "reviewerId"=${subject}`;
      const affected = await tx.feedback.findMany({
        where: { OR: [{ recipientId: subject }, { reviewerId: subject }] },
        select: { id: true },
      });
      const ids = affected.map((f) => f.id);
      await tx.feedbackRating.updateMany({
        where: { feedbackId: { in: ids } },
        data: { comment: null },
      });
      await tx.feedback.updateMany({
        where: { id: { in: ids } },
        data: { overallComment: null },
      });
      // Text scalars, never foreign keys to a user mirror; the audit-only pseudonym has no Clerk authority.
      await tx.$executeRaw`UPDATE "Feedback" SET
    "recipientId"=CASE WHEN "recipientId"=${subject} THEN ${anonymous} ELSE "recipientId" END,
    "reviewerId"=CASE WHEN "reviewerId"=${subject} THEN ${anonymous} ELSE "reviewerId" END,
    "submittedById"=CASE WHEN "submittedById"=${subject} THEN ${anonymous} ELSE "submittedById" END,
    "approvedById"=CASE WHEN "approvedById"=${subject} THEN ${anonymous} ELSE "approvedById" END,
    "rejectedById"=CASE WHEN "rejectedById"=${subject} THEN ${anonymous} ELSE "rejectedById" END
    WHERE "recipientId"=${subject} OR "reviewerId"=${subject} OR "submittedById"=${subject} OR "approvedById"=${subject} OR "rejectedById"=${subject}`;
      await tx.feedbackLink.updateMany({
        where: {
          OR: [{ recipientId: subject }, { assignedReviewerId: subject }],
        },
        data: { revokedAt: new Date(), assignedReviewerId: null },
      });
      await tx.feedbackLink.updateMany({
        where: { recipientId: subject },
        data: { recipientId: anonymous },
      });
      await tx.feedbackPrivacyEvent.updateMany({
        where: { actorId: subject },
        data: { actorId: null },
      });
      await tx.matchParticipant.updateMany({
        where: { userId: subject },
        data: { userId: null, guestName: "Deleted player" },
      });
      await tx.match.updateMany({
        where: { createdById: subject },
        data: { createdById: anonymous },
      });
      await tx.drill.updateMany({
        where: { createdById: subject },
        data: { createdById: null },
      });
      await tx.drillReferenceVideo.updateMany({
        where: { uploadedById: subject },
        data: { uploadedById: null },
      });
      // Removing the subject's private feedback observations also cascades its embeddings.
      await tx.feedbackObservation.deleteMany({
        where: { feedbackId: { in: ids } },
      });
      await tx.feedbackAnalysisJob.updateMany({
        where: { feedbackId: { in: ids } },
        data: {
          status: "SKIPPED",
          leaseToken: null,
          leaseUntil: null,
          generation: { increment: 1 },
        },
      });
      await tx.playerFeedbackAnalysisProfile.deleteMany({
        where: { userId: subject },
      });
      await tx.clerkDeletionJob.update({
        where: { id: eventId },
        data: {
          status: "COMPLETED",
          userId: null,
          leaseToken: null,
          leaseUntil: null,
          errorCode: null,
        },
      });
    });
    this.users.invalidate(subject);
  }
}
