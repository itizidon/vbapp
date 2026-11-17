import {
  Prisma,
  PrismaClient,
  FeedbackAnalysisJob,
  FeedbackEmbeddingJob,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  Embedder,
  Extractor,
  PROMPT_VERSION,
  TEMPLATE_VERSION,
  ProcessingError,
  ExtractionInput,
  embeddingDocument,
  hash,
  validateExtraction,
  validateVector,
  feedbackSources,
} from "./contracts";

const MAX_ATTEMPTS = 5;
const backoff = (attempts: number) =>
  new Date(Date.now() + Math.min(3600, 15 * 2 ** (attempts - 1)) * 1000);
const errorInfo = (e: unknown) =>
  e instanceof ProcessingError ? e : new ProcessingError("PROCESSING_FAILED");

export class FeedbackProcessingWorker {
  constructor(
    readonly db: PrismaClient,
    readonly extractor: Extractor | null,
    readonly embedder: Embedder,
    readonly scope: { playerId?: string; before?: Date } = {},
  ) {}

  private scopeSql(alias: string) {
    const a = Prisma.raw(alias);
    return Prisma.sql`(${this.scope.playerId ?? null}::uuid IS NULL OR ${a}."recipientId"=${this.scope.playerId ?? null}::uuid)
      AND (${this.scope.before ?? null}::timestamptz IS NULL OR ${a}."createdAt"<=${this.scope.before ?? null})`;
  }

