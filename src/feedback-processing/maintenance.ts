import { feedbackTrust } from "../feedback/eligibility";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { isUUID } from "class-validator";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  feedbackSources,
  hash,
  PROMPT_VERSION,
  TEMPLATE_VERSION,
} from "./contracts";

export function options(args: string[]) {
  const result = {
    command: args[0] ?? "status",
    batchSize: 100,
    playerId: undefined as string | undefined,
    dryRun: false,
    all: false,
    execute: false,
    envFile: undefined as string | undefined,
    allowRemote: false,
    allowProduction: false,
    confirmDatabase: undefined as string | undefined,
    ready: false,
    positional: [] as string[],
  };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (
      [
        "--dry-run",
        "--all",
        "--execute",
        "--allow-remote",
        "--allow-production",
        "--ready",
      ].includes(arg)
    ) {
      const key = {
        "--dry-run": "dryRun",
        "--all": "all",
        "--execute": "execute",
        "--allow-remote": "allowRemote",
        "--allow-production": "allowProduction",
        "--ready": "ready",
      }[arg]!;
      (result as unknown as Record<string, unknown>)[key] = true;
    } else if (
      [
        "--player-id",
        "--batch-size",
        "--env-file",
        "--confirm-database",
      ].includes(arg)
    ) {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      if (arg === "--player-id") {
        if (!isUUID(value)) throw new Error("Invalid player UUID");
        result.playerId = value;
      }
      if (arg === "--batch-size") result.batchSize = Number(value);
      if (arg === "--env-file") result.envFile = value;
      if (arg === "--confirm-database") result.confirmDatabase = value;
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else result.positional.push(arg);
  }
  if (result.command !== "profile" && result.positional.length) {
    if (result.positional.length !== 1)
      throw new Error("Unexpected positional arguments");
    result.batchSize = Number(result.positional[0]);
  }
  if (
    !Number.isSafeInteger(result.batchSize) ||
    result.batchSize < 1 ||
    result.batchSize > 1000
  )
    throw new Error("Batch size must be 1–1000");
  if (result.dryRun && result.execute)
    throw new Error("--dry-run cannot be combined with --execute");
  return result;
}
export type Options = ReturnType<typeof options>;
export function target(o: Options, env: NodeJS.ProcessEnv) {
  if (o.envFile) {
    const loaded = parseEnv(readFileSync(o.envFile, "utf8"));
    if (
      env.DATABASE_URL &&
      loaded.DATABASE_URL &&
      env.DATABASE_URL !== loaded.DATABASE_URL
    )
      throw new Error(
        "Inherited DATABASE_URL conflicts with --env-file; unset it or select the intended file",
      );
    // Explicit file takes precedence, except a conflicting database is rejected above.
    Object.assign(env, loaded);
  }
  if (!env.DATABASE_URL)
    throw new Error("Set DATABASE_URL or use --env-file before connecting");
  const url = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Expected PostgreSQL DATABASE_URL");
  const database = decodeURIComponent(url.pathname.slice(1));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const production =
    env.APP_ENV?.toLowerCase() === "production" ||
    (env.NODE_ENV === "production" &&
      !["local", "development", "test", "qa"].includes(env.APP_ENV ?? ""));
  if (
    (!local && !o.allowRemote) ||
    (production && !o.allowProduction) ||
    ((!local || production) && o.confirmDatabase !== database)
  )
    throw new Error(
      "Remote/production target blocked. Explicit target authorization and --confirm-database <database> required",
    );
  return {
    envFile: o.envFile ?? "inherited environment",
    appEnv: env.APP_ENV ?? "unset",
    nodeEnv: env.NODE_ENV ?? "unset",
    host: url.hostname,
    port: url.port || "5432",
    database,
    schema: url.searchParams.get("schema") ?? "public",
    extractionModel: env.FEEDBACK_EXTRACTION_MODEL ?? "unset",
    promptVersion: PROMPT_VERSION,
    embeddingModel: env.FEEDBACK_EMBEDDING_MODEL ?? "unset",
    embeddingVersion: env.FEEDBACK_EMBEDDING_VERSION ?? "unset",
    dimensions: Number(env.FEEDBACK_EMBEDDING_DIMENSIONS) || null,
    openAiKeyPresent: !!env.OPENAI_API_KEY?.trim(),
  };
}
export const scope = (o: Pick<Options, "playerId">, before: Date) => Prisma.sql`
  (${o.playerId ?? null}::uuid IS NULL OR f."recipientId"=${o.playerId ?? null}::uuid) AND f."createdAt"<=${before}`;

