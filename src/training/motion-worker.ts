import { motionReferenceCompatibility } from "./motion-selection";
import { PrismaClient } from "@prisma/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { options, target } from "../feedback-processing/maintenance";
import { TrainingVideoJobs } from "./jobs.service";
import { S3VideoStorage } from "./storage";
import { MotionRuntime, pythonMotion, motionHash } from "./motion-runtime";
import { TrainingAccess } from "./access";
import { TrainingLibraryService } from "./library.service";
import { TrainingVideoService } from "./video.service";
import { deterministicCoaching, motionComparisonSchema } from "./motion-result";
import { CoachOpenAI } from "../ai-coach/provider";
import { z } from "zod";

export class CpuVideoWorker {
  readonly jobs: TrainingVideoJobs;
  readonly runtime: MotionRuntime;
  readonly videos: TrainingVideoService;
  constructor(
    readonly db: PrismaService,
    readonly storage = new S3VideoStorage(),
  ) {
    this.jobs = new TrainingVideoJobs(db, storage);
    this.runtime = new MotionRuntime(db);
    const access = new TrainingAccess(db);
    this.videos = new TrainingVideoService(
      db,
      access,
      new TrainingLibraryService(db, access),
      storage,
      {
        orchestrator: {
          processingLocation: "LOCAL",
          providerName: "local-mediapipe-cpu",
          analysisVersion: "confidence-dtw-v1",
          process: async () => {
            throw new Error("Worker only");
          },
        },
      },
    );
  }
  async source(job: any) {
    return job.submissionId
      ? this.db.drillVideoSubmission.findUniqueOrThrow({
          where: { id: job.submissionId },
        })
      : this.db.drillReferenceVideo.findUniqueOrThrow({
          where: { id: job.referenceVideoId },
        });
  }
  async extract(job: any, dir: string) {
    const source = await this.source(job);
    if (
      source.status === "DELETED" ||
      ("deletedAt" in source && source.deletedAt)
    )
      throw new Error("SOURCE_DELETED");
    const input = join(dir, "input"),
      output = join(dir, "pose.json");
    await this.storage.download(source.storageKey, input);
    const metadata = await pythonMotion({ command: "probe", path: input });
    if (
      metadata.bytes !== Number(source.fileSizeBytes) ||
      !(
        metadata.mimeType === source.mimeType ||
        (source.mimeType === "video/quicktime" &&
          metadata.mimeType === "video/mp4")
      )
    )
      throw new Error("SOURCE_METADATA_MISMATCH");
    if (job.type === "VALIDATE_VIDEO") {
      await this.jobs.completeValidation(
        job.id,
        job.leaseToken,
        {
          ...metadata,
          mimeType: source.mimeType,
          cameraAngle: source.cameraAngle,
        },
        true,
      );
      return;
    }
    const health = await this.runtime.status();
    const fingerprint = motionHash({
      source: metadata.sourceHash,
      versions: health.versions,
    });
    let artifact = await this.db.videoPoseArtifact.findFirst({
      where: {
        ...(job.submissionId
          ? { submissionId: source.id }
          : { referenceVideoId: source.id }),
        fingerprint,
      },
    });
    if (
      artifact?.status === "REJECTED" &&
      !(artifact.quality as any).errorCode
    ) {
      await this.storage.delete(artifact.storageKey);
      await this.db.videoPoseArtifact.delete({ where: { id: artifact.id } });
      artifact = null;
    }
    if (!artifact) {
      const result = await pythonMotion({
        command: "extract",
        path: input,
        outputPath: output,
      });
      const id = randomUUID(),
        key = `${source.storageKey.slice(0, -8)}poses/${id}.json`;
      // Register the server-generated key before writing, so concurrent deletion can clean it.
      artifact = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.id}))`;
        const live = job.submissionId
          ? await tx.drillVideoSubmission.findUniqueOrThrow({
              where: { id: source.id },
            })
          : await tx.drillReferenceVideo.findUniqueOrThrow({
              where: { id: source.id },
            });
        if (
          ("deletedAt" in live && live.deletedAt) ||
          ("uploadStatus" in live && live.uploadStatus === "DELETED")
        )
          throw new Error("SOURCE_DELETED");
        return tx.videoPoseArtifact.create({
          data: {
            id,
            ...(job.submissionId
              ? { submissionId: source.id }
              : { referenceVideoId: source.id }),
            fingerprint,
            storageKey: key,
            sourceHash: metadata.sourceHash,
            modelVersion: result.modelVersion,
            extractionVersion: result.extractionVersion,
            featureVersion: result.featureVersion,
            samplingFps: result.samplingFps,
            quality: result.quality,
            metadata: result.metadata,
            status: "REJECTED",
          },
        });
      });
      try {
        await this.storage.putArtifact(key, output);
        const saved = await this.db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.id}))`;
          const live = job.submissionId
            ? await tx.drillVideoSubmission.findUniqueOrThrow({
                where: { id: source.id },
              })
            : await tx.drillReferenceVideo.findUniqueOrThrow({
                where: { id: source.id },
              });
          if (
            ("deletedAt" in live && live.deletedAt) ||
            ("uploadStatus" in live && live.uploadStatus === "DELETED")
          )
            return null;
          return tx.videoPoseArtifact.update({
            where: { id },
            data: { status: result.quality.errorCode ? "REJECTED" : "READY" },
          });
        });
        if (!saved) {
          await this.storage.delete(key);
          throw new Error("SOURCE_DELETED");
        }
        artifact = saved;
      } catch (e) {
        await this.db.videoPoseArtifact.updateMany({
          where: { id, status: { not: "DELETED" } },
          data: { status: "REJECTED" },
        });
        throw e;
      }
    }
    const a = artifact;
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.id}))`;
      const lease = await tx.videoProcessingJob.findFirst({
        where: {
          id: job.id,
          leaseToken: job.leaseToken,
          status: "PROCESSING",
          leaseUntil: { gt: new Date() },
        },
      });
      if (!lease) throw new Error("LEASE_EXPIRED");
      const live = job.submissionId
        ? await tx.drillVideoSubmission.findUniqueOrThrow({
            where: { id: source.id },
          })
        : await tx.drillReferenceVideo.findUniqueOrThrow({
            where: { id: source.id },
          });
      if (
        ("deletedAt" in live && live.deletedAt) ||
        ("uploadStatus" in live && live.uploadStatus === "DELETED")
      )
        throw new Error("SOURCE_DELETED");
      const ok = a.status === "READY",
        q = a.quality as any;
      if (job.submissionId)
        await tx.drillVideoSubmission.update({
          where: { id: source.id },
          data: { status: ok ? "READY_FOR_ANALYSIS" : "FAILED" },
        });
      else
        await tx.drillReferenceVideo.update({
          where: { id: source.id },
          data: {
            uploadStatus: ok ? "READY_FOR_ANALYSIS" : "FAILED",
            poseArtifactKey: ok ? a.storageKey : null,
            poseModelVersion: a.modelVersion,
            qualityAcknowledgedAt: null,
          },
        });
      await tx.videoProcessingJob.update({
        where: { id: job.id },
        data: {
          status: ok ? "COMPLETED" : "FAILED",
          errorCode: q.errorCode ?? (ok ? null : "ARTIFACT_WRITE_FAILED"),
          leaseToken: null,
          leaseUntil: null,
        },
      });
    });
  }
  async compare(job: any, dir: string) {
    const analysis = await this.db.videoAnalysis.findUniqueOrThrow({
      where: { id: job.analysisId },
      include: {
        submission: { include: { drill: true } },
        references: { include: { poseArtifact: true, referenceVideo: true } },
      },
    });
    const s = analysis.submission;
    if (s.deletedAt) throw new Error("SOURCE_DELETED");
    const config = (job.payload as any)?.motionConfig ?? s.drill.motionConfig;
    const drillText = (job.payload as any)?.drill ?? s.drill;
    if (!config?.enabled) throw new Error("DRILL_ANALYSIS_NOT_ENABLED");
    let player = await this.db.videoPoseArtifact.findFirst({
      where: { submissionId: s.id, status: "READY" },
      orderBy: { createdAt: "desc" },
    });
    if (!player) throw new Error("PLAYER_POSE_UNAVAILABLE");
    if ((job.payload as any)?.playerPoseArtifactId)
      player = await this.db.videoPoseArtifact.findUniqueOrThrow({
        where: { id: (job.payload as any).playerPoseArtifactId },
      });
    else
      await this.db.videoProcessingJob.update({
        where: { id: job.id },
        data: {
          payload: {
            ...((job.payload as any) ?? {}),
            playerPoseArtifactId: player.id,
          },
        },
      });
    const checkpoints = analysis.checkpointSnapshot as any[];
    const candidates = await this.db.drillReferenceVideo.findMany({
      where: { drillId: s.drillId, status: "PUBLISHED" },
      include: {
        poseArtifacts: {
          where: { status: "READY" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
      take: 100,
    });
    const selection = candidates.map((r) => ({
      referenceVideoId: r.id,
      ...motionReferenceCompatibility(
        s,
        r,
        player,
        !!config.allowMirroring,
        checkpoints.map((c) => c.id),
      ),
    }));
    let frozen = analysis.references;
    if (!frozen.length) {
      const selected = candidates
        .filter(
          (r) => selection.find((x) => x.referenceVideoId === r.id)?.compatible,
        )
        .slice(0, 5);
      if (!selected.length) throw new Error("NO_COMPATIBLE_REFERENCES");
      await this.jobs.attachReferences(
        analysis.id,
        selected.map((r) => ({
          id: r.id,
          referenceVersion: r.referenceVersion,
          storageKey: r.storageKey,
          reason:
            "Matching variant/camera and declared checkpoint coverage; quality passed, coach acknowledged. Mirroring only when explicitly authorized.",
          poseArtifactId: r.poseArtifacts[0].id,
          checkpointIds: r.checkpointIds,
          mirrored: !!(
            s.handedness &&
            r.handedness &&
            ![s.handedness, "BOTH"].includes(r.handedness)
          ),
        })),
      );
      frozen = await this.db.videoAnalysisReference.findMany({
        where: { analysisId: analysis.id },
        include: { poseArtifact: true, referenceVideo: true },
      });
    }
    const playerPath = join(dir, "player.json");
    await this.storage.download(
      player.storageKey,
      playerPath,
      32 * 1024 * 1024,
    );
    const references = await Promise.all(
      frozen.map(async (r) => {
        if (!r.poseArtifact || r.poseArtifact.status !== "READY")
          throw new Error("REFERENCE_POSE_UNAVAILABLE");
        const path = join(dir, `${r.referenceVideoId}.json`);
        await this.storage.download(
          r.poseArtifact.storageKey,
          path,
          32 * 1024 * 1024,
        );
        return {
          id: r.referenceVideoId,
          version: r.referenceVersion,
          artifactId: r.poseArtifact.id,
          path,
          checkpointIds: r.checkpointIdsSnapshot,
          mirrored: r.mirrored,
        };
      }),
    );
    const measured = motionComparisonSchema.parse(
      await pythonMotion({
        command: "compare",
        playerPath,
        references,
        checkpoints,
        config: {
          cameraAngle: s.cameraAngle,
          motionConfig: config,
          minOverallCheckpoints: 2,
        },
      }),
    );
    let coaching = deterministicCoaching(
      measured,
      drillText.coachingCues,
      drillText.objective,
    );
    // Reuse the application's Responses provider. Only structured measurements/curated text leave the worker, explicitly opted in.
    if (
      s.aiExplanationAllowed &&
      process.env.TRAINING_AI_EXPLANATIONS_ENABLED === "true" &&
      new CoachOpenAI().configured()
    ) {
      try {
        const response = await new CoachOpenAI().respond(
          {
            model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini",
            store: false,
            max_output_tokens: 300,
            text: {
              format: {
                type: "json_schema",
                name: "motion_coaching_priorities",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    checkpointIds: {
                      type: "array",
                      items: { type: "string" },
                      maxItems: 3,
                    },
                    cueIndexes: {
                      type: "array",
                      items: { type: "integer", minimum: 0 },
                      maxItems: 3,
                    },
                  },
                  required: ["checkpointIds", "cueIndexes"],
                  additionalProperties: false,
                },
              },
            },
            instructions:
              "Select up to 3 checkpoint IDs worth discussing, using only supplied measured differences. Select up to 3 coaching cue indexes. Return JSON {checkpointIds:[],cueIndexes:[]}. Do not invent facts or new advice.",
            input: JSON.stringify({
              drill: drillText.name,
              objective: drillText.objective,
              cues: drillText.coachingCues,
              measurements: measured.checkpoints.map((c) => ({
                id: c.checkpointId,
                name: c.name,
                similarity: c.similarity,
                evidence: c.evidence.map(
                  ({
                    playerValue,
                    referenceValue,
                    difference,
                    unit,
                    quality,
                  }) => ({
                    playerValue,
                    referenceValue,
                    difference,
                    unit,
                    quality,
                  }),
                ),
              })),
            }),
          },
          AbortSignal.timeout(30000),
        );
        const chosen = z
          .object({
            checkpointIds: z.array(z.string().uuid()).max(3),
            cueIndexes: z.array(z.number().int().nonnegative()).max(3),
          })
          .strict()
          .parse(JSON.parse(response.output_text));
        const ordered = [...new Set(chosen.checkpointIds)].flatMap((id) =>
          coaching.improve.filter((c) => c.checkpointId === id),
        );
        if (ordered.length)
          coaching = {
            ...coaching,
            source: "OPENAI_CURATED_SELECTION",
            improve: ordered,
            practice: [...new Set(chosen.cueIndexes)].flatMap((i) =>
              drillText.coachingCues[i] ? [drillText.coachingCues[i]] : [],
            ),
          };
      } catch {
        /* Deterministic explanation remains available; measurements never depend on LLM. */
      }
    }
    const evaluated = measured.checkpoints.filter(
      (c) => c.status === "EVALUATED",
    );
    const result = {
      playerPoseArtifactId: player.id,
      drillId: s.drillId,
      submissionId: s.id,
      references: frozen.map((r) => ({
        id: r.referenceVideoId,
        version: r.referenceVersion,
      })),
      checkpoints: measured.checkpoints.map((c) => ({
        id: c.checkpointId,
        status: c.status === "EVALUATED" ? "EVALUATED" : "NOT_MEASURABLE",
        differences:
          c.status === "EVALUATED"
            ? c.perReference.map((r) => ({
                metric: "median_absolute_difference",
                value: r.medianAbsoluteDifference,
                unit: r.unit,
              }))
            : [],
        evidenceTimestampsMs: c.evidence.map((e) => e.playerMs),
        confidence: c.quality,
        limitations: c.limitations,
      })),
      confidence: evaluated.length
        ? Math.min(...evaluated.map((c) => c.quality ?? 0))
        : null,
      limitations: measured.limitations,
      observations: evaluated.map((c) => ({
        checkpointId: c.checkpointId,
        description: `${c.name}: projected movement compared with ${c.perReference.length} compatible reference(s).`,
        evidenceTimestampsMs: c.evidence.map((e) => e.playerMs),
      })),
      suggestedSkillIds: [],
      suggestedDrillIds: [s.drillId],
      comparison: measured,
      coaching,
      selection: selection.map(({ referenceVideoId, reason, compatible }) => ({
        referenceVideoId,
        reason,
        compatible,
      })),
    };
    await this.jobs.completeAnalysis(job.id, job.leaseToken, result, {
      poseModelVersion: player.modelVersion,
      comparisonAlgorithmVersion: measured.algorithmVersion,
    });
  }
  async tick() {
    for (const type of [
      "VALIDATE_VIDEO",
      "EXTRACT_REFERENCE_POSE",
      "EXTRACT_PLAYER_POSE",
      "COMPARE_TECHNIQUE",
    ] as const) {
      const job = await this.jobs.claim(type);
      if (!job) continue;
      const dir = await mkdtemp(join(tmpdir(), "bvbtips-motion-"));
      try {
        if (type === "COMPARE_TECHNIQUE") await this.compare(job, dir);
        else await this.extract(job, dir);
      } catch (e) {
        if (process.env.NODE_ENV === "test") console.error(e);
        const code =
          e instanceof Error && /^[A-Z_]+$/.test(e.message)
            ? e.message
            : "PROCESSING_FAILED";
        if (
          [
            "NO_COMPATIBLE_REFERENCES",
            "DRILL_ANALYSIS_NOT_ENABLED",
            "PLAYER_POSE_UNAVAILABLE",
          ].includes(code)
        ) {
          await this.jobs.fail(job.id, job.leaseToken, true);
          if (job.analysisId)
            await this.db.videoAnalysis.updateMany({
              where: { id: job.analysisId, status: { not: "DELETED" } },
              data: {
                status: "ANALYSIS_UNAVAILABLE",
                errorCode: code,
                completedAt: new Date(),
              },
            });
        } else await this.jobs.fail(job.id, job.leaseToken);
        console.log(JSON.stringify({ job: job.id, type, errorCode: code }));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      return true;
    }
    // Ready player attempts automatically enter comparison; no fabricated progress without a real worker.
    const ready = await this.db.drillVideoSubmission.findMany({
      where: { deletedAt: null, status: "READY_FOR_ANALYSIS" },
      take: 5,
    });
    for (const s of ready)
      await this.videos.requestAnalysis(s.userId, s.id, randomUUID());
    await this.jobs.cleanupBatch(2);
    return ready.length > 0;
  }
  async start(once = false) {
    const health = await pythonMotion({ command: "health" });
    await this.runtime.heartbeat(health);
    const timer = setInterval(() => {
      this.runtime.heartbeat(health).catch(() => {});
    }, 10000);
    timer.unref();
    try {
      await this.db.videoProcessingJob.updateMany({
        where: { type: "VALIDATE_VIDEO", status: "UNAVAILABLE" },
        data: { status: "PENDING", errorCode: null },
      });
      if (once) {
        for (let n = 0; n < 100 && (await this.tick()); n++);
        return;
      }
      let stop = false;
      const halt = () => {
        stop = true;
      };
      process.once("SIGTERM", halt);
      process.once("SIGINT", halt);
      while (!stop) {
        if (!(await this.tick())) await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      clearInterval(timer);
      await this.db.videoWorkerHeartbeat.updateMany({
        where: { id: "cpu-pose-v1" },
        data: { expiresAt: new Date(0) },
      });
    }
  }
}
export async function main(args = process.argv.slice(2)) {
  const o = options(args);
  if (!["watch", "once", "health"].includes(o.command))
    throw new Error("Use watch, once, or health");
  const selected = target(o, process.env);
  console.log(
    JSON.stringify({
      host: selected.host,
      database: selected.database,
      command: o.command,
      execute: o.execute && !o.dryRun,
    }),
  );
  if (!o.execute || o.dryRun) return;
  if (o.command === "health") {
    console.log(JSON.stringify(await pythonMotion({ command: "health" })));
    return;
  }
  const db = new PrismaClient() as PrismaService;
  try {
    await new CpuVideoWorker(db).start(o.command === "once");
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(
      e instanceof Error && /^[A-Z_]+$/.test(e.message)
        ? e.message
        : "Video worker failed. Verify the explicit environment, migrations, Python/model installation and private storage.",
    );
    process.exitCode = 1;
  });
