import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  HttpException,
} from "@nestjs/common";
import { isUUID } from "class-validator";
import {
  Prisma,
  AiCoachTurn,
  PlayerFeedbackAnalysisProfile,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { FeedbackAnalysisService } from "../feedback-analysis/service";
import { FeedbackAnalysisProfile } from "../feedback-analysis/models";
import { cachedProfileReady } from "../feedback-processing/profiles";
import { CoachEngine, CoachRun } from "./engine";
import { CoachOpenAI } from "./provider";
import { CoachTools } from "./tools";
import { coachConfig, CoachConfig } from "./config";
import { AskAiCoachInput, CoachMessageModel, CoachMessagePage } from "./models";
import {
  coachAnswerSchema,
  CoachFailure,
  CoachUsage,
  safeMessages,
} from "./contracts";
import {
  CoachAnswer,
  fallbackAnswer,
  observationFact,
  profileFacts,
  renderDraft,
  validateDraft,
} from "./facts";
import { COACH_PROMPT_VERSION } from "./prompts/bvbtips-coach-v2";
const DAY = 86400000;
@Injectable()
export class AiCoachService {
  constructor(
    private readonly db: PrismaService,
    private readonly analytics: FeedbackAnalysisService,
    private readonly engine: CoachEngine,
    private readonly api: CoachOpenAI,
    private readonly tools: CoachTools,
  ) {}
  private config() {
    try {
      return coachConfig();
    } catch {
      throw new ServiceUnavailableException(safeMessages.CONFIG);
    }
  }
  private async conversation(actorId: string, id: string) {
    if (!isUUID(id)) throw new BadRequestException("Invalid conversation ID");
    const row = await this.db.aiCoachConversation.findFirst({
      where: { id, userId: actorId, expiresAt: { gt: new Date() } },
    });
    if (!row) throw new NotFoundException("Conversation not found");
    return row;
  }
  async conversations(actorId: string, sportId: string) {
    if (!isUUID(sportId)) throw new BadRequestException("Invalid sport ID");
    try {
      const rows = await this.db.aiCoachConversation.findMany({
        where: { userId: actorId, sportId, expiresAt: { gt: new Date() } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 20,
        select: { id: true, title: true, updatedAt: true },
      });
      return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
    } catch {
      throw new ServiceUnavailableException(
        "Conversation history is temporarily unavailable.",
      );
    }
  }
  private async verifiedMessages(
    actorId: string,
    sportId: string,
    rows: AiCoachTurn[],
  ): Promise<CoachMessageModel[]> {
    const analysis = await this.analytics.get(actorId, sportId);
    const cache = await this.db.playerFeedbackAnalysisProfile.findUnique({
      where: { userId_sportId: { userId: actorId, sportId } },
    });
    const profile = analysis.profile;
    const ids = new Set<string>();
    for (const row of rows) {
      const parsed = coachAnswerSchema.safeParse(row.response);
      if (parsed.success)
        for (const evidence of parsed.data.evidence)
          for (const id of evidence.feedbackIds) ids.add(id);
    }
    const authorized = ids.size
      ? await this.db.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM "AnalysisEligibleFeedback" WHERE "recipientId"=${actorId}::uuid AND "sportId"=${sportId}::uuid AND id IN (${Prisma.join([...ids].map((id) => Prisma.sql`${id}::uuid`))})`,
        )
      : [];
    const allowed = new Set(authorized.map((row) => row.id));
    return rows.map((row) => {
      let response: CoachAnswer;
      if (row.status === "PENDING") response = fallbackAnswer("BUSY");
      else if (row.errorCode)
        response = fallbackAnswer(
          row.errorCode === "NO_FEEDBACK" &&
            row.sourceRevision !== cache?.revision
            ? "OUTDATED"
            : row.errorCode,
        );
      else if (
        !profile ||
        !cache ||
        !cachedProfileReady(cache) ||
        row.sourceRevision !== cache.revision
      )
        response = fallbackAnswer("OUTDATED");
      else {
        const parsed = coachAnswerSchema.safeParse(row.response);
        response =
          parsed.success &&
          parsed.data.evidence.every((e) =>
            e.feedbackIds.every((id) => allowed.has(id)),
          )
            ? parsed.data
            : fallbackAnswer("OUTDATED");
      }
      return {
        id: row.id,
        conversationId: row.conversationId,
        question: row.question,
        startedAt: row.startedAt.toISOString(),
        sourceAsOf: row.sourceAsOf,
        status: row.status,
        response,
        model: row.model,
        promptVersion: row.promptVersion,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      };
    });
  }
  async messages(
    actorId: string,
    conversationId: string,
    cursor?: string,
  ): Promise<CoachMessagePage> {
    const conversation = await this.conversation(actorId, conversationId);
    let anchor: AiCoachTurn | null = null;
    if (cursor) {
      if (!isUUID(cursor))
        throw new BadRequestException("Invalid message cursor");
      anchor = await this.db.aiCoachTurn.findFirst({
        where: { id: cursor, userId: actorId, conversationId },
      });
      if (!anchor) throw new NotFoundException("Message not found");
    }
    try {
      const rows = await this.db.aiCoachTurn.findMany({
        where: {
          userId: actorId,
          conversationId,
          ...(anchor
            ? {
                OR: [
                  { startedAt: { lt: anchor.startedAt } },
                  { startedAt: anchor.startedAt, id: { lt: anchor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: 21,
      });
      const more = rows.length > 20;
      if (more) rows.pop();
      const nextCursor = more ? rows[rows.length - 1].id : null;
      return {
        messages: await this.verifiedMessages(
          actorId,
          conversation.sportId,
          rows.reverse(),
        ),
        nextCursor,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Conversation history is temporarily unavailable.",
      );
    }
  }
  private async reserve(
    actorId: string,
    input: AskAiCoachInput,
    config: CoachConfig,
  ) {
    const now = new Date(),
      day = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          input.question,
          input.sportId,
          input.conversationId ?? null,
        ]),
      )
      .digest("hex");
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(73011423,hashtext(${actorId}))`;
        const previous = await tx.aiCoachTurn.findUnique({
          where: {
            userId_clientRequestId: {
              userId: actorId,
              clientRequestId: input.clientRequestId,
            },
          },
          include: { conversation: true },
        });
        if (previous) {
          if (previous.requestHash !== hash)
            throw new ConflictException(
              "Request ID was already used for another question",
            );
          if (previous.conversation.expiresAt <= now)
            throw new NotFoundException("Conversation expired");
          if (
            previous.status === "PENDING" &&
            previous.startedAt.getTime() < now.getTime() - config.timeoutMs * 2
          ) {
            const expired = await tx.aiCoachTurn.update({
              where: { id: previous.id },
              data: {
                status: "FAILED",
                errorCode: "TIMEOUT",
                completedAt: now,
              },
            });
            return { turn: expired, replay: true, day };
          }
          return { turn: previous, replay: true, day };
        }
        let conversation = input.conversationId
          ? await tx.aiCoachConversation.findFirst({
              where: {
                id: input.conversationId,
                userId: actorId,
                sportId: input.sportId,
                expiresAt: { gt: now },
              },
            })
          : null;
        if (input.conversationId && !conversation)
          throw new NotFoundException("Conversation not found");
        await tx.aiCoachTurn.updateMany({
          where: {
            userId: actorId,
            status: "PENDING",
            startedAt: { lt: new Date(now.getTime() - config.timeoutMs * 2) },
          },
          data: { status: "FAILED", errorCode: "TIMEOUT", completedAt: now },
        });
        const active = await tx.aiCoachTurn.count({
          where: { userId: actorId, status: "PENDING" },
        });
        if (active) throw new ConflictException(safeMessages.BUSY);
        const recent = await tx.aiCoachTurn.count({
          where: {
            userId: actorId,
            startedAt: { gte: new Date(now.getTime() - 60000) },
          },
        });
        if (recent >= config.requestsPerMinute)
          throw new HttpException(safeMessages.RATE_LIMITED, 429);
        const usage = await tx.aiCoachUsage.upsert({
          where: { userId_day: { userId: actorId, day } },
          create: { userId: actorId, day },
          update: {},
        });
        if (
          usage.requests >= config.dailyRequests ||
          usage.spentTokens + usage.reservedTokens + config.maxTotalTokens >
            config.dailyTokens
        )
          throw new HttpException(safeMessages.RATE_LIMITED, 429);
        await tx.aiCoachUsage.update({
          where: { userId_day: { userId: actorId, day } },
          data: {
            requests: { increment: 1 },
            reservedTokens: { increment: config.maxTotalTokens },
          },
        });
        if (!conversation)
          conversation = await tx.aiCoachConversation.create({
            data: {
              userId: actorId,
              sportId: input.sportId,
              title: input.question.slice(0, 80),
              expiresAt: new Date(now.getTime() + config.retentionDays * DAY),
            },
          });
        const turn = await tx.aiCoachTurn.create({
          data: {
            userId: actorId,
            conversationId: conversation.id,
            clientRequestId: input.clientRequestId,
            requestHash: hash,
            question: input.question,
            promptVersion: COACH_PROMPT_VERSION,
          },
        });
        return { turn, replay: false, day };
      },
      { timeout: 5000, maxWait: 2000 },
    );
  }
  async ask(
    actorId: string,
    input: AskAiCoachInput,
  ): Promise<CoachMessageModel> {
    const config = this.config();
    if (
      !isUUID(input.sportId) ||
      !isUUID(input.clientRequestId) ||
      (input.conversationId && !isUUID(input.conversationId)) ||
      typeof input.question !== "string" ||
      !input.question.trim() ||
      input.question.length > config.maxQuestionLength
    )
      throw new BadRequestException(
        "Enter a volleyball question of up to " +
          config.maxQuestionLength +
          " characters.",
      );
    input = { ...input, question: input.question.trim() };
    const owner = await this.db.user.findUnique({
      where: { id: actorId },
      select: { aiCoachingEnabled: true },
    });
    if (!owner?.aiCoachingEnabled)
      throw new ForbiddenException(
        "Private AI coaching is disabled in your account privacy settings",
      );
    const sport = await this.db.sport.findFirst({
      where: {
        id: input.sportId,
        slug: { in: ["volleyball", "beach-volleyball"] },
      },
      select: { id: true },
    });
    if (!sport) throw new BadRequestException("Volleyball sport not found");
    let reservation: Awaited<ReturnType<AiCoachService["reserve"]>>;
    try {
      reservation = await this.reserve(actorId, input, config);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Unable to prepare the coaching request.",
      );
    }
    const { turn, day } = reservation;
    if (reservation.replay)
      return (await this.verifiedMessages(actorId, input.sportId, [turn]))[0];
    const started = Date.now(),
      controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let progress: CoachUsage = {
      inputTokens: 0,
      outputTokens: 0,
      model: null,
      trace: [],
      chargeFullBudget: false,
    };
    let sourceAsOf: string | null = null;
    let run: CoachRun | undefined,
      revision: number | null = null,
      errorCode: string | null = null,
      answer: CoachAnswer;
    try {
      const analysis = await this.analytics.get(actorId, input.sportId);
      const cache = await this.db.playerFeedbackAnalysisProfile.findUnique({
        where: { userId_sportId: { userId: actorId, sportId: input.sportId } },
      });
      if (!analysis.profile || !cache || !cachedProfileReady(cache))
        throw new CoachFailure("PROFILE_PENDING", safeMessages.PROFILE_PENDING);
      revision = cache.revision;
      sourceAsOf = analysis.profile.asOf;
      if (!analysis.profile.totalEligibleFeedbackCount)
        throw new CoachFailure("NO_FEEDBACK", safeMessages.NO_FEEDBACK);
      if (!this.api.configured() || !config.model)
        throw new CoachFailure("CONFIG", safeMessages.CONFIG);
      const previous = await this.db.aiCoachTurn.findMany({
        where: {
          userId: actorId,
          conversationId: turn.conversationId,
          id: { not: turn.id },
          status: "COMPLETED",
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: 4,
      });
      const prior = await this.verifiedMessages(
        actorId,
        input.sportId,
        previous.reverse(),
      );
      const timeout = new Promise<never>((_, reject) =>
        controller.signal.addEventListener(
          "abort",
          () => reject(new CoachFailure("TIMEOUT", safeMessages.TIMEOUT)),
          { once: true },
        ),
      );
      run = await Promise.race([
        this.engine.run(
          actorId,
          input.sportId,
          input.question,
          analysis.profile,
          prior
            .filter((p) => p.response.status === "ANSWERED")
            .map((p) => ({
              question: p.question,
              message: `Historical answer as of ${p.sourceAsOf ?? p.startedAt}: ${p.response.message}`,
            })),
          config,
          controller.signal,
          (stats) => {
            progress = stats;
          },
          async () => {
            const latest =
              await this.db.playerFeedbackAnalysisProfile.findUnique({
                where: {
                  userId_sportId: { userId: actorId, sportId: input.sportId },
                },
              });
            if (
              !latest ||
              !cachedProfileReady(latest) ||
              latest.revision !== revision ||
              (latest.data as unknown as { asOf?: string }).asOf !== sourceAsOf
            )
              throw new CoachFailure("OUTDATED", safeMessages.OUTDATED);
          },
        ),
        timeout,
      ]);
      const current = await this.db.playerFeedbackAnalysisProfile.findUnique({
        where: { userId_sportId: { userId: actorId, sportId: input.sportId } },
      });
      if (
        !current ||
        !cachedProfileReady(current) ||
        current.revision !== revision ||
        (current.data as unknown as { asOf?: string }).asOf !== sourceAsOf
      )
        throw new CoachFailure("OUTDATED", safeMessages.OUTDATED);
      answer = run.answer;
    } catch (error) {
      errorCode =
        error instanceof CoachFailure
          ? error.code
          : controller.signal.aborted
            ? "TIMEOUT"
            : "UNAVAILABLE";
      answer = fallbackAnswer(errorCode);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    try {
      const updated = await this.db.$transaction(async (tx) => {
        if (run && !errorCode) {
          const [locked] = await tx.$queryRaw<
            PlayerFeedbackAnalysisProfile[]
          >`SELECT * FROM "PlayerFeedbackAnalysisProfile"
            WHERE "userId"=${actorId}::uuid AND "sportId"=${input.sportId}::uuid FOR SHARE`;
          if (
            !locked ||
            !cachedProfileReady(locked) ||
            locked.revision !== revision ||
            (locked.data as unknown as { asOf?: string }).asOf !== sourceAsOf
          ) {
            errorCode = "OUTDATED";
            answer = fallbackAnswer("OUTDATED");
          }
        }
        const changed = await tx.aiCoachTurn.updateMany({
          where: { id: turn.id, userId: actorId, status: "PENDING" },
          data: {
            status: errorCode ? "FALLBACK" : "COMPLETED",
            response:
              run && !errorCode
                ? JSON.parse(JSON.stringify(answer))
                : Prisma.JsonNull,
            sourceRevision: revision,
            sourceAsOf,
            model: run?.model ?? progress.model,
            inputTokens: run?.inputTokens ?? progress.inputTokens,
            outputTokens: run?.outputTokens ?? progress.outputTokens,
            durationMs: Date.now() - started,
            toolTrace: JSON.parse(JSON.stringify(run?.trace ?? progress.trace)),
            errorCode,
            completedAt: new Date(),
          },
        });
        if (!changed.count) return false;
        const unknown =
          progress.chargeFullBudget ||
          (errorCode && ["TIMEOUT", "UNAVAILABLE"].includes(errorCode));
        await tx.aiCoachUsage.update({
          where: { userId_day: { userId: actorId, day } },
          data: {
            reservedTokens: { decrement: config.maxTotalTokens },
            spentTokens: {
              increment: unknown
                ? config.maxTotalTokens
                : (run?.inputTokens ?? progress.inputTokens) +
                  (run?.outputTokens ?? progress.outputTokens),
            },
          },
        });
        await tx.aiCoachConversation.update({
          where: { id: turn.conversationId },
          data: {
            updatedAt: new Date(),
          },
        });
        return true;
      });
      if (!updated) answer = fallbackAnswer("TIMEOUT");
    } catch {
      throw new ServiceUnavailableException(
        "Unable to save the coaching answer. Retry the same request.",
      );
    }
    return {
      id: turn.id,
      conversationId: turn.conversationId,
      question: turn.question,
      startedAt: turn.startedAt.toISOString(),
      sourceAsOf,
      status: errorCode ? "FALLBACK" : "COMPLETED",
      response: answer,
      model: run?.model ?? progress.model,
      promptVersion: COACH_PROMPT_VERSION,
      inputTokens: run?.inputTokens ?? progress.inputTokens,
      outputTokens: run?.outputTokens ?? progress.outputTokens,
    };
  }
}