  async extractOne(): Promise<boolean> {
    const extractor = this.extractor;
    if (!extractor) throw new Error("Extraction provider is required");
    const token = randomUUID();
    await this.db.feedbackAnalysisJob.updateMany({
      where: {
        feedback: {
          ...(this.scope.playerId ? { recipientId: this.scope.playerId } : {}),
          ...(this.scope.before
            ? { createdAt: { lte: this.scope.before } }
            : {}),
        },
        status: "PROCESSING",
        leaseUntil: { lt: new Date() },
        attempts: { gte: MAX_ATTEMPTS },
      },
      data: {
        status: "FAILED",
        errorCode: "LEASE_RETRIES_EXHAUSTED",
        leaseToken: null,
        leaseUntil: null,
      },
    });
    const [job] = await this.db.$queryRaw<FeedbackAnalysisJob[]>`
      UPDATE "FeedbackAnalysisJob" j SET status='PROCESSING', attempts=j.attempts+1,
      "leaseToken"=${token}::uuid,"leaseUntil"=CURRENT_TIMESTAMP+interval '5 minutes',"updatedAt"=CURRENT_TIMESTAMP
      WHERE j."feedbackId"=(SELECT q."feedbackId" FROM "FeedbackAnalysisJob" q
        JOIN "AnalysisEligibleFeedback" f ON f.id=q."feedbackId"
        WHERE ${this.scopeSql("f")} AND EXISTS (SELECT 1 FROM "Feedback" af WHERE af.id=f.id AND feedback_analysis_eligible(af)) AND ((q.status='PENDING' AND q."runAfter"<=CURRENT_TIMESTAMP)
           OR (q.status='PROCESSING' AND q."leaseUntil"<CURRENT_TIMESTAMP))
        ORDER BY q."runAfter" FOR UPDATE OF q SKIP LOCKED LIMIT 1) RETURNING j.*`;
    if (!job) return false;
    let runId: string | undefined;
    let apiAttempts = 0,
      inputTokens = 0,
      outputTokens = 0;
    try {
      const source = await this.db.feedback.findUnique({
        where: { id: job.feedbackId },
        include: {
          ratings: { orderBy: { skillId: "asc" } },
          sport: { include: { skills: { where: { active: true } } } },
        },
      });
      if (!source) return true;
      const [{ eligible }] = await this.db.$queryRaw<{ eligible: boolean }[]>`
        SELECT feedback_analysis_eligible(f) AS eligible FROM "Feedback" f WHERE id=${source.id}::uuid`;
      if (!eligible) {
        await this.discard(job, token);
        return true;
      }
      const themes = await this.db.feedbackTheme.findMany({
        where: { active: true },
        orderBy: { id: "asc" },
      });
      const input: ExtractionInput = {
        sources: feedbackSources(source),
        themes: themes.map((t) => ({
          id: t.id,
          name: t.name,
          skillSlugs: t.skillSlugs,
        })),
        skillSlugs: source.sport.skills.map((s) => s.slug),
      };
      const sourceHash = hash(input.sources);
      const run = await this.db.$transaction(async (tx) => {
        const current = await tx.$queryRaw<
          { feedbackId: string }[]
        >`SELECT "feedbackId" FROM "FeedbackAnalysisJob"
          WHERE "feedbackId"=${job.feedbackId}::uuid AND generation=${job.generation}
          AND "leaseToken"=${token}::uuid AND "leaseUntil">CURRENT_TIMESTAMP FOR UPDATE`;
        if (!current.length) return null;
        await tx.feedbackExtractionRun.updateMany({
          where: { feedbackId: job.feedbackId, status: "STARTED" },
          data: {
            status: "DISCARDED",
            errorCode: "LEASE_RECLAIMED",
            finishedAt: new Date(),
          },
        });
        return tx.feedbackExtractionRun.create({
          data: {
            feedbackId: job.feedbackId,
            generation: job.generation,
            provider: extractor.provider,
            modelVersion: extractor.modelVersion,
            promptVersion: PROMPT_VERSION,
            sourceHash,
          },
        });
      });
      if (!run) return true;
      runId = run.id;
      if (input.sources.reduce((n, s) => n + s.text.length, 0) > 24000)
        throw new ProcessingError("SOURCE_TOO_LARGE", false);
      let output = validateExtraction(
        { moderation: "ALLOW", observations: [] },
        input,
      );
      if (input.sources.length) {
        for (let attempt = 0; attempt < 2; attempt++) {
          apiAttempts++;
          try {
            const response = await extractor.extract(input);
            inputTokens += response.inputTokens;
            outputTokens += response.outputTokens;
            output = validateExtraction(response.value, input);
            break;
          } catch (e) {
            const error = errorInfo(e);
            if (
              attempt === 0 &&
              [
                "INVALID_EXTRACTION",
                "INVALID_EVIDENCE",
                "INVALID_SKILL",
                "INVALID_THEME_SKILL",
                "INCOMPLETE_EXTRACTION",
              ].includes(error.code)
            )
              continue;
            if (
              [
                "INVALID_EXTRACTION",
                "INVALID_EVIDENCE",
                "INVALID_SKILL",
                "INVALID_THEME_SKILL",
                "INCOMPLETE_EXTRACTION",
              ].includes(error.code)
            )
              throw new ProcessingError(error.code, false);
            throw error;
          }
        }
      }
      await this.db.$transaction(async (tx) => {
        // Source writes take this same row lock before invalidating jobs and observations.
        await tx.$queryRaw`SELECT id FROM "Feedback" WHERE id=${job.feedbackId}::uuid FOR UPDATE`;
        const locked = await tx.$queryRaw<
          FeedbackAnalysisJob[]
        >`SELECT * FROM "FeedbackAnalysisJob"
          WHERE "feedbackId"=${job.feedbackId}::uuid AND generation=${job.generation}
            AND "leaseToken"=${token}::uuid AND "leaseUntil">CURRENT_TIMESTAMP FOR UPDATE`;
        if (!locked.length) {
          await tx.feedbackExtractionRun.update({
            where: { id: run.id },
            data: {
              status: "DISCARDED",
              apiAttempts,
              inputTokens,
              outputTokens,
              finishedAt: new Date(),
            },
          });
          return;
        }
        const check = await tx.$queryRaw<
          { eligible: boolean }[]
        >`SELECT feedback_analysis_eligible(f) AS eligible FROM "Feedback" f WHERE id=${job.feedbackId}::uuid`;
        if (
          !check[0]?.eligible ||
          !["ALLOW", "UNASSESSED"].includes(locked[0].moderation)
        )
          throw new ProcessingError("INELIGIBLE", false);
        await tx.feedbackObservation.deleteMany({
          where: { feedbackId: job.feedbackId },
        });
        if (output.moderation === "ALLOW") {
          for (const row of output.observations) {
            const observation = await tx.feedbackObservation.create({
              data: {
                feedbackId: job.feedbackId,
                generation: job.generation,
                sourceKey: row.sourceKey,
                skillId: row.skill
                  ? source.sport.skills.find((s) => s.slug === row.skill)!.id
                  : null,
                themeId: row.theme,
                sentiment: row.sentiment,
                evidence: row.evidence,
                fingerprint: hash(row),
                sourceHash,
                provider: extractor.provider,
                modelVersion: extractor.modelVersion,
                promptVersion: PROMPT_VERSION,
                feedbackCreatedAt: source.createdAt,
              },
              include: { skill: true, theme: true },
            });
            await this.enqueueEmbedding(tx, observation);
          }
        }
        await tx.feedbackAnalysisJob.update({
          where: { feedbackId: job.feedbackId },
          data: {
            status: output.moderation === "ALLOW" ? "COMPLETED" : "SKIPPED",
            moderation: output.moderation,
            sourceHash,
            provider: extractor.provider,
            modelVersion: extractor.modelVersion,
            promptVersion: PROMPT_VERSION,
            processedAt: new Date(),
            leaseToken: null,
            leaseUntil: null,
            errorCode: null,
          },
        });
        await tx.feedbackExtractionRun.update({
          where: { id: run.id },
          data: {
            status: "COMPLETED",
            moderation: output.moderation,
            unknownThemes: output.unknownThemes,
            apiAttempts,
            inputTokens,
            outputTokens,
            finishedAt: new Date(),
          },
        });
        await tx.$executeRaw`SELECT invalidate_feedback_profile(${source.recipientId}::uuid,${source.sportId}::uuid)`;
      });
    } catch (e) {
      const error = errorInfo(e);
      const changed = await this.db.feedbackAnalysisJob.updateMany({
        where: {
          feedbackId: job.feedbackId,
          generation: job.generation,
          leaseToken: token,
        },
        data: {
          status:
            error.retryable && job.attempts < MAX_ATTEMPTS
              ? "PENDING"
              : "FAILED",
          errorCode: error.code,
          leaseToken: null,
          leaseUntil: null,
          runAfter: backoff(job.attempts),
        },
      });
      if (runId)
        await this.db.feedbackExtractionRun.updateMany({
          where: { id: runId },
          data: {
            status: changed.count ? "FAILED" : "DISCARDED",
            errorCode: error.code,
            apiAttempts,
            inputTokens,
            outputTokens,
            finishedAt: new Date(),
          },
        });
    }
    return true;
  }

