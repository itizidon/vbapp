import { TRAINING_VIDEO_PROVIDERS, TrainingVideoProviders } from "./providers";
import {
  BadRequestException,
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { MotionRuntime, motionHash } from "./motion-runtime";
import { randomUUID } from "node:crypto";
import { isUUID } from "class-validator";
import { Prisma, VideoSubmissionStatus, VideoJobType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TrainingAccess } from "./access";
import { TrainingLibraryService } from "./library.service";
import { S3VideoStorage, trainingLimit, VideoStorage } from "./storage";
import * as D from "./dto";
export const publicMedia = <T extends { fileSizeBytes: bigint }>(row: T) => ({
  ...row,
  fileSizeBytes: Number(row.fileSizeBytes),
});
export function referenceMetadata(row: any) {
  const {
    storageKey,
    originalFilename,
    uploadedById,
    poseArtifactKey,
    ...metadata
  } = publicMedia(row);
  return metadata;
}
@Injectable()
export class TrainingVideoService {
  constructor(
    readonly db: PrismaService,
    readonly access: TrainingAccess,
    readonly library: TrainingLibraryService,
    readonly storage: S3VideoStorage,
    @Optional()
    @Inject(TRAINING_VIDEO_PROVIDERS)
    readonly processing: TrainingVideoProviders = {},
  ) {}
  private async scope(
    input: D.TrainingVideoUploadInput,
    actor: string,
    reference = false,
    tx: Prisma.TransactionClient = this.db,
  ) {
    await this.library.drill(input.drillId, reference ? actor : undefined, tx);
    if (
      input.techniqueVariantId &&
      !(await tx.drillTechniqueVariant.findFirst({
        where: {
          id: input.techniqueVariantId,
          drillId: input.drillId,
          ...(!reference ? { status: "PUBLISHED" as const } : {}),
        },
      }))
    )
      throw new BadRequestException("Variant is not available for this drill");
    if (
      input.referenceVideoId &&
      !(await tx.drillReferenceVideo.findFirst({
        where: {
          id: input.referenceVideoId,
          drillId: input.drillId,
          status: "PUBLISHED",
          uploadStatus: "READY_FOR_ANALYSIS",
          techniqueVariantId: input.techniqueVariantId ?? null,
        },
      }))
    )
      throw new BadRequestException(
        "Reference is not compatible with this drill and variant",
      );
  }
  private limits(input: D.TrainingVideoUploadInput) {
    if (
      !["video/mp4", "video/webm", "video/quicktime"].includes(
        input.mimeType,
      ) ||
      !Number.isSafeInteger(input.fileSizeBytes) ||
      input.fileSizeBytes < 1 ||
      input.fileSizeBytes >
        trainingLimit(
          "TRAINING_MAX_VIDEO_BYTES",
          100 * 1024 * 1024,
          1,
          1073741824,
        )
    )
      throw new BadRequestException("Unsupported video type or size");
    if (
      !["FRONT", "SIDE", "REAR", "OBLIQUE", "UNKNOWN"].includes(
        input.cameraAngle,
      )
    )
      throw new BadRequestException("Unsupported camera angle");
  }
  async requestUpload(actor: string, input: D.TrainingVideoUploadInput) {
    await this.access.user(actor);
    this.limits(input);
    await this.scope(input, actor);
    const id = randomUUID(),
      key = `training/players/${actor}/${id}/original`;
    const signed = await this.storage.upload(
      key,
      input.mimeType,
      input.fileSizeBytes,
    );
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor}))`;
      await this.scope(input, actor, false, tx);
      const count = await tx.drillVideoSubmission.count({
        where: { userId: actor, deletedAt: null },
      });
      if (count >= trainingLimit("TRAINING_MAX_PLAYER_VIDEOS", 30, 1, 1000))
        throw new BadRequestException("Player upload quota reached");
      await tx.drillVideoSubmission.create({
        data: {
          id,
          userId: actor,
          drillId: input.drillId,
          techniqueVariantId: input.techniqueVariantId,
          referenceVideoId: input.referenceVideoId,
          storageKey: key,
          mimeType: input.mimeType,
          fileSizeBytes: BigInt(input.fileSizeBytes),
          cameraAngle: input.cameraAngle,
          handedness: input.handedness,
          allowMirroring: input.allowMirroring ?? false,
          aiExplanationAllowed: input.aiExplanationAllowed ?? false,
          uploadExpiresAt: signed.expiresAt,
          retentionExpiresAt: new Date(
            Date.now() +
              trainingLimit("TRAINING_VIDEO_RETENTION_DAYS", 30, 1, 365) *
                86400000,
          ),
        },
      });
    });
    return { id, ...signed };
  }
  async requestReference(actor: string, input: D.ReferenceVideoUploadInput) {
    await this.access.editor(actor);
    this.limits(input);
    if (input.referenceVideoId)
      throw new BadRequestException(
        "Reference uploads cannot select a player preferred reference",
      );
    await this.scope(input, actor, true);
    const id = randomUUID(),
      key = `training/references/${input.drillId}/${id}/original`;
    const signed = await this.storage.upload(
      key,
      input.mimeType,
      input.fileSizeBytes,
    );
    await this.library.write(async (tx) => {
      await this.scope(input, actor, true, tx);
      if (
        (await tx.drillReferenceVideo.count({
          where: { drillId: input.drillId, status: { not: "ARCHIVED" } },
        })) >= trainingLimit("TRAINING_MAX_REFERENCES_PER_DRILL", 100, 1, 10000)
      )
        throw new BadRequestException("Drill reference quota reached");
      let seriesId: string = id,
        referenceVersion = 1;
      if (input.replacesReferenceId) {
        const prior = await tx.drillReferenceVideo.findUniqueOrThrow({
          where: { id: input.replacesReferenceId },
        });
        if (
          prior.drillId !== input.drillId ||
          prior.techniqueVariantId !== (input.techniqueVariantId ?? null)
        )
          throw new BadRequestException(
            "Replacement must preserve drill and variant",
          );
        seriesId = prior.seriesId;
        referenceVersion =
          (
            await tx.drillReferenceVideo.aggregate({
              where: { seriesId },
              _max: { referenceVersion: true },
            })
          )._max.referenceVersion! + 1;
      }
      await tx.drillReferenceVideo.create({
        data: {
          id,
          drillId: input.drillId,
          techniqueVariantId: input.techniqueVariantId,
          uploadedById: actor,
          title: input.title,
          description: input.description,
          originalFilename: input.originalFilename.replace(/[\\/\r\n]/g, "_"),
          storageKey: key,
          mimeType: input.mimeType,
          fileSizeBytes: BigInt(input.fileSizeBytes),
          cameraAngle: input.cameraAngle,
          handedness: input.handedness,
          uploadExpiresAt: signed.expiresAt,
          seriesId,
          referenceVersion,
        },
      });
    });
    return { id, ...signed };
  }
  async submission(actor: string, id: string, includeDeleted = false) {
    await this.access.user(actor);
    const row = await this.db.drillVideoSubmission.findFirst({
      where: {
        id,
        userId: actor,
        ...(!includeDeleted ? { deletedAt: null } : {}),
      },
    });
    if (!row) throw new NotFoundException("Private video submission not found");
    return row;
  }
  async submissions(actor: string, after?: string, limit = 20) {
    await this.access.user(actor);
    if (limit < 1 || limit > 100 || !Number.isInteger(limit))
      throw new BadRequestException("Invalid page size");
    return (
      await this.db.drillVideoSubmission.findMany({
        where: { userId: actor, deletedAt: null },
        orderBy: { id: "asc" },
        take: limit,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      })
    ).map(publicMedia);
  }
  async references(drillId: string, variantId?: string, actor?: string) {
    await this.library.drill(drillId, actor);
    return (
      await this.db.drillReferenceVideo.findMany({
        where: {
          drillId,
          ...(variantId ? { techniqueVariantId: variantId } : {}),
          ...(!(await this.access.isEditor(actor))
            ? {
                status: "PUBLISHED" as const,
                uploadStatus: "READY_FOR_ANALYSIS" as const,
              }
            : {}),
        },
        orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
        take: trainingLimit("TRAINING_MAX_REFERENCES_PER_DRILL", 100, 1, 10000),
      })
    ).map(referenceMetadata);
  }
  async finalize(actor: string, id: string, reference = false) {
    let row;
    if (reference) {
      await this.access.editor(actor);
      row = await this.db.drillReferenceVideo.findUniqueOrThrow({
        where: { id },
      });
    } else row = await this.submission(actor, id);
    if (
      row.status === "DELETED" ||
      ("uploadStatus" in row ? row.uploadStatus : row.status) === "DELETED"
    )
      throw new BadRequestException("Upload was deleted");
    const state = "uploadStatus" in row ? row.uploadStatus : row.status;
    if (state !== "PENDING_UPLOAD") {
      if (
        [
          "VALIDATION_PENDING",
          "READY_FOR_ANALYSIS",
          "ANALYSIS_UNAVAILABLE",
          "COMPLETED",
        ].includes(state)
      )
        return publicMedia(row);
      throw new BadRequestException("Invalid upload transition");
    }
    if (row.uploadExpiresAt.getTime() + 60000 < Date.now())
      throw new BadRequestException(
        "Upload authorization expired; request a new upload",
      );
    const metadata = await this.storage.head(row.storageKey);
    if (
      metadata.bytes !== Number(row.fileSizeBytes) ||
      metadata.mimeType !== row.mimeType
    ) {
      await this.rejectUpload(id, reference);
      throw new BadRequestException(
        "Uploaded object metadata does not match the authorized upload",
      );
    }
    const validatorAvailable =
      this.processing.preprocessor?.processingLocation === "LOCAL" &&
      (await new MotionRuntime(this.db).status()).available;
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const data = reference
        ? await tx.drillReferenceVideo.findUniqueOrThrow({ where: { id } })
        : await tx.drillVideoSubmission.findUniqueOrThrow({ where: { id } });
      const current = "uploadStatus" in data ? data.uploadStatus : data.status;
      if (current !== "PENDING_UPLOAD") {
        if (
          [
            "VALIDATION_PENDING",
            "READY_FOR_ANALYSIS",
            "ANALYSIS_UNAVAILABLE",
            "COMPLETED",
          ].includes(current)
        )
          return publicMedia(data);
        throw new BadRequestException("Upload already finalized or removed");
      }
      const updated = reference
        ? await tx.drillReferenceVideo.update({
            where: { id },
            data: { uploadStatus: "VALIDATION_PENDING" },
          })
        : await tx.drillVideoSubmission.update({
            where: { id },
            data: { status: "VALIDATION_PENDING", uploadedAt: new Date() },
          });
      await tx.videoProcessingJob.upsert({
        where: {
          idempotencyKey: `validate:${reference ? "ref" : "player"}:${id}:v1`,
        },
        create: {
          type: "VALIDATE_VIDEO",
          status: validatorAvailable ? "PENDING" : "UNAVAILABLE",
          errorCode: validatorAvailable
            ? null
            : "MEDIA_VALIDATOR_NOT_CONFIGURED",
          idempotencyKey: `validate:${reference ? "ref" : "player"}:${id}:v1`,
          ...(reference ? { referenceVideoId: id } : { submissionId: id }),
        },
        update: {},
      });
      return publicMedia(updated);
    });
  }
  private async rejectUpload(id: string, reference: boolean) {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const current = reference
        ? await tx.drillReferenceVideo.findUniqueOrThrow({ where: { id } })
        : await tx.drillVideoSubmission.findUniqueOrThrow({ where: { id } });
      if (
        ("deletedAt" in current && current.deletedAt) ||
        ("uploadStatus" in current && current.uploadStatus === "DELETED")
      )
        return;

      if (reference)
        await tx.drillReferenceVideo.update({
          where: { id },
          data: { uploadStatus: "FAILED" },
        });
      else
        await tx.drillVideoSubmission.update({
          where: { id },
          data: { status: "FAILED" },
        });
      await tx.videoProcessingJob.upsert({
        where: {
          idempotencyKey: `cleanup:${reference ? "ref" : "player"}:${id}`,
        },
        create: {
          type: "CLEANUP_MEDIA",
          idempotencyKey: `cleanup:${reference ? "ref" : "player"}:${id}`,
          ...(reference ? { referenceVideoId: id } : { submissionId: id }),
          runAfter: new Date(Date.now() + 960000),
        },
        update: {},
      });
    });
  }
  async updateReference(
    actor: string,
    id: string,
    input: D.UpdateReferenceVideoInput,
  ) {
    await this.access.editor(actor);
    return this.library.write(async (tx) => {
      const old = await tx.drillReferenceVideo.findUniqueOrThrow({
        where: { id },
      });
      if (input.status === "PUBLISHED") {
        if (
          old.uploadStatus !== "READY_FOR_ANALYSIS" ||
          !old.poseArtifactKey ||
          !old.qualityAcknowledgedAt ||
          !old.checkpointIds.length
        )
          throw new BadRequestException(
            "Reference requires trusted media validation before publication",
          );
        await this.library.drill(old.drillId, undefined, tx);
        if (
          old.techniqueVariantId &&
          !(await tx.drillTechniqueVariant.findFirst({
            where: { id: old.techniqueVariantId, status: "PUBLISHED" },
          }))
        )
          throw new BadRequestException("Publish the technique variant first");
      }
      return publicMedia(
        await tx.drillReferenceVideo.update({
          where: { id },
          data: {
            ...input,
            ...(input.status === "ARCHIVED" ? { isPrimary: false } : {}),
          },
        }),
      );
    });
  }
  async playback(actor: string | undefined, id: string, reference = false) {
    if (reference) {
      const row = await this.db.drillReferenceVideo.findUniqueOrThrow({
        where: { id },
      });
      await this.library.drill(row.drillId, actor);
      if (
        !(await this.access.isEditor(actor)) &&
        (row.status !== "PUBLISHED" ||
          row.uploadStatus !== "READY_FOR_ANALYSIS")
      )
        throw new NotFoundException("Published reference not found");
      if (row.uploadStatus !== "READY_FOR_ANALYSIS")
        throw new BadRequestException(
          "Reference media validation is incomplete",
        );
      return this.storage.playback(row.storageKey);
    }
    if (!actor) throw new NotFoundException("Video not found");
    const row = await this.submission(actor, id);
    if (
      row.status === "PENDING_UPLOAD" ||
      row.status === "FAILED" ||
      !(await this.db.videoProcessingJob.findFirst({
        where: {
          submissionId: id,
          type: "VALIDATE_VIDEO",
          status: "COMPLETED",
        },
      }))
    )
      throw new BadRequestException("Video is not available for playback");
    return this.storage.playback(row.storageKey);
  }
  async deleteSubmission(actor: string, id: string) {
    await this.submission(actor, id, true);
    return this.removeSubmission(id);
  }
  /** Retention-only entry point: no caller-controlled actor, and expiration rechecked in the transaction. */
  async expireSubmission(id: string) {
    return this.removeSubmission(id, true);
  }
  private async removeSubmission(id: string, expiredOnly = false) {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const row = await tx.drillVideoSubmission.findUniqueOrThrow({
        where: { id },
      });
      if (row.deletedAt) return;
      if (
        expiredOnly &&
        !(
          row.retentionExpiresAt < new Date() ||
          (row.status === "PENDING_UPLOAD" &&
            row.uploadExpiresAt < new Date(Date.now() - 60000))
        )
      )
        return;
      await tx.drillVideoSubmission.update({
        where: { id },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      await tx.videoAnalysis.updateMany({
        where: { submissionId: id },
        data: {
          status: "DELETED",
          result: Prisma.DbNull,
          confidence: null,
          errorCode: "SOURCE_DELETED",
        },
      });
      await tx.videoProcessingJob.updateMany({
        where: {
          submissionId: id,
          status: { in: ["PENDING", "PROCESSING", "UNAVAILABLE"] },
        },
        data: { status: "CANCELLED", leaseToken: null, leaseUntil: null },
      });
      await tx.videoProcessingJob.upsert({
        where: { idempotencyKey: `cleanup:player:${id}` },
        update: {
          status: "PENDING",
          attempts: 0,
          runAfter: new Date(
            Math.max(Date.now(), row.uploadExpiresAt.getTime() + 1000),
          ),
        },
        create: {
          type: "CLEANUP_MEDIA",
          submissionId: id,
          idempotencyKey: `cleanup:player:${id}`,
          runAfter: new Date(
            Math.max(Date.now(), row.uploadExpiresAt.getTime() + 1000),
          ),
        },
      });
    });
    return true;
  }
  async requestAnalysis(actor: string, id: string, requestId: string) {
    if (!isUUID(requestId))
      throw new BadRequestException("requestId must be a UUID");
    await this.submission(actor, id);
    const provider = this.processing.orchestrator;
    let analysisVersion =
      provider?.processingLocation === "LOCAL"
        ? provider.analysisVersion
        : "training-video-v1";
    const workerActive = (await new MotionRuntime(this.db).status()).available;
    const source = await this.submission(actor, id);
    const config = await this.db.drill.findUniqueOrThrow({
      where: { id: source.drillId },
    });
    const definitions = await this.db.techniqueCheckpoint.findMany({
      where: { drillId: source.drillId, status: "PUBLISHED" },
      orderBy: { id: "asc" },
    });
    const refs = await this.db.drillReferenceVideo.findMany({
      where: {
        drillId: source.drillId,
        status: "PUBLISHED",
        uploadStatus: "READY_FOR_ANALYSIS",
      },
      select: { id: true, poseArtifactKey: true, checkpointIds: true },
      orderBy: { id: "asc" },
    });
    analysisVersion +=
      ":" +
      motionHash({
        config: config.motionConfig,
        definitions,
        refs,
        worker: (await new MotionRuntime(this.db).status()).versions,
      }).slice(0, 24);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const row = await tx.drillVideoSubmission.findUniqueOrThrow({
        where: { id },
      });
      if (row.deletedAt) throw new BadRequestException("Submission deleted");
      const old = await tx.videoAnalysis.findFirst({
        where: { submissionId: id, analysisVersion },
      });
      if (old) {
        if (
          ["FAILED", "ANALYSIS_UNAVAILABLE"].includes(old.status) &&
          workerActive
        ) {
          await tx.videoProcessingJob.updateMany({
            where: { analysisId: old.id },
            data: {
              status: "PENDING",
              attempts: 0,
              runAfter: new Date(),
              errorCode: null,
            },
          });
          await tx.drillVideoSubmission.update({
            where: { id },
            data: { status: "ANALYSIS_PENDING" },
          });
          return tx.videoAnalysis.update({
            where: { id: old.id },
            data: { status: "PENDING", errorCode: null, completedAt: null },
          });
        }
        return old;
      }
      if (row.status === "PENDING_UPLOAD")
        throw new BadRequestException("Finalize the upload first");
      const checkpointSnapshot = await tx.techniqueCheckpoint.findMany({
        where: {
          drillId: row.drillId,
          status: "PUBLISHED",
          OR: [
            { techniqueVariantId: null },
            { techniqueVariantId: row.techniqueVariantId },
          ],
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      const available =
        provider?.processingLocation === "LOCAL" &&
        workerActive &&
        ["READY_FOR_ANALYSIS", "COMPLETED", "ANALYSIS_UNAVAILABLE"].includes(
          row.status,
        );
      const compatible = available
        ? await tx.drillReferenceVideo.count({
            where: {
              drillId: row.drillId,
              techniqueVariantId: row.techniqueVariantId,
              cameraAngle: row.cameraAngle,
              status: "PUBLISHED",
              uploadStatus: "READY_FOR_ANALYSIS",
            },
          })
        : 0;
      const queued =
        available && compatible > 0 && row.cameraAngle !== "UNKNOWN";
      const errorCode = queued
        ? null
        : provider?.processingLocation === "EXTERNAL"
          ? "EXTERNAL_VIDEO_PROCESSING_NOT_AUTHORIZED"
          : row.status === "VALIDATION_PENDING"
            ? "MEDIA_VALIDATOR_NOT_CONFIGURED"
            : available
              ? "NO_COMPATIBLE_REFERENCES"
              : "ANALYSIS_PROVIDER_NOT_CONFIGURED";
      const analysis = await tx.videoAnalysis.create({
        data: {
          submissionId: id,
          requestId,
          status: queued ? "PENDING" : "ANALYSIS_UNAVAILABLE",
          analysisVersion,
          checkpointSnapshot: JSON.parse(JSON.stringify(checkpointSnapshot)),
          analysisProvider: queued ? provider!.providerName : null,
          errorCode,
          completedAt: queued ? null : new Date(),
        },
      });
      await tx.videoProcessingJob.create({
        data: {
          type: "COMPARE_TECHNIQUE",
          submissionId: id,
          analysisId: analysis.id,
          payload: {
            motionConfig: config.motionConfig ?? {},
            drill: {
              name: config.name,
              objective: config.objective,
              coachingCues: config.coachingCues,
            },
          },
          status: queued ? "PENDING" : "UNAVAILABLE",
          errorCode: analysis.errorCode,
          idempotencyKey: `analysis:${id}:${requestId}`,
        },
      });
      await tx.drillVideoSubmission.update({
        where: { id },
        data: { status: queued ? "ANALYSIS_PENDING" : "ANALYSIS_UNAVAILABLE" },
      });
      return analysis;
    });
  }
  async historicalReferencePlayback(
    actor: string,
    analysisId: string,
    referenceVideoId: string,
  ) {
    const analysis = await this.analysis(actor, analysisId);
    const reference = analysis.references.find(
      (r) => r.referenceVideoId === referenceVideoId,
    );
    if (!reference)
      throw new NotFoundException(
        "Reference is not part of this private analysis",
      );
    return this.storage.playback(reference.storageKeySnapshot);
  }
  async analysis(actor: string, id: string) {
    await this.access.user(actor);
    const analysis = await this.db.videoAnalysis.findFirst({
      where: { id, submission: { userId: actor, deletedAt: null } },
      include: { references: true },
    });
    if (!analysis) throw new NotFoundException("Private analysis not found");
    return analysis;
  }
}
