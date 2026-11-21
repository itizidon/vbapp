import {isClerkUserId}from"../auth/clerk/metadata";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient, Prisma } from "@prisma/client";
import { isUUID } from "class-validator";
import { OpenAIExtractor, OpenAIEmbedder } from "./providers";
import { FeedbackProcessingWorker } from "./worker";
import { Embedder, PROMPT_VERSION } from "./contracts";
import {
  rebuildProfiles,
  rebuildOneProfile,
  cachedProfileReady,
} from "./profiles";
import {
  options,
  target,
  inventory,
  enqueueHistorical,
  scope,
} from "./maintenance";

export async function main(args = process.argv.slice(2)) {
  const o = options(args),
    command = o.command;
  const commands = [
    "status",
    "enqueue",
    "work",
    "watch",
    "reprocess",
    "retry-failed",
    "retry-embeddings",
    "reembed",
    "profiles",
    "profiles-all",
    "profile",
  ];
  if (!commands.includes(command))
    throw new Error(`Commands: ${commands.join(", ")}`);
  if (command === "profile") {
    const [player, sport] = o.positional;
    if (
      !player ||
      !sport ||
      o.positional.length !== 2 ||
      !isClerkUserId(player) ||
      !isUUID(sport)
    )
      throw new Error("Use profile <player UUID> <sport UUID>");
    if (o.playerId && o.playerId !== player)
      throw new Error("Profile player differs from --player-id");
    o.playerId = player;
  }
  const selected = target(o, process.env); // Guard before Prisma can connect/load an implicit environment.
  console.log(
    JSON.stringify({
      target: selected,
      playerId: o.playerId ?? "all players",
      batchSize: o.batchSize,
      dryRun: o.dryRun,
    }),
  );
  const db = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  const before = new Date();
  try {
    const [actual] = await db.$queryRaw<
      { database: string }[]
    >`SELECT current_database() AS database`;
    if (actual.database !== selected.database)
      throw new Error("Connected database differs from selected database");
    const preview = await inventory(db, o, before, process.env);
    console.log(JSON.stringify({ phase: "preview", ...preview }));
    if (o.dryRun) return;
    if (command === "status") {
      const [storage] = await db.$queryRaw<
        { coachStorageAvailable: boolean; vectorInstalled: boolean }[]
      >`SELECT
        to_regclass('"AiCoachConversation"') IS NOT NULL AND to_regclass('"AiCoachTurn"') IS NOT NULL AND to_regclass('"AiCoachUsage"') IS NOT NULL AS "coachStorageAvailable",
        EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS "vectorInstalled"`;
      const profiles = await db.playerFeedbackAnalysisProfile.findMany({
        where: o.playerId ? { userId: o.playerId } : {},
        select: {
          stale: true,
          revision: true,
          builtRevision: true,
          algorithmVersion: true,
          expiresAt: true,
          rebuildError: true,
        },
      });
      console.log(
        JSON.stringify({
          profiles: {
            total: profiles.length,
            ready: profiles.filter((p) => cachedProfileReady(p)).length,
            failed: profiles.filter((p) => p.rebuildError).length,
          },
          ...(o.ready
            ? {
                readiness: {
                  migrationsAccessible: true,
                  ...storage,
                  workerEnabled:
                    process.env.FEEDBACK_ANALYSIS_ENABLED === "true",
                  eligibleFeedback: preview.counts.eligible,
                  extractionRemaining: preview.counts.remaining,
                  embeddingOperations:
                    preview.counts.missingEmbeddingJobs +
                    preview.counts.pendingEmbeddingOperations,
                  failedEmbeddings: preview.counts.failedEmbeddings,
                  profileReady:
                    profiles.length > 0 &&
                    profiles.every((p) => cachedProfileReady(p)),
                  openAiKeyPresent: selected.openAiKeyPresent,
                  chatModel: process.env.OPENAI_CHAT_MODEL ?? "unset",
                  note: "Read-only data readiness; model access and live chat are not tested. No observations is valid for ratings-only reviews.",
                },
              }
            : {}),
        }),
      );
      return;
    }
    if (command === "profile") {
      const [userId, sportId] = o.positional;
      if (
        !userId ||
        !sportId ||
        o.positional.length !== 2 ||
        !isClerkUserId(userId) ||
        !isUUID(sportId)
      )
        throw new Error("Use profile <player UUID> <sport UUID>");
      if (o.playerId && o.playerId !== userId)
        throw new Error("Profile player differs from --player-id");
      const rebuilt = await rebuildOneProfile(db, userId, sportId);
      console.log(JSON.stringify({ rebuilt }));
      if (!rebuilt) process.exitCode = 1;
      return;
    }
    if (command === "profiles" || command === "profiles-all") {
      let rebuilt = 0,
        batch = 0;
      do {
        batch = await rebuildProfiles(db, o.batchSize, o.playerId);
        rebuilt += batch;
      } while (command === "profiles-all" && batch > 0);
      console.log(JSON.stringify({ rebuilt }));
      return;
    }
    const descriptor: Embedder = {
      provider: "openai",
      model: process.env.FEEDBACK_EMBEDDING_MODEL ?? "",
      modelVersion: process.env.FEEDBACK_EMBEDDING_VERSION ?? "",
      dimensions: Number(process.env.FEEDBACK_EMBEDDING_DIMENSIONS),
      embed: async () => {
        throw new Error("Queue-only provider cannot call OpenAI");
      },
    };
    const queueWorker = new FeedbackProcessingWorker(db, null, descriptor, {
      playerId: o.playerId,
      before,
    });
    if (["enqueue", "reprocess", "reembed"].includes(command)) {
      const required = [
        "FEEDBACK_EXTRACTION_MODEL",
        "FEEDBACK_EMBEDDING_MODEL",
        "FEEDBACK_EMBEDDING_VERSION",
        "FEEDBACK_EMBEDDING_DIMENSIONS",
      ];
      if (
        required.some((k) => !process.env[k]?.trim()) ||
        !Number.isSafeInteger(descriptor.dimensions) ||
        descriptor.dimensions < 1
      )
        throw new Error("Extraction/embedding model settings are required");
      const queued =
        command === "reembed"
          ? 0
          : await enqueueHistorical(db, o, before, process.env);
      let embeddingsQueued = 0,
        n = 0;
      do {
        n = await queueWorker.enqueueEmbeddings(o.batchSize);
        embeddingsQueued += n;
      } while (o.all && n > 0);
      console.log(
        JSON.stringify({ queued, embeddingsQueued, paidOperations: 0 }),
      );
      return;
    }
    if (command === "retry-failed" || command === "retry-embeddings") {
      const result =
        command === "retry-failed"
          ? await db.$queryRaw<{ queued: number }[]>(Prisma.sql`
        WITH picked AS (SELECT f.id FROM "AnalysisEligibleFeedback" f JOIN "FeedbackAnalysisJob" j ON j."feedbackId"=f.id
          WHERE ${scope(o, before)} AND j.status='FAILED' ORDER BY f.id LIMIT ${o.batchSize})
        SELECT count(queue_feedback_analysis(id))::int AS queued FROM picked`)
          : await db.$queryRaw<{ queued: number }[]>(Prisma.sql`WITH picked AS (
          SELECT q."observationId",q.provider,q.model,q."modelVersion",q.dimensions,q."templateVersion" FROM "FeedbackEmbeddingJob" q
          JOIN "EligibleFeedbackObservation" obs ON obs.id=q."observationId" JOIN "AnalysisEligibleFeedback" f ON f.id=obs."feedbackId"
          WHERE ${scope(o, before)} AND q.status='FAILED' ORDER BY q."observationId" LIMIT ${o.batchSize}),
          updated AS (UPDATE "FeedbackEmbeddingJob" e SET status='PENDING',attempts=0,"errorCode"=NULL,"runAfter"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
            WHERE (e."observationId",e.provider,e.model,e."modelVersion",e.dimensions,e."templateVersion") IN (SELECT * FROM picked) RETURNING 1)
          SELECT count(*)::int AS queued FROM updated`);
      console.log(JSON.stringify(result[0]));
      return;
    }
    // Every paid entry point previews first and requires explicit execution intent.
    if (!o.execute) {
      console.log(
        "Preview only. Add --execute to allow paid extraction/embedding operations.",
      );
      return;
    }
    if (process.env.FEEDBACK_ANALYSIS_ENABLED !== "true")
      throw new Error("FEEDBACK_ANALYSIS_ENABLED must be true");
    const worker = new FeedbackProcessingWorker(
      db,
      new OpenAIExtractor(process.env),
      new OpenAIEmbedder(process.env),
      { playerId: o.playerId, ...(command === "watch" ? {} : { before }) },
    );
    const stop = new AbortController(),
      shutdown = () => stop.abort();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    try {
      let extracted = 0,
        embedded = 0,
        rebuilt = 0;
      do {
        let x = 0,
          e = 0;
        for (let i = 0; i < o.batchSize && !stop.signal.aborted; i++) {
          if (!(await worker.extractOne())) break;
          x++;
        }
        for (let i = 0; i < o.batchSize && !stop.signal.aborted; i++) {
          if (!(await worker.embedOne())) break;
          e++;
        }
        extracted += x;
        embedded += e;
        rebuilt += await rebuildProfiles(db, o.batchSize, o.playerId);
        console.log(
          JSON.stringify({
            phase: "progress",
            extractionAttempts: extracted,
            embeddingAttempts: embedded,
            profilesRebuilt: rebuilt,
          }),
        );
        if (command === "watch") {
          try {
            await delay(5000, undefined, { signal: stop.signal });
          } catch {
            break;
          }
        } else if (!o.all || (!x && !e)) break;
      } while (!stop.signal.aborted);
      const after = await inventory(db, o, before, process.env);
      const processed = Math.max(
        0,
        after.counts.skipped - preview.counts.skipped,
      );
      console.log(
        JSON.stringify({
          phase: "complete",
          ...after,
          counts: {
            ...after.counts,
            processed,
            skipped: Math.max(0, after.counts.skipped - processed),
          },
          note: "Processed/skipped count feedback records; embedding operations are separate. Deferred/failed jobs remain resumable. Re-run the same command after backoff; no failed jobs are reset automatically.",
        }),
      );
    } finally {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
    }
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((error) => {
    // Configuration errors are safe to print; provider/database errors can contain secrets or source text.
    const safe =
      error instanceof Error &&
      !("code" in error) &&
      !("clientVersion" in error) &&
      !("status" in error);
    console.error(
      safe
        ? error.message
        : "Feedback command failed; check migrations, target settings and sanitized job error codes.",
    );
    process.exitCode = 1;
  });