// Read-only, paged inventory. Each Feedback ID is visited once, independent of its match associations.
export async function inventory(
  db: PrismaClient,
  o: Options,
  before: Date,
  env: NodeJS.ProcessEnv,
) {
  const counts = {
    eligible: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
    numericOnly: 0,
    needsExtraction: 0,
    extractionCandidates: 0,
    missingEmbeddingJobs: 0,
    pendingEmbeddingOperations: 0,
    failedEmbeddings: 0,
  };
  const trustCounts: Record<string, number> = {};
  let sourceCharacters = 0;
  let cursor: string | null = null;
  do {
    const ids: { id: string }[] = await db.$queryRaw<
      { id: string }[]
    >(Prisma.sql`SELECT f.id FROM "AnalysisEligibleFeedback" f
      WHERE ${scope(o, before)} AND EXISTS (SELECT 1 FROM "Feedback" af WHERE af.id=f.id AND feedback_analysis_eligible(af)) AND (${cursor}::uuid IS NULL OR f.id>${cursor}::uuid) ORDER BY f.id LIMIT ${o.batchSize}`);
    if (!ids.length) break;
    const rows = await db.feedback.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: { ratings: true, analysisJob: true },
    });
    const incomplete = await db.$queryRaw<
      { feedbackId: string; failed: boolean }[]
    >(Prisma.sql`
      SELECT o."feedbackId",bool_or(e.status='FAILED') AS failed FROM "EligibleFeedbackObservation" o
      LEFT JOIN "FeedbackEmbeddingJob" e ON e."observationId"=o.id AND e.provider='openai'
        AND e.model=${env.FEEDBACK_EMBEDDING_MODEL ?? ""} AND e."modelVersion"=${env.FEEDBACK_EMBEDDING_VERSION ?? ""}
        AND e.dimensions=${Number(env.FEEDBACK_EMBEDDING_DIMENSIONS) || 1536} AND e."templateVersion"=${TEMPLATE_VERSION}
      LEFT JOIN "FeedbackObservationEmbedding" v ON v."observationId"=e."observationId" AND v.provider=e.provider
        AND v.model=e.model AND v."modelVersion"=e."modelVersion" AND v.dimensions=e.dimensions
        AND v."templateVersion"=e."templateVersion" AND v."sourceHash"=e."sourceHash"
      WHERE o."feedbackId" IN (${Prisma.join(ids.map((r) => Prisma.sql`${r.id}::uuid`))})
        AND (e.status IS DISTINCT FROM 'COMPLETED' OR v."observationId" IS NULL) GROUP BY o."feedbackId"`);
    const incompleteById = new Map(
      incomplete.map((r) => [r.feedbackId, r.failed]),
    );
    for (const row of rows) {
      counts.eligible++;
      const trust = feedbackTrust(row);
      trustCounts[trust] = (trustCounts[trust] ?? 0) + 1;
      sourceCharacters += feedbackSources(row).reduce(
        (n, s) => n + s.text.length,
        0,
      );
      const sources = feedbackSources(row),
        j = row.analysisJob;
      const current =
        j?.status === "COMPLETED" &&
        j.moderation === "ALLOW" &&
        j.sourceHash === hash(sources) &&
        j.provider === "openai" &&
        j.modelVersion === env.FEEDBACK_EXTRACTION_MODEL &&
        j.promptVersion === PROMPT_VERSION;
      if (!sources.length) {
        counts.numericOnly++;
        counts.skipped++;
      } else if (current) {
        if (incompleteById.has(row.id)) {
          counts.remaining++;
          if (incompleteById.get(row.id)) counts.failed++;
        } else counts.skipped++;
      } else {
        counts.remaining++;
        if (j?.status === "FAILED") counts.failed++;
        else {
          counts.needsExtraction++;
          if (!j || !["PENDING", "PROCESSING"].includes(j.status))
            counts.extractionCandidates++;
        }
      }
    }
    cursor = ids[ids.length - 1].id;
  } while (true);
  const [embeddings] = await db.$queryRaw<
    { missing: number; pending: number; failed: number; incomplete: number }[]
  >(Prisma.sql`
    SELECT count(*) FILTER(WHERE e."observationId" IS NULL)::int AS missing,
      count(*) FILTER(WHERE e.status IN ('PENDING','PROCESSING'))::int AS pending,
      count(*) FILTER(WHERE e.status='FAILED')::int AS failed,
      count(*) FILTER(WHERE e.status='COMPLETED' AND v."observationId" IS NULL)::int AS incomplete
    FROM "EligibleFeedbackObservation" o JOIN "AnalysisEligibleFeedback" f ON f.id=o."feedbackId"
    LEFT JOIN "FeedbackEmbeddingJob" e ON e."observationId"=o.id AND e.provider='openai'
      AND e.model=${env.FEEDBACK_EMBEDDING_MODEL ?? ""} AND e."modelVersion"=${env.FEEDBACK_EMBEDDING_VERSION ?? ""}
      AND e.dimensions=${Number(env.FEEDBACK_EMBEDDING_DIMENSIONS) || 1536} AND e."templateVersion"=${TEMPLATE_VERSION}
    LEFT JOIN "FeedbackObservationEmbedding" v ON v."observationId"=e."observationId" AND v.provider=e.provider
      AND v.model=e.model AND v."modelVersion"=e."modelVersion" AND v.dimensions=e.dimensions
      AND v."templateVersion"=e."templateVersion" AND v."sourceHash"=e."sourceHash"
    WHERE ${scope(o, before)}`);
  counts.missingEmbeddingJobs = embeddings.missing;
  counts.pendingEmbeddingOperations = embeddings.pending;
  counts.failedEmbeddings = embeddings.failed + embeddings.incomplete;
  const [privacyReport] = await db.$queryRaw<
    {
      total: number;
      awaitingApproval: number;
      withoutNewPrivatePermission: number;
      legacyBothTrue: number;
      publicOptIns: number;
    }[]
  >(Prisma.sql`
    SELECT count(*)::int AS total,
     count(*) FILTER(WHERE f."approvalRequired" AND f."approvedAt" IS NULL)::int AS "awaitingApproval",
     count(*) FILTER(WHERE NOT f."privateAnalyticsAllowed" OR NOT f."privateCoachingAllowed" OR f."privacyNoticeVersion" IS DISTINCT FROM 'feedback-privacy-v1')::int AS "withoutNewPrivatePermission",
     count(*) FILTER(WHERE f."analyticsAllowed" AND f."evidenceAllowed")::int AS "legacyBothTrue",
     count(*) FILTER(WHERE f."publicAnalyticsAllowed")::int AS "publicOptIns"
    FROM "Feedback" f WHERE ${scope(o, before)}`);
  return {
    counts,
    privacyReport,
    trustCounts,
    sourceCharacterCount: sourceCharacters,
    estimatedCost: {
      currency: "USD",
      extraction: env.FEEDBACK_ESTIMATED_EXTRACTION_USD_PER_REVIEW
        ? counts.needsExtraction *
          Number(env.FEEDBACK_ESTIMATED_EXTRACTION_USD_PER_REVIEW)
        : null,
      embeddingMaximum: env.FEEDBACK_ESTIMATED_EMBEDDING_USD_PER_OBSERVATION
        ? (embeddings.missing +
            embeddings.pending +
            embeddings.incomplete +
            counts.needsExtraction * 50) *
          Number(env.FEEDBACK_ESTIMATED_EMBEDDING_USD_PER_OBSERVATION)
        : null,
      note: "Operator-provided per-operation budget estimates, not provider prices or a spending limit; null means unconfigured. Actual extraction usage is recorded in FeedbackExtractionRun and embedding request attempts in FeedbackEmbeddingJob.",
    },
    estimatedOperations: {
      llmRequests: {
        minimum: counts.needsExtraction,
        immediateValidationRetryMaximum: counts.needsExtraction * 2,
      },
      embeddingRequests: {
        known: embeddings.missing + embeddings.pending + embeddings.incomplete,
        newObservationRange: [0, counts.needsExtraction * 50],
      },
      note: "Estimates exclude future durable retries (up to five job attempts), concurrent edits, and AI Coach chat. One embedding request per observation; extraction may yield zero. Failed jobs require explicit retry. No paid calls during preview.",
    },
  };
}

