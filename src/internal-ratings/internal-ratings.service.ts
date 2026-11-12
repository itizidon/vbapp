import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  InternalRatingContribution,
  PlayerInternalRating,
  FeedbackStatus,
} from "@prisma/client";
import { isUUID } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import {
  ALGORITHM_VERSION,
  algorithmFromEnvironment,
  decimal,
} from "./algorithm";
import { ratingTransaction } from "./transaction";

@Injectable()
export class InternalRatingsService {
  readonly algorithm = algorithmFromEnvironment();
  constructor(private db: PrismaService) {}

  private async reviewerConfidence(
    tx: Prisma.TransactionClient,
    reviewerId: string,
    skillId: string,
  ) {
    const received = await tx.internalRatingContribution.findMany({
      where: {
        userId: reviewerId,
        skillId,
        eligible: true,
        published: true,
        reviewerId: { not: null },
        feedback: { status: "PUBLISHED" },
      },
      select: { reviewerId: true },
      distinct: ["reviewerId"],
    });
    const ids = received
      .map((r) => r.reviewerId!)
      .filter((id) => id !== reviewerId);
    const reciprocal = await tx.internalRatingContribution.findMany({
      where: {
        userId: { in: ids },
        reviewerId,
        skillId,
        published: true,
        feedback: { status: "PUBLISHED" },
      },
      select: { userId: true },
    });
    const excluded = new Set(reciprocal.map((r) => r.userId));
    return this.algorithm.confidence(
      ids.filter((id) => !excluded.has(id)).length,
    );
  }

  // Called only inside the same transaction which writes the source feedback.
  async syncFeedback(tx: Prisma.TransactionClient, feedbackId: string) {
    const feedback = await tx.feedback.findUniqueOrThrow({
      where: { id: feedbackId },
      include: { ratings: true },
    });
    if (feedback.reviewerId === feedback.recipientId)
      throw new BadRequestException("Self-feedback is not allowed");
    const old = await tx.internalRatingContribution.findMany({
      where: { feedbackId },
    });
    const keys = [
      ...new Set([
        ...old.map((r) => r.skillId),
        ...feedback.ratings.map((r) => r.skillId),
      ]),
    ].sort();
    for (const skillId of keys) {
      const current = await tx.playerInternalRating.findUnique({
        where: { userId_skillId: { userId: feedback.recipientId, skillId } },
      });
      // No guessed baseline, and no automatic replay of pre-initialization feedback.
      if (!current) continue;
      const skill = await tx.skill.findUniqueOrThrow({
        where: { id: skillId },
      });
      if (skill.sportId !== feedback.sportId)
        throw new BadRequestException("Rating skill belongs to another sport");
      const submitted = feedback.ratings.find((r) => r.skillId === skillId);
      const published =
        feedback.status === FeedbackStatus.PUBLISHED &&
        !!submitted &&
        skill.active;
      const existing = old.find((r) => r.skillId === skillId);
      if (existing) {
        if (
          existing.published === published &&
          (!submitted || existing.submittedRating === submitted.rating)
        )
          continue;
        await tx.internalRatingContribution.update({
          where: { id: existing.id },
          data: {
            published,
            ...(submitted ? { submittedRating: submitted.rating } : {}),
          },
        });
        await this.rebuild(tx, current, feedbackId);
      } else if (published && submitted) {
        const reviewerRating = feedback.reviewerId
          ? await tx.playerInternalRating.findUnique({
              where: {
                userId_skillId: { userId: feedback.reviewerId, skillId },
              },
            })
          : null;
        const confidence = feedback.reviewerId
          ? reviewerRating
            ? await this.reviewerConfidence(tx, feedback.reviewerId, skillId)
            : this.algorithm.parameters.confidence[0]
          : this.algorithm.parameters.guestConfidence;
        const influence = this.algorithm.influence(
          reviewerRating?.currentRating ?? null,
          confidence,
        );
        const contribution = await tx.internalRatingContribution.create({
          data: {
            feedbackId,
            userId: current.userId,
            skillId,
            reviewerId: feedback.reviewerId,
            reviewerInternalRating: reviewerRating?.currentRating ?? null,
            ...influence,
            confidence,
            submittedRating: submitted.rating,
            published: true,
            identityKey: feedback.reviewerId
              ? `user:${feedback.reviewerId}`
              : `guest:${feedback.guestInviteNonce ?? feedback.id}`,
            algorithmVersion: ALGORITHM_VERSION,
          },
        });
        const preceding = await tx.internalRatingContribution.findFirst({
          where: {
            userId: current.userId,
            skillId,
            identityKey: contribution.identityKey,
            published: true,
            effectiveAt: {
              gte: new Date(
                contribution.effectiveAt.toISOString().slice(0, 10) +
                  "T00:00:00Z",
              ),
              lt: new Date(
                new Date(
                  contribution.effectiveAt.toISOString().slice(0, 10) +
                    "T00:00:00Z",
                ).getTime() + 86400000,
              ),
            },
            sequence: { lt: contribution.sequence },
          },
        });
        if (preceding) continue;
        await tx.internalRatingContribution.update({
          where: { id: contribution.id },
          data: { eligible: true },
        });
        const result = this.algorithm.apply(
          current.currentRating,
          contribution.submittedRating,
          contribution.finalRate,
        );
        await this.writeApplication(
          tx,
          current,
          contribution,
          current.currentRating,
          result.next,
          result.delta,
          "FEEDBACK_APPLIED",
          `${feedbackId}:${skillId}`,
          current.revision,
        );
        await tx.playerInternalRating.update({
          where: { id: current.id },
          data: { currentRating: result.next, feedbackCount: { increment: 1 } },
        });
      }
    }
  }

