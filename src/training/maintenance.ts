import { PrismaService } from "../prisma/prisma.service";
import { TrainingVideoService } from "./video.service";
import { TrainingVideoJobs } from "./jobs.service";
export async function sweepTrainingVideos(
  db: PrismaService,
  videos: TrainingVideoService,
  jobs: TrainingVideoJobs,
  limit = 20,
) {
  const now = new Date();
  const players = await db.drillVideoSubmission.findMany({
    where: {
      deletedAt: null,
      OR: [
        { retentionExpiresAt: { lt: now } },
        {
          status: "PENDING_UPLOAD",
          uploadExpiresAt: { lt: new Date(Date.now() - 60000) },
        },
      ],
    },
    take: limit,
    orderBy: { id: "asc" },
  });
  for (const row of players) await videos.expireSubmission(row.id);
  const references = await db.drillReferenceVideo.findMany({
    where: {
      uploadStatus: "PENDING_UPLOAD",
      uploadExpiresAt: { lt: new Date(Date.now() - 60000) },
    },
    take: limit,
  });
  for (const row of references)
    await db.$transaction(async (tx) => {
      await tx.drillReferenceVideo.update({
        where: { id: row.id },
        data: { uploadStatus: "DELETED", status: "ARCHIVED", isPrimary: false },
      });
      await tx.videoProcessingJob.upsert({
        where: { idempotencyKey: `cleanup:ref:${row.id}` },
        create: {
          type: "CLEANUP_MEDIA",
          referenceVideoId: row.id,
          idempotencyKey: `cleanup:ref:${row.id}`,
        },
        update: {},
      });
    });
  return {
    expiredPlayers: players.length,
    abandonedReferences: references.length,
    objectsCleaned: await jobs.cleanupBatch(limit),
  };
}