export async function enqueueHistorical(
  db: PrismaClient,
  o: Options,
  before: Date,
  env: NodeJS.ProcessEnv,
) {
  let cursor: string | null = null,
    queued = 0;
  do {
    const ids: { id: string }[] = await db.$queryRaw<
      { id: string }[]
    >(Prisma.sql`SELECT f.id FROM "AnalysisEligibleFeedback" f
      WHERE ${scope(o, before)} AND EXISTS (SELECT 1 FROM "Feedback" af WHERE af.id=f.id AND feedback_analysis_eligible(af)) AND (${cursor}::uuid IS NULL OR f.id>${cursor}::uuid) ORDER BY f.id LIMIT ${o.batchSize}`);
    if (!ids.length) break;
    for (const { id } of ids)
      await db.$transaction(async (tx) => {
        // Same lock order as source edits and the existing worker.
        await tx.$queryRaw`SELECT id FROM "Feedback" WHERE id=${id}::uuid FOR UPDATE`;
        const live =
          await tx.$queryRaw`SELECT id FROM "AnalysisEligibleFeedback" WHERE id=${id}::uuid`;
        if (!(live as unknown[]).length) return;
        const row = await tx.feedback.findUniqueOrThrow({
          where: { id },
          include: { ratings: true, analysisJob: true },
        });
        const j = row.analysisJob,
          sources = feedbackSources(row);
        await tx.playerFeedbackAnalysisProfile.upsert({
          where: {
            userId_sportId: { userId: row.recipientId, sportId: row.sportId },
          },
          create: { userId: row.recipientId, sportId: row.sportId },
          update: {},
        });
        if (
          !sources.length ||
          (j && ["PENDING", "PROCESSING", "FAILED"].includes(j.status))
        )
          return;
        if (
          j?.status === "COMPLETED" &&
          j.sourceHash === hash(sources) &&
          j.provider === "openai" &&
          j.modelVersion === env.FEEDBACK_EXTRACTION_MODEL &&
          j.promptVersion === PROMPT_VERSION
        )
          return;
        await tx.$queryRaw`SELECT count(queue_feedback_analysis(${id}::uuid))::int AS queued`;
        queued++;
      });
    cursor = ids[ids.length - 1].id;
    if (!o.all && queued >= o.batchSize) break;
  } while (true);
  return queued;
}
