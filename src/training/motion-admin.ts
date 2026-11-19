import { BadRequestException, Injectable } from "@nestjs/common";
import {
  TrainingVideoService,
  referenceMetadata,
  publicMedia,
} from "./video.service";
import { MotionRuntime } from "./motion-runtime";
import { motionConfigSchema, parse } from "./validation";
import { z } from "zod";
@Injectable()
export class MotionAdmin {
  constructor(
    private videos: TrainingVideoService,
    private runtime: MotionRuntime,
  ) {}
  async workspace(actor: string, id: string) {
    const v = this.videos;
    await v.access.user(actor);
    const editor = v.access.isEditor(actor);
    const drill = await v.library.drill(id, actor);
    const refs = await v.db.drillReferenceVideo.findMany({
      where: {
        drillId: id,
        ...(!editor
          ? { status: "PUBLISHED", uploadStatus: "READY_FOR_ANALYSIS" }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        poseArtifacts: { orderBy: { createdAt: "desc" }, take: 1 },
        jobs: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    const submissions = await v.db.drillVideoSubmission.findMany({
      where: { drillId: id, userId: actor, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        analyses: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            analysisVersion: true,
            createdAt: true,
            errorCode: true,
            result: true,
          },
        },
        jobs: { orderBy: { createdAt: "desc" }, take: 10 },
        poseArtifacts: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const safePose = (p: any) =>
      p
        ? {
            id: p.id,
            status: p.status,
            modelVersion: p.modelVersion,
            featureVersion: p.featureVersion,
            quality: p.quality,
            createdAt: p.createdAt,
          }
        : null;
    const safeJobs = (jobs: any[]) =>
      jobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        errorCode: j.errorCode,
        attempts: j.attempts,
      }));
    return {
      editor,
      worker: await this.runtime.status(),
      drill,
      variants: await v.db.drillTechniqueVariant.findMany({
        where: { drillId: id, ...(!editor ? { status: "PUBLISHED" } : {}) },
        orderBy: { name: "asc" },
      }),
      checkpoints: await v.db.techniqueCheckpoint.findMany({
        where: { drillId: id, ...(!editor ? { status: "PUBLISHED" } : {}) },
        orderBy: { sortOrder: "asc" },
      }),
      references: refs.map(({ poseArtifacts, jobs, ...r }) => ({
        ...referenceMetadata(r),
        pose: safePose(poseArtifacts[0]),
        jobs: editor ? safeJobs(jobs) : [],
      })),
      submissions: submissions.map(
        ({ poseArtifacts, jobs, analyses, storageKey, ...s }) => ({
          ...publicMedia(s),
          pose: safePose(poseArtifacts[0]),
          jobs: safeJobs(jobs),
          analyses: analyses.map((a) => ({
            ...a,
            result: a.result
              ? {
                  comparison: {
                    overallSimilarity:
                      (a.result as any).comparison?.overallSimilarity ?? null,
                  },
                }
              : null,
          })),
        }),
      ),
    };
  }
  async configure(actor: string, drillId: string, config: unknown) {
    await this.videos.access.editor(actor);
    const parsed = parse(motionConfigSchema, config);
    await this.videos.library.write((tx) =>
      tx.drill.update({
        where: { id: drillId },
        data: { motionConfig: parsed },
      }),
    );
    return true;
  }
  async configureReference(actor: string, id: string, input: unknown) {
    const v = this.videos;
    await v.access.editor(actor);
    const data = parse(
      z
        .object({
          checkpointIds: z.array(z.string().uuid()).max(100),
          acknowledge: z.boolean(),
        })
        .strict(),
      input,
    );
    return v.library.write(async (tx) => {
      const ref = await tx.drillReferenceVideo.findUniqueOrThrow({
        where: { id },
      });
      if (
        (await tx.techniqueCheckpoint.count({
          where: {
            id: { in: [...new Set(data.checkpointIds)] },
            drillId: ref.drillId,
            OR: [
              { techniqueVariantId: null },
              { techniqueVariantId: ref.techniqueVariantId },
            ],
          },
        })) !== new Set(data.checkpointIds).size
      )
        throw new BadRequestException(
          "Checkpoints must belong to the reference drill and variant",
        );
      if (
        data.acknowledge &&
        (!ref.poseArtifactKey || ref.uploadStatus !== "READY_FOR_ANALYSIS")
      )
        throw new BadRequestException(
          "Wait for successful extraction before acknowledging quality",
        );
      if (
        ref.status === "PUBLISHED" &&
        (!data.acknowledge || !data.checkpointIds.length)
      )
        throw new BadRequestException(
          "Archive published reference before removing coverage or acknowledgement",
        );
      await tx.drillReferenceVideo.update({
        where: { id },
        data: {
          checkpointIds: [...new Set(data.checkpointIds)],
          qualityAcknowledgedAt: data.acknowledge ? new Date() : null,
        },
      });
      return true;
    });
  }
  async retry(actor: string, id: string, reference: boolean) {
    const v = this.videos;
    if (reference) await v.access.editor(actor);
    else await v.submission(actor, id);
    return v.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const source = reference
        ? await tx.drillReferenceVideo.findUniqueOrThrow({ where: { id } })
        : await tx.drillVideoSubmission.findUniqueOrThrow({ where: { id } });
      if (
        ("uploadStatus" in source && source.uploadStatus === "DELETED") ||
        ("deletedAt" in source && source.deletedAt)
      )
        throw new BadRequestException("Source deleted");
      if (reference && source.status === "PUBLISHED")
        throw new BadRequestException(
          "Archive reference before reprocessing; historical analyses retain their original artifacts",
        );
      const active = await tx.videoProcessingJob.count({
        where: {
          ...(reference ? { referenceVideoId: id } : { submissionId: id }),
          status: { in: ["PENDING", "PROCESSING"] },
          type: { not: "CLEANUP_MEDIA" },
        },
      });
      if (active)
        throw new BadRequestException("Processing already in progress");
      await tx.videoProcessingJob.updateMany({
        where: {
          ...(reference ? { referenceVideoId: id } : { submissionId: id }),
          type: {
            in: [
              "VALIDATE_VIDEO",
              "EXTRACT_REFERENCE_POSE",
              "EXTRACT_PLAYER_POSE",
            ],
          },
        },
        data: {
          status: "PENDING",
          attempts: 0,
          errorCode: null,
          runAfter: new Date(),
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (reference)
        await tx.drillReferenceVideo.update({
          where: { id },
          data: {
            uploadStatus: "VALIDATION_PENDING",
            qualityAcknowledgedAt: null,
          },
        });
      else
        await tx.drillVideoSubmission.update({
          where: { id },
          data: { status: "VALIDATION_PENDING" },
        });
      return true;
    });
  }
  async removeReference(actor: string, id: string) {
    const v = this.videos;
    await v.access.editor(actor);
    return v.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const ref = await tx.drillReferenceVideo.findUniqueOrThrow({
        where: { id },
      });
      if (
        (await tx.videoAnalysisReference.count({
          where: { referenceVideoId: id },
        })) ||
        (await tx.drillVideoSubmission.count({
          where: { referenceVideoId: id },
        }))
      )
        throw new BadRequestException(
          "Referenced video must be archived to preserve analysis history",
        );
      await tx.drillReferenceVideo.update({
        where: { id },
        data: {
          status: "ARCHIVED",
          uploadStatus: "DELETED",
          isPrimary: false,
          poseArtifactKey: null,
        },
      });
      await tx.videoProcessingJob.updateMany({
        where: {
          referenceVideoId: id,
          status: { in: ["PENDING", "PROCESSING", "UNAVAILABLE"] },
        },
        data: { status: "CANCELLED", leaseToken: null, leaseUntil: null },
      });
      await tx.videoProcessingJob.upsert({
        where: { idempotencyKey: `cleanup:ref:${id}` },
        create: {
          referenceVideoId: id,
          type: "CLEANUP_MEDIA",
          idempotencyKey: `cleanup:ref:${id}`,
          runAfter: new Date(
            Math.max(Date.now(), ref.uploadExpiresAt.getTime() + 1000),
          ),
        },
        update: { status: "PENDING", attempts: 0 },
      });
      return true;
    });
  }
}