  private async discard(job: FeedbackAnalysisJob, token: string) {
    await this.db.feedbackAnalysisJob.updateMany({
      where: {
        feedbackId: job.feedbackId,
        generation: job.generation,
        leaseToken: token,
      },
      data: {
        status: "SKIPPED",
        leaseToken: null,
        leaseUntil: null,
        errorCode: "INELIGIBLE",
      },
    });
  }

  private embeddingKey(observationId: string) {
    return {
      observationId,
      provider: this.embedder.provider,
      model: this.embedder.model,
      modelVersion: this.embedder.modelVersion,
      dimensions: this.embedder.dimensions,
      templateVersion: TEMPLATE_VERSION,
    };
  }
  private async enqueueEmbedding(
    tx: Prisma.TransactionClient,
    row: Parameters<typeof embeddingDocument>[0] & { id: string },
  ) {
    const data = {
      ...this.embeddingKey(row.id),
      sourceHash: hash(embeddingDocument(row)),
    };
    await tx.feedbackEmbeddingJob.upsert({
      where: {
        observationId_provider_model_modelVersion_dimensions_templateVersion:
          this.embeddingKey(row.id),
      },
      create: data,
      update: {},
    });
    // Repair a completed job whose vector was removed; preserve active leases and failed jobs.
    await tx.$executeRaw`UPDATE "FeedbackEmbeddingJob" e SET status='PENDING',attempts=0,
      "runAfter"=CURRENT_TIMESTAMP,"errorCode"=NULL,"sourceHash"=${data.sourceHash},"updatedAt"=CURRENT_TIMESTAMP
      WHERE e."observationId"=${row.id}::uuid AND e.provider=${data.provider} AND e.model=${data.model}
        AND e."modelVersion"=${data.modelVersion} AND e.dimensions=${data.dimensions} AND e."templateVersion"=${data.templateVersion}
        AND e.status='COMPLETED' AND NOT EXISTS (SELECT 1 FROM "FeedbackObservationEmbedding" v
          WHERE v."observationId"=e."observationId" AND v.provider=e.provider AND v.model=e.model
            AND v."modelVersion"=e."modelVersion" AND v.dimensions=e.dimensions AND v."templateVersion"=e."templateVersion"
            AND v."sourceHash"=e."sourceHash")`;
  }
  async enqueueEmbeddings(limit = 100) {
    // Explicit maintenance, independent of extraction; repeat calls advance past existing versions.
    const ids = await this.db.$queryRaw<
      { id: string }[]
    >`SELECT o.id FROM "EligibleFeedbackObservation" o
      JOIN "AnalysisEligibleFeedback" f ON f.id=o."feedbackId"
      WHERE ${this.scopeSql("f")} AND NOT EXISTS (SELECT 1 FROM "FeedbackEmbeddingJob" e WHERE e."observationId"=o.id
        AND e.provider=${this.embedder.provider} AND e.model=${this.embedder.model}
        AND e."modelVersion"=${this.embedder.modelVersion} AND e.dimensions=${this.embedder.dimensions}
        AND e."templateVersion"=${TEMPLATE_VERSION}
        AND (e.status<>'COMPLETED' OR EXISTS (SELECT 1 FROM "FeedbackObservationEmbedding" v
          WHERE v."observationId"=e."observationId" AND v.provider=e.provider AND v.model=e.model
            AND v."modelVersion"=e."modelVersion" AND v.dimensions=e.dimensions AND v."templateVersion"=e."templateVersion"
            AND v."sourceHash"=e."sourceHash"))) ORDER BY o.id LIMIT ${limit}`;
    for (const { id } of ids) {
      await this.db.$transaction(async (tx) => {
        const [source] = await tx.$queryRaw<
          { feedbackId: string }[]
        >`SELECT "feedbackId" FROM "FeedbackObservation" WHERE id=${id}::uuid`;
        if (!source) return;
        await tx.$queryRaw`SELECT id FROM "Feedback" WHERE id=${source.feedbackId}::uuid FOR UPDATE`;
        const live =
          await tx.$queryRaw`SELECT id FROM "EligibleFeedbackObservation" WHERE id=${id}::uuid`;
        if (!(live as unknown[]).length) return;
        const row = await tx.feedbackObservation.findUnique({
          where: { id },
          include: { theme: true, skill: true },
        });
        if (row) await this.enqueueEmbedding(tx, row);
      });
    }
    return ids.length;
  }