  private async writeApplication(
    tx: Prisma.TransactionClient,
    current: PlayerInternalRating,
    source: InternalRatingContribution,
    previous: Prisma.Decimal,
    next: Prisma.Decimal,
    delta: Prisma.Decimal,
    type: "FEEDBACK_APPLIED" | "REBUILT",
    sourceKey: string | null,
    revision: number,
  ) {
    await tx.playerInternalRatingEvent.create({
      data: {
        userId: current.userId,
        skillId: current.skillId,
        feedbackId: source.feedbackId,
        sourceKey,
        type,
        previousRating: previous,
        newRating: next,
        delta,
        revision,
        submittedRating: source.submittedRating,
        reviewerId: source.reviewerId,
        reviewerInternalRating: source.reviewerInternalRating,
        rawWeight: source.rawWeight,
        confidence: source.confidence,
        effectiveRate: source.effectiveRate,
        finalRate: source.finalRate,
        algorithmVersion: source.algorithmVersion,
        effectiveAt: source.effectiveAt,
      },
    });
  }

  private async rebuild(
    tx: Prisma.TransactionClient,
    current: PlayerInternalRating,
    cause: string,
  ) {
    const contributions = await tx.internalRatingContribution.findMany({
      where: { userId: current.userId, skillId: current.skillId },
      orderBy: { sequence: "asc" },
    });
    const applied = await tx.playerInternalRatingEvent.findMany({
      where: {
        userId: current.userId,
        skillId: current.skillId,
        sourceKey: { not: null },
      },
      select: { sourceKey: true },
    });
    const sourceKeys = new Set(applied.map((e) => e.sourceKey));
    const revision = current.revision + 1;
    let value = current.initialRating,
      count = 0;
    await tx.playerInternalRatingEvent.create({
      data: {
        userId: current.userId,
        skillId: current.skillId,
        type: "REBUILT",
        revision,
        previousRating: value,
        newRating: value,
        delta: 0,
        effectiveAt: current.createdAt,
      },
    });
    const seen = new Set<string>();
    for (const source of contributions) {
      const key = `${source.identityKey}:${source.effectiveAt.toISOString().slice(0, 10)}`;
      const eligible = source.published && !seen.has(key);
      if (eligible) seen.add(key);
      if (source.eligible !== eligible)
        await tx.internalRatingContribution.update({
          where: { id: source.id },
          data: { eligible },
        });
      if (!eligible) continue;
      const result = this.algorithm.apply(
        value,
        source.submittedRating,
        source.finalRate,
      );
      const sourceKey = `${source.feedbackId}:${source.skillId}`;
      await this.writeApplication(
        tx,
        current,
        source,
        value,
        result.next,
        result.delta,
        "REBUILT",
        sourceKeys.has(sourceKey) ? null : sourceKey,
        revision,
      );
      value = result.next;
      count++;
    }
    await tx.playerInternalRatingEvent.create({
      data: {
        userId: current.userId,
        skillId: current.skillId,
        feedbackId: cause,
        type: "CORRECTION",
        previousRating: current.currentRating,
        newRating: value,
        delta: value.minus(current.currentRating),
        effectiveAt: new Date(),
        revision,
        chartPoint: false,
      },
    });
    await tx.playerInternalRating.update({
      where: { id: current.id },
      data: { currentRating: value, feedbackCount: count, revision },
    });
  }

