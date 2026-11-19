import { Injectable, BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, VideoJobType } from "@prisma/client";
import { parse } from "./validation";
import { PrismaService } from "../prisma/prisma.service";
import { S3VideoStorage, trainingLimit } from "./storage";
import {
  techniqueResultSchema,
  VideoMetadata,
  SelectedReference,
} from "./analysis.contracts";
@Injectable()
export class TrainingVideoJobs {
  constructor(
    private db: PrismaService,
    private storage: S3VideoStorage,
  ) {}
  // Only a trusted backend worker calls these methods. They are deliberately absent from GraphQL.
  async claim(type: VideoJobType) {
    const token = randomUUID();
    await this.db.$transaction(async (tx) => {
      const exhausted = await tx.$queryRaw<
        {
          analysisId: string | null;
          submissionId: string | null;
          referenceVideoId: string | null;
        }[]
      >`UPDATE "VideoProcessingJob" SET status='FAILED',"errorCode"='RETRIES_EXHAUSTED',"leaseToken"=NULL,"leaseUntil"=NULL
      WHERE type=${type}::"VideoJobType" AND attempts>="maxAttempts" AND (status='PENDING' OR (status='PROCESSING' AND "leaseUntil"<CURRENT_TIMESTAMP)) RETURNING "analysisId","submissionId","referenceVideoId"`;
      for (const row of exhausted) {
        if (row.referenceVideoId && type !== "CLEANUP_MEDIA")
          await tx.drillReferenceVideo.updateMany({
            where: {
              id: row.referenceVideoId,
              uploadStatus: { not: "DELETED" },
            },
            data: { uploadStatus: "FAILED" },
          });
        if (row.analysisId)
          await tx.videoAnalysis.updateMany({
            where: { id: row.analysisId, status: { not: "DELETED" } },
            data: {
              status: "FAILED",
              errorCode: "RETRIES_EXHAUSTED",
              completedAt: new Date(),
            },
          });
        if (row.submissionId && type !== "CLEANUP_MEDIA")
          await tx.drillVideoSubmission.updateMany({
            where: { id: row.submissionId, deletedAt: null },
            data: { status: "FAILED" },
          });
      }
    });
    const [job] = await this.db.$queryRaw<
      any[]
    >`UPDATE "VideoProcessingJob" j SET status='PROCESSING',attempts=attempts+1,"leaseToken"=${token}::uuid,"leaseUntil"=CURRENT_TIMESTAMP+interval '5 minutes',"updatedAt"=CURRENT_TIMESTAMP WHERE j.id=(SELECT id FROM "VideoProcessingJob" WHERE type=${type}::"VideoJobType" AND attempts<"maxAttempts" AND "runAfter"<=CURRENT_TIMESTAMP AND (status='PENDING' OR (status='PROCESSING' AND "leaseUntil"<CURRENT_TIMESTAMP)) ORDER BY "runAfter",id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING j.*`;
    if (job?.analysisId) {
      await this.db.videoAnalysis.updateMany({
        where: { id: job.analysisId, status: "PENDING" },
        data: { status: "ANALYZING", startedAt: new Date() },
      });
      if (job.submissionId)
        await this.db.drillVideoSubmission.updateMany({
          where: {
            id: job.submissionId,
            deletedAt: null,
            status: "ANALYSIS_PENDING",
          },
          data: { status: "ANALYZING" },
        });
    }
    return job ?? null;
  }
  async fail(id: string, token: string, unavailable = false) {
    await this.db.videoProcessingJob.updateMany({
      where: {
        id,
        leaseToken: token,
        status: "PROCESSING",
        leaseUntil: { gt: new Date() },
      },
      data: {
        status: unavailable ? "UNAVAILABLE" : "PENDING",
        errorCode: unavailable ? "PROVIDER_UNAVAILABLE" : "PROCESSING_FAILED",
        runAfter: new Date(Date.now() + 60000),
        leaseToken: null,
        leaseUntil: null,
      },
    });
  }
  async completeValidation(
    jobId: string,
    token: string,
    metadata: VideoMetadata,
    poseRequired = false,
  ) {
    if (
      !Number.isInteger(metadata.durationMs) ||
      metadata.durationMs < 1 ||
      metadata.durationMs >
        trainingLimit("TRAINING_MAX_VIDEO_DURATION_MS", 180000, 1000, 600000) ||
      !Number.isInteger(metadata.width) ||
      metadata.width < 1 ||
      metadata.width > 7680 ||
      !Number.isInteger(metadata.height) ||
      metadata.height < 1 ||
      metadata.height > 7680 ||
      !Number.isFinite(metadata.frameRate) ||
      metadata.frameRate <= 0 ||
      metadata.frameRate > 240
    )
      throw new BadRequestException("Unsupported probed media");
    return this.db.$transaction(async (tx) => {
      const j = await tx.videoProcessingJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      const sourceId = j.submissionId ?? j.referenceVideoId;
      if (!sourceId) throw new BadRequestException("Missing source");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceId}))`;
      const [live] = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "VideoProcessingJob" WHERE id=${jobId}::uuid AND type='VALIDATE_VIDEO' AND status='PROCESSING' AND "leaseToken"=${token}::uuid AND "leaseUntil">CURRENT_TIMESTAMP FOR UPDATE`;
      if (!live) throw new BadRequestException("Validation lease expired");
      const row = j.submissionId
        ? await tx.drillVideoSubmission.findUniqueOrThrow({
            where: { id: j.submissionId },
          })
        : await tx.drillReferenceVideo.findUniqueOrThrow({
            where: { id: j.referenceVideoId! },
          });
      if (
        ("deletedAt" in row && row.deletedAt) ||
        metadata.bytes !== Number(row.fileSizeBytes) ||
        metadata.mimeType !== row.mimeType
      )
        throw new BadRequestException(
          "Validation source changed or metadata mismatch",
        );
      const data = {
        durationMs: metadata.durationMs,
        width: metadata.width,
        height: metadata.height,
        frameRate: metadata.frameRate,
      };
      if (j.submissionId)
        await tx.drillVideoSubmission.update({
          where: { id: j.submissionId },
          data: {
            ...data,
            status: poseRequired ? "VALIDATION_PENDING" : "READY_FOR_ANALYSIS",
          },
        });
      else
        await tx.drillReferenceVideo.update({
          where: { id: j.referenceVideoId! },
          data: {
            ...data,
            uploadStatus: poseRequired
              ? "VALIDATION_PENDING"
              : "READY_FOR_ANALYSIS",
          },
        });
      if (poseRequired)
        await tx.videoProcessingJob.upsert({
          where: { idempotencyKey: `pose:${sourceId}:v1` },
          create: {
            type: j.submissionId
              ? "EXTRACT_PLAYER_POSE"
              : "EXTRACT_REFERENCE_POSE",
            submissionId: j.submissionId,
            referenceVideoId: j.referenceVideoId,
            idempotencyKey: `pose:${sourceId}:v1`,
          },
          update: {},
        });
      await tx.videoProcessingJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          leaseToken: null,
          leaseUntil: null,
          errorCode: null,
        },
      });
    });
  }
  async attachReferences(analysisId: string, references: SelectedReference[]) {
    if (
      !references.length ||
      references.length > 10 ||
      new Set(references.map((r) => r.id)).size !== references.length
    )
      throw new BadRequestException("Select compatible references");
    return this.db.$transaction(async (tx) => {
      const scope = await tx.videoAnalysis.findUniqueOrThrow({
        where: { id: analysisId },
        select: { submissionId: true },
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.submissionId}))`;
      await tx.$queryRaw`SELECT id FROM "VideoAnalysis" WHERE id=${analysisId}::uuid FOR UPDATE`;
      const analysis = await tx.videoAnalysis.findUniqueOrThrow({
        where: { id: analysisId },
        include: { submission: true, references: true },
      });
      if (
        analysis.submission.deletedAt ||
        analysis.status === "COMPLETED" ||
        analysis.references.length
      )
        throw new BadRequestException(
          "Analysis provenance is immutable once selected",
        );
      for (const r of references) {
        const ref = await tx.drillReferenceVideo.findFirst({
          where: {
            id: r.id,
            referenceVersion: r.referenceVersion,
            storageKey: r.storageKey,
            drillId: analysis.submission.drillId,
            status: "PUBLISHED",
            uploadStatus: "READY_FOR_ANALYSIS",
            techniqueVariantId: analysis.submission.techniqueVariantId,
            cameraAngle: analysis.submission.cameraAngle,
          },
        });
        if (!ref) throw new BadRequestException("Incompatible reference");
      }
      await tx.videoAnalysisReference.createMany({
        data: references.map((r) => ({
          analysisId,
          referenceVideoId: r.id,
          referenceVersion: r.referenceVersion,
          storageKeySnapshot: r.storageKey,
          selectionReason: r.reason.slice(0, 500),
          poseArtifactId: (r as any).poseArtifactId,
          checkpointIdsSnapshot: (r as any).checkpointIds ?? [],
          mirrored: (r as any).mirrored ?? false,
        })),
      });
    });
  }
  async completeAnalysis(
    jobId: string,
    token: string,
    result: unknown,
    versions: { poseModelVersion: string; comparisonAlgorithmVersion: string },
  ) {
    if (
      !versions ||
      !versions.poseModelVersion ||
      !versions.comparisonAlgorithmVersion ||
      versions.poseModelVersion.length > 100 ||
      versions.comparisonAlgorithmVersion.length > 100
    )
      throw new BadRequestException(
        "Actual processing model versions required",
      );
    const parsed = parse(techniqueResultSchema, result);
    return this.db.$transaction(async (tx) => {
      const job = await tx.videoProcessingJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      if (!job.submissionId || !job.analysisId)
        throw new BadRequestException("Missing analysis scope");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${job.submissionId}))`;
      const [lease] = await tx.$queryRaw<
        any[]
      >`SELECT id FROM "VideoProcessingJob" WHERE id=${jobId}::uuid AND type='COMPARE_TECHNIQUE' AND status='PROCESSING' AND "leaseToken"=${token}::uuid AND "leaseUntil">CURRENT_TIMESTAMP FOR UPDATE`;
      if (!lease) throw new BadRequestException("Analysis lease expired");
      const analysis = await tx.videoAnalysis.findUniqueOrThrow({
        where: { id: job.analysisId },
        include: { submission: true, references: true },
      });
      if (
        analysis.status !== "ANALYZING" ||
        !(await tx.videoProcessingJob.findFirst({
          where: {
            submissionId: analysis.submissionId,
            type: "VALIDATE_VIDEO",
            status: "COMPLETED",
          },
        }))
      )
        throw new BadRequestException("Validated active analysis required");
      const suggestedSkills = [
        ...new Set([
          ...parsed.suggestedSkillIds,
          ...parsed.observations.flatMap((o) => (o.skillId ? [o.skillId] : [])),
        ]),
      ];
      if (
        (await tx.skillTreeNode.count({
          where: { id: { in: suggestedSkills }, status: "PUBLISHED" },
        })) !== suggestedSkills.length ||
        (await tx.drill.count({
          where: {
            id: { in: [...new Set(parsed.suggestedDrillIds)] },
            status: "PUBLISHED",
          },
        })) !== new Set(parsed.suggestedDrillIds).size
      )
        throw new BadRequestException(
          "Suggestions must reference published curated content",
        );
      const checkpoints = analysis.checkpointSnapshot as { id: string }[];
      if (
        new Set(parsed.checkpoints.map((c) => c.id)).size !==
          parsed.checkpoints.length ||
        parsed.observations.some(
          (o) =>
            o.checkpointId && !checkpoints.some((c) => c.id === o.checkpointId),
        ) ||
        parsed.checkpoints.some(
          (c) =>
            c.status === "NOT_MEASURABLE" &&
            ((c.differences?.length ?? 0) > 0 || c.confidence !== null),
        )
      )
        throw new BadRequestException("Invalid checkpoint evidence");

      if (
        analysis.submission.deletedAt ||
        analysis.submissionId !== parsed.submissionId ||
        analysis.submission.drillId !== parsed.drillId ||
        analysis.references.length !== parsed.references.length ||
        analysis.references.some(
          (r) =>
            !parsed.references.some(
              (p) =>
                p.id === r.referenceVideoId && p.version === r.referenceVersion,
            ),
        ) ||
        parsed.checkpoints.some(
          (c) => !checkpoints.some((p) => p.id === c.id),
        ) ||
        new Set(parsed.references.map((r) => r.id)).size !==
          parsed.references.length
      )
        throw new BadRequestException("Analysis result provenance mismatch");
      if (
        parsed.checkpoints.some((c) =>
          c.evidenceTimestampsMs.some(
            (t) => t > (analysis.submission.durationMs ?? 0),
          ),
        ) ||
        parsed.observations.some((o) =>
          o.evidenceTimestampsMs.some(
            (t) => t > (analysis.submission.durationMs ?? 0),
          ),
        )
      )
        throw new BadRequestException(
          "Evidence timestamps exceed video duration",
        );
      if (parsed.comparison) {
        const c = parsed.comparison;
        const frozen = analysis.references;
        if (
          c.references.length !== frozen.length ||
          c.references.some(
            (r) =>
              !frozen.some(
                (f) =>
                  f.referenceVideoId === r.referenceVideoId &&
                  f.referenceVersion === r.referenceVersion &&
                  f.poseArtifactId === r.poseArtifactId,
              ),
          ) ||
          c.checkpoints.some(
            (cp) =>
              !checkpoints.some((p) => p.id === cp.checkpointId) ||
              (cp.status !== "EVALUATED" &&
                (cp.similarity !== null ||
                  cp.quality !== null ||
                  cp.evidence.length > 0)) ||
              cp.evidence.some(
                (e) =>
                  e.playerMs > (analysis.submission.durationMs ?? 0) ||
                  !frozen.some(
                    (r) => r.referenceVideoId === e.referenceVideoId,
                  ),
              ),
          )
        )
          throw new BadRequestException("Motion evidence provenance mismatch");
        const refRows = await tx.drillReferenceVideo.findMany({
          where: { id: { in: frozen.map((r) => r.referenceVideoId) } },
        });
        for (const cp of c.checkpoints)
          for (const ev of cp.evidence)
            if (
              ev.referenceMs >
              (refRows.find((r) => r.id === ev.referenceVideoId)?.durationMs ??
                0)
            )
              throw new BadRequestException(
                "Reference timestamp exceeds video duration",
              );
      }
      await tx.videoAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: "COMPLETED",
          result: parsed,
          confidence: parsed.confidence,
          poseModelVersion: versions.poseModelVersion,
          comparisonAlgorithmVersion: versions.comparisonAlgorithmVersion,
          completedAt: new Date(),
          errorCode: null,
        },
      });
      await tx.drillVideoSubmission.update({
        where: { id: analysis.submissionId },
        data: { status: "COMPLETED" },
      });
      await tx.videoProcessingJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          leaseToken: null,
          leaseUntil: null,
          errorCode: null,
        },
      });
    });
  }
  async allocateArtifactKey(analysisId: string) {
    return this.db.$transaction(async (tx) => {
      const a = await tx.videoAnalysis.findUniqueOrThrow({
        where: { id: analysisId },
        include: { submission: true },
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.submissionId}))`;
      if (
        (
          await tx.drillVideoSubmission.findUniqueOrThrow({
            where: { id: a.submissionId },
          })
        ).deletedAt
      )
        throw new BadRequestException("Source removed");
      const key = `training/players/${a.submission.userId}/${a.submissionId}/artifacts/${randomUUID()}`;
      await tx.videoAnalysis.update({
        where: { id: analysisId },
        data: { artifactKeys: { push: key } },
      });
      return key;
    });
  }
  async activateValidationJobs(
    provider: import("./analysis.contracts").VideoPreprocessor,
  ) {
    if (!provider.version || typeof provider.probe !== "function")
      throw new BadRequestException("Actual media preprocessor required");
    return this.db.videoProcessingJob.updateMany({
      where: { type: "VALIDATE_VIDEO", status: "UNAVAILABLE" },
      data: { status: "PENDING", errorCode: null },
    });
  }
  async cleanupBatch(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException("Cleanup batch must be 1–100");
    let done = 0;
    for (let i = 0; i < limit; i++) {
      const job = await this.claim("CLEANUP_MEDIA");
      if (!job) break;
      try {
        const source = job.submissionId
          ? await this.db.drillVideoSubmission.findUniqueOrThrow({
              where: { id: job.submissionId },
            })
          : await this.db.drillReferenceVideo.findUniqueOrThrow({
              where: { id: job.referenceVideoId },
            });
        if (
          ("deletedAt" in source &&
            !source.deletedAt &&
            source.status !== "FAILED") ||
          ("uploadStatus" in source &&
            !["FAILED", "DELETED"].includes(source.uploadStatus))
        )
          throw new Error("Cleanup source is not removed");
        if (job.submissionId) {
          const analyses = await this.db.videoAnalysis.findMany({
            where: { submissionId: job.submissionId },
          });
          for (const a of analyses)
            for (const key of a.artifactKeys) {
              if (
                !key.startsWith(
                  `training/players/${(source as any).userId}/${source.id}/artifacts/`,
                )
              )
                throw new Error("Invalid artifact scope");
              await this.storage.delete(key);
            }
          await this.db.videoAnalysis.updateMany({
            where: { submissionId: job.submissionId },
            data: { artifactKeys: [] },
          });
        }
        const poses = await this.db.videoPoseArtifact.findMany({
          where: job.submissionId
            ? { submissionId: job.submissionId }
            : { referenceVideoId: job.referenceVideoId },
        });
        for (const pose of poses) {
          await this.storage.delete(pose.storageKey);
          await this.db.videoPoseArtifact.update({
            where: { id: pose.id },
            data: { status: "DELETED" },
          });
        }
        await this.storage.delete(source.storageKey);
        await this.db.videoProcessingJob.updateMany({
          where: {
            id: job.id,
            leaseToken: job.leaseToken,
            status: "PROCESSING",
          },
          data: {
            status: "COMPLETED",
            leaseToken: null,
            leaseUntil: null,
            errorCode: null,
          },
        });
        done++;
      } catch {
        await this.fail(job.id, job.leaseToken);
      }
    }
    return done;
  }
}
@Injectable()
export class TrainingReferenceSelection {
  constructor(private db: PrismaService) {}
  async select(input: {
    drillId: string;
    variantId?: string;
    cameraAngle: string;
    handedness?: string;
  }): Promise<SelectedReference[]> {
    if (input.cameraAngle === "UNKNOWN") return [];
    const refs = await this.db.drillReferenceVideo.findMany({
      where: {
        drillId: input.drillId,
        drill: { status: "PUBLISHED" },
        techniqueVariantId: input.variantId ?? null,
        cameraAngle: input.cameraAngle,
        status: "PUBLISHED",
        uploadStatus: "READY_FOR_ANALYSIS",
        ...(input.handedness
          ? {
              OR: [
                { handedness: null },
                { handedness: input.handedness },
                { handedness: "BOTH" },
              ],
            }
          : {}),
      },
      orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
      take: 5,
    });
    return refs.map((r) => ({
      id: r.id,
      referenceVersion: r.referenceVersion,
      storageKey: r.storageKey,
      reason:
        "Same drill, explicit variant and camera angle; handedness filter applied when known. No biomechanical equivalence is inferred.",
    }));
  }
}
