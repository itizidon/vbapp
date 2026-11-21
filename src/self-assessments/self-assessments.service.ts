import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ClerkUserService } from "../auth/clerk/users";
import { privatePlayer, assessmentSchema } from "../auth/clerk/metadata";
import { ratingTransaction } from "../internal-ratings/transaction";
import {
  CreateSelfAssessmentInput,
  UpdateSelfAssessmentInput,
  UpdateSelfAssessmentRatingsInput,
} from "../common/inputs";
@Injectable()
export class SelfAssessmentsService {
  private reconciled = new Map<string, string>();
  constructor(
    private db: PrismaService,
    readonly users: ClerkUserService = new ClerkUserService(db),
  ) {}
  async validate(input: CreateSelfAssessmentInput) {
    const sport = await this.db.sport.findUnique({
      where: { id: input.sportId },
      include: { skills: { where: { active: true } } },
    });
    if (!sport) throw new BadRequestException("Volleyball sport not found");
    const parsed = assessmentSchema.safeParse({
      ...input,
      ratings: input.ratings.map((r) => ({
        skillId: r.skillId,
        rating: r.rating,
      })),
      id: randomUUID(),
      overallLevel: input.overallLevel.toUpperCase(),
      revision: randomUUID(),
      updatedAt: new Date().toISOString(),
    });
    if (!parsed.success)
      throw new BadRequestException("Invalid self-assessment");
    const ids = new Set(input.ratings.map((r) => r.skillId));
    if (ids.size !== input.ratings.length)
      throw new BadRequestException("Duplicate skills");
    if (
      input.ratings.some((r) => !sport.skills.some((s) => s.id === r.skillId))
    )
      throw new BadRequestException("A skill belongs to another sport");
    if (sport.skills.some((s) => s.requiredForSelfAssessment && !ids.has(s.id)))
      throw new BadRequestException("Rate all required skills");
    return parsed.data;
  }
  private shape(
    userId: string,
    a: NonNullable<ReturnType<typeof privatePlayer>["assessment"]>,
  ) {
    const updatedAt = new Date(a.updatedAt);
    return {
      id: a.id,
      userId,
      sportId: a.sportId,
      overallLevel: a.overallLevel,
      createdAt: updatedAt,
      updatedAt,
      ratings: a.ratings.map((r) => ({ ...r, updatedAt })),
    };
  }
  async list(userId: string) {
    const a = privatePlayer(
      await this.users.getUserById(userId, true),
    ).assessment;
    if (!a) return [];
    if (!(await this.reconcile(userId, a))) return [];
    return [this.shape(userId, a)];
  }
  async get(actor: string, userId: string, sportId: string) {
    if (actor !== userId)
      throw new ForbiddenException("Self-assessments are private");
    return (await this.list(userId)).find((a) => a.sportId === sportId) ?? null;
  }
  // Reconcile the current Clerk revision into immutable domain history. No current-profile mirror exists.
  async reconcile(
    userId: string,
    a: NonNullable<ReturnType<typeof privatePlayer>["assessment"]>,
  ) {
    if (this.reconciled.get(userId) === a.revision) return true;
    const valid = await ratingTransaction(this.db, async (tx) => {
      // Clerk metadata survives a database replacement. Never replay a revision
      // whose database-scoped skill IDs no longer belong to its sport.
      const skills = await tx.skill.findMany({
        where: {
          sportId: a.sportId,
          id: { in: a.ratings.map((r) => r.skillId) },
        },
        select: { id: true },
      });
      if (skills.length !== a.ratings.length) return false;
      for (const r of a.ratings) {
        const existing = await tx.selfAssessmentRatingEvent.findUnique({
          where: {
            userId_skillId_sourceRevision: {
              userId,
              skillId: r.skillId,
              sourceRevision: a.revision,
            },
          },
        });
        if (existing) continue;
        const previous = await tx.selfAssessmentRatingEvent.findFirst({
          where: { userId, skillId: r.skillId },
          orderBy: { sequence: "desc" },
        });
        if (
          previous &&
          (previous.newRating === r.rating ||
            previous.createdAt > new Date(a.updatedAt))
        )
          continue;
        await tx.selfAssessmentRatingEvent.create({
          data: {
            userId,
            skillId: r.skillId,
            selfAssessmentId: a.id,
            sourceRevision: a.revision,
            previousRating: previous?.newRating ?? null,
            newRating: r.rating,
            type: previous ? "UPDATED" : "CREATED",
            createdAt: new Date(a.updatedAt),
          },
        });
        const rating = await tx.playerInternalRating.upsert({
          where: { userId_skillId: { userId, skillId: r.skillId } },
          create: {
            userId,
            skillId: r.skillId,
            initialRating: r.rating,
            currentRating: r.rating,
          },
          update: {},
        });
        await tx.playerInternalRatingEvent.upsert({
          where: { sourceKey: `init:${userId}:${r.skillId}` },
          create: {
            userId,
            skillId: r.skillId,
            type: "INITIALIZED",
            previousRating: rating.initialRating,
            newRating: rating.initialRating,
            delta: 0,
            sourceKey: `init:${userId}:${r.skillId}`,
            effectiveAt: new Date(a.updatedAt),
          },
          update: {},
        });
      }
      return true;
    });
    if (!valid) return false;
    if (this.reconciled.size >= 1000)
      this.reconciled.delete(this.reconciled.keys().next().value!);
    this.reconciled.set(userId, a.revision);
    return true;
  }
  async onboard(
    userId: string,
    input: CreateSelfAssessmentInput & { age: number; heightCm: number },
  ) {
    if (
      !Number.isInteger(input.age) ||
      input.age < 13 ||
      input.age > 120 ||
      !Number.isInteger(input.heightCm) ||
      input.heightCm < 50 ||
      input.heightCm > 300
    )
      throw new BadRequestException("Invalid player profile");
    return this.save(
      userId,
      input,
      { age: input.age, heightCm: input.heightCm },
      true,
    );
  }
  private async save(
    userId: string,
    input: CreateSelfAssessmentInput,
    extra: { age?: number; heightCm?: number } = {},
    onboard = false,
  ) {
    const assessment = await this.validate({
      sportId: input.sportId,
      overallLevel: input.overallLevel,
      ratings: input.ratings,
    });
    // Serialize application writes across replicas. First reconcile the previous revision after any interrupted write.
    await this.users.withPlayerLock(userId, async () => {
      const user = await this.users.getUserById(userId, true),
        old = privatePlayer(user).assessment;
      if (old) {
        const valid = await this.reconcile(userId, old);
        if (valid && old.sportId === assessment.sportId) assessment.id = old.id;
      }
      await this.users.updatePlayerMetadata(
        userId,
        { ...extra, assessment },
        onboard ? { onboardingComplete: true } : {},
        true,
      );
    });
    await this.reconcile(userId, assessment);
    return this.shape(userId, assessment);
  }
  create(userId: string, input: CreateSelfAssessmentInput) {
    return this.save(userId, input);
  }
  async update(userId: string, input: UpdateSelfAssessmentInput) {
    const a = (await this.list(userId)).find((a) => a.id === input.id);
    if (!a) throw new BadRequestException("Assessment not found");
    return this.save(userId, {
      sportId: a.sportId,
      overallLevel: input.overallLevel,
      ratings: a.ratings,
    });
  }
  async updateRatings(userId: string, input: UpdateSelfAssessmentRatingsInput) {
    const a = (await this.list(userId)).find((a) => a.id === input.id);
    if (!a) throw new BadRequestException("Assessment not found");
    const merged = new Map(a.ratings.map((r) => [r.skillId, r.rating]));
    for (const r of input.ratings) merged.set(r.skillId, r.rating);
    return this.save(userId, {
      sportId: a.sportId,
      overallLevel: a.overallLevel,
      ratings: [...merged].map(([skillId, rating]) => ({ skillId, rating })),
    });
  }
}