  private authorize(actor: string, userId: string) {
    if (actor !== userId)
      throw new ForbiddenException("Rating histories are private");
    if (!isUUID(userId)) throw new BadRequestException("Invalid user ID");
  }
  async current(actor: string, userId: string, sportId: string) {
    this.authorize(actor, userId);
    if (!isUUID(sportId)) throw new BadRequestException("Invalid sport ID");
    return (
      await this.db.playerInternalRating.findMany({
        where: { userId, skill: { sportId, active: true } },
        include: { skill: true },
        orderBy: { skill: { name: "asc" } },
      })
    ).map((r) => ({
      ...r,
      skillName: r.skill.name,
      initialRating: r.initialRating.toNumber(),
      currentRating: r.currentRating.toNumber(),
    }));
  }

  async history(
    actor: string,
    userId: string,
    skillId: string,
    kind: "internal" | "self" | "audit",
    from?: Date,
    before?: Date,
    cursor?: string,
    limit = 100,
    expectedRevision?: number,
  ) {
    this.authorize(actor, userId);
    if (
      !isUUID(skillId) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 250 ||
      (cursor &&
        (!/^\d+$/.test(cursor) ||
          cursor.length > 19 ||
          BigInt(cursor) > 9223372036854775807n)) ||
      (from && !Number.isFinite(from.getTime())) ||
      (before && !Number.isFinite(before.getTime())) ||
      (from && before && from >= before)
    )
      throw new BadRequestException("Invalid history filter");
    const skill = await this.db.skill.findUnique({ where: { id: skillId } });
    if (!skill) throw new NotFoundException("Skill not found");
    // Repeatable read gives each page and its opening baseline one consistent view.
    return this.db.$transaction(
      async (tx) => {
        const rating = await tx.playerInternalRating.findUnique({
          where: { userId_skillId: { userId, skillId } },
        });
        const revision = rating?.revision ?? 1;
        if (
          kind === "internal" &&
          expectedRevision != null &&
          revision !== expectedRevision
        )
          throw new BadRequestException(
            "Rating history changed; reload the first page",
          );
        const dateKey = kind === "internal" ? "effectiveAt" : "createdAt";
        const where: any = {
          userId,
          skillId,
          ...(kind === "internal" ? { revision, chartPoint: true } : {}),
        };
        const table =
          kind !== "self"
            ? tx.playerInternalRatingEvent
            : tx.selfAssessmentRatingEvent;
        const baseline =
          from && kind !== "audit"
            ? await (table as any).findFirst({
                where: { ...where, [dateKey]: { lt: from } },
                orderBy: [{ [dateKey]: "desc" }, { sequence: "desc" }],
              })
            : null;
        let after: any = {};
        if (cursor) {
          const anchor = await (table as any).findFirst({
            where: { ...where, sequence: BigInt(cursor) },
          });
          if (!anchor) throw new BadRequestException("Invalid history cursor");
          after = {
            OR: [
              { [dateKey]: { gt: anchor[dateKey] } },
              { [dateKey]: anchor[dateKey], sequence: { gt: anchor.sequence } },
            ],
          };
        }
        const rows: any[] = await (table as any).findMany({
          where: {
            ...where,
            AND: [
              {
                [dateKey]: {
                  ...(from ? { gte: from } : {}),
                  ...(before ? { lt: before } : {}),
                },
              },
              after,
            ],
          },
          orderBy: [{ [dateKey]: "asc" }, { sequence: "asc" }],
          take: limit + 1,
        });
        const hasMore = rows.length > limit;
        const items = rows
          .slice(0, limit)
          .map((row) => this.historyDto(row, kind));
        return {
          items,
          baseline: baseline ? this.historyDto(baseline, kind) : null,
          hasMore,
          nextCursor: hasMore ? items[items.length - 1].sequence : null,
          revision,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private historyDto(row: any, kind: string) {
    return {
      id: row.id,
      sequence: row.sequence.toString(),
      timestamp: kind === "internal" ? row.effectiveAt : row.createdAt,
      recordedAt: row.createdAt,
      previousRating:
        row.previousRating === null ? null : Number(row.previousRating),
      newRating: Number(row.newRating),
      delta:
        kind !== "self"
          ? Number(row.delta)
          : row.previousRating === null
            ? 0
            : row.newRating - row.previousRating,
      type: row.type,
      revision: row.revision ?? null,
    };
  }

  async backfill(dryRun: boolean) {
    const report = {
      examined: 0,
      internalRatings: 0,
      selfBaselines: 0,
      initializationEvents: 0,
      dryRun,
    };
    let cursor:
      | {
          selfAssessmentId_skillId: {
            selfAssessmentId: string;
            skillId: string;
          };
        }
      | undefined;
    for (;;) {
      const rows = await this.db.selfAssessmentRating.findMany({
        take: 200,
        ...(cursor ? { cursor, skip: 1 } : {}),
        orderBy: [{ selfAssessmentId: "asc" }, { skillId: "asc" }],
        include: { selfAssessment: true },
      });
      if (!rows.length) break;
      for (const row of rows) {
        await ratingTransaction(this.db, async (tx) => {
          const fresh = await tx.selfAssessmentRating.findUniqueOrThrow({
            where: {
              selfAssessmentId_skillId: {
                selfAssessmentId: row.selfAssessmentId,
                skillId: row.skillId,
              },
            },
            include: { selfAssessment: true },
          });
          const userId = fresh.selfAssessment.userId,
            skillId = fresh.skillId;
          report.examined++;
          const history = await tx.selfAssessmentRatingEvent.findFirst({
            where: {
              userId,
              skillId,
              selfAssessmentId: fresh.selfAssessmentId,
            },
          });
          if (!history) {
            report.selfBaselines++;
            if (!dryRun)
              await tx.selfAssessmentRatingEvent.create({
                data: {
                  userId,
                  skillId,
                  selfAssessmentId: fresh.selfAssessmentId,
                  newRating: fresh.rating,
                  type: "BASELINE",
                },
              });
          }
          let current = await tx.playerInternalRating.findUnique({
            where: { userId_skillId: { userId, skillId } },
          });
          if (!current) {
            report.internalRatings++;
            if (!dryRun)
              current = await tx.playerInternalRating.create({
                data: {
                  userId,
                  skillId,
                  initialRating: fresh.rating,
                  currentRating: fresh.rating,
                },
              });
          }
          const initialized = await tx.playerInternalRatingEvent.findUnique({
            where: { sourceKey: `init:${userId}:${skillId}` },
          });
          if (!initialized) {
            report.initializationEvents++;
            if (!dryRun && current)
              await tx.playerInternalRatingEvent.create({
                data: {
                  userId,
                  skillId,
                  sourceKey: `init:${userId}:${skillId}`,
                  type: "INITIALIZED",
                  previousRating: current.initialRating,
                  newRating: current.initialRating,
                  delta: 0,
                  effectiveAt: current.createdAt,
                },
              });
          }
        });
      }
      const last = rows[rows.length - 1];
      cursor = {
        selfAssessmentId_skillId: {
          selfAssessmentId: last.selfAssessmentId,
          skillId: last.skillId,
        },
      };
    }
    return report;
  }
}