  async embedOne(): Promise<boolean> {
    const token = randomUUID();
    await this.db.feedbackEmbeddingJob.updateMany({
      where: {
        observation: {
          job: {
            feedback: {
              ...(this.scope.playerId
                ? { recipientId: this.scope.playerId }
                : {}),
              ...(this.scope.before
                ? { createdAt: { lte: this.scope.before } }
                : {}),
            },
          },
        },
        status: "PROCESSING",
        leaseUntil: { lt: new Date() },
        attempts: { gte: MAX_ATTEMPTS },
      },
      data: {
        status: "FAILED",
        errorCode: "LEASE_RETRIES_EXHAUSTED",
        leaseToken: null,
        leaseUntil: null,
      },
    });
    const [job] = await this.db.$queryRaw<FeedbackEmbeddingJob[]>`
      UPDATE "FeedbackEmbeddingJob" e SET status='PROCESSING',attempts=e.attempts+1,
        "leaseToken"=${token}::uuid,"leaseUntil"=CURRENT_TIMESTAMP+interval '5 minutes',"updatedAt"=CURRENT_TIMESTAMP
      WHERE (e."observationId",e.provider,e.model,e."modelVersion",e.dimensions,e."templateVersion") IN (
        SELECT q."observationId",q.provider,q.model,q."modelVersion",q.dimensions,q."templateVersion" FROM "FeedbackEmbeddingJob" q
        JOIN "EligibleFeedbackObservation" o ON o.id=q."observationId"
        JOIN "AnalysisEligibleFeedback" f ON f.id=o."feedbackId"
        WHERE ${this.scopeSql("f")} AND q.provider=${this.embedder.provider} AND q.model=${this.embedder.model}
          AND q."modelVersion"=${this.embedder.modelVersion} AND q.dimensions=${this.embedder.dimensions}
          AND q."templateVersion"=${TEMPLATE_VERSION}
          AND ((q.status='PENDING' AND q."runAfter"<=CURRENT_TIMESTAMP) OR (q.status='PROCESSING' AND q."leaseUntil"<CURRENT_TIMESTAMP))
        ORDER BY q."runAfter" FOR UPDATE OF q SKIP LOCKED LIMIT 1) RETURNING e.*`;
    if (!job) return false;
    try {
      const row = await this.db.feedbackObservation.findUnique({
        where: { id: job.observationId },
        include: { skill: true, theme: true },
      });
      if (!row) return true;
      const document = embeddingDocument(row);
      if (hash(document) !== job.sourceHash)
        throw new ProcessingError("EMBEDDING_SOURCE_CHANGED", false);
      const vector = validateVector(
        await this.embedder.embed(document),
        job.dimensions,
      );
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Feedback" WHERE id=${row.feedbackId}::uuid FOR UPDATE`;
        const valid = await tx.$queryRaw<
          { id: string }[]
        >`SELECT o.id FROM "EligibleFeedbackObservation" o
          JOIN "FeedbackEmbeddingJob" e ON e."observationId"=o.id
          WHERE o.id=${row.id}::uuid AND e."leaseToken"=${token}::uuid
            AND e."leaseUntil">CURRENT_TIMESTAMP AND e."sourceHash"=${job.sourceHash} FOR UPDATE OF e`;
        if (!valid.length) return;
        await tx.$executeRaw`INSERT INTO "FeedbackObservationEmbedding"
          ("observationId",provider,model,"modelVersion",dimensions,"templateVersion","sourceHash",vector)
          VALUES (${row.id}::uuid,${job.provider},${job.model},${job.modelVersion},${job.dimensions},${job.templateVersion},${job.sourceHash},${JSON.stringify(vector)}::vector)
          ON CONFLICT ("observationId",provider,model,"modelVersion",dimensions,"templateVersion")
          DO UPDATE SET vector=EXCLUDED.vector,"sourceHash"=EXCLUDED."sourceHash","createdAt"=CURRENT_TIMESTAMP`;
        await tx.feedbackEmbeddingJob.updateMany({
          where: { observationId: row.id, leaseToken: token },
          data: {
            status: "COMPLETED",
            leaseToken: null,
            leaseUntil: null,
            errorCode: null,
          },
        });
      });
    } catch (e) {
      const error = errorInfo(e);
      await this.db.feedbackEmbeddingJob.updateMany({
        where: { observationId: job.observationId, leaseToken: token },
        data: {
          status:
            error.retryable && job.attempts < MAX_ATTEMPTS
              ? "PENDING"
              : "FAILED",
          errorCode: error.code,
          leaseToken: null,
          leaseUntil: null,
          runAfter: backoff(job.attempts),
        },
      });
    }
    return true;
  }
}
