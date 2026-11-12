import { ratingTransaction } from "../internal-ratings/transaction";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateSelfAssessmentInput,
  UpdateSelfAssessmentInput,
  UpdateSelfAssessmentRatingsInput,
} from "../common/inputs";
const LEVELS: Record<string, string[]> = {
  volleyball: ["B", "BB", "A", "AA", "OPEN"],
  "beach-volleyball": ["B", "BB", "A", "AA", "OPEN"],
};
@Injectable()
export class SelfAssessmentsService {
  constructor(private db: PrismaService) {}
  private async validate(
    tx: Prisma.TransactionClient,
    input: {
      sportId: string;
      overallLevel?: string;
      ratings?: { skillId: string }[];
    },
    requireMandatory = false,
  ) {
    const sport = await tx.sport.findUnique({
      where: { id: input.sportId },
      include: { skills: { where: { active: true } } },
    });
    if (!sport) throw new NotFoundException("Sport not found");
    if (
      input.overallLevel &&
      LEVELS[sport.slug] &&
      !LEVELS[sport.slug].includes(input.overallLevel.toUpperCase())
    )
      throw new BadRequestException("Invalid overall level for sport");
    if (input.ratings) {
      if (
        new Set(input.ratings.map((r) => r.skillId)).size !==
        input.ratings.length
      )
        throw new BadRequestException("Duplicate skills");
      const ids = new Set(sport.skills.map((s) => s.id));
      if (input.ratings.some((r) => !ids.has(r.skillId)))
        throw new BadRequestException("A skill belongs to another sport");
      if (requireMandatory) {
        const got = new Set(input.ratings.map((r) => r.skillId));
        const missing = sport.skills.filter(
          (s) => s.requiredForSelfAssessment && !got.has(s.id),
        );
        if (missing.length)
          throw new BadRequestException(
            `Missing required skills: ${missing.map((s) => s.name).join(", ")}`,
          );
      }
    }
  }
  list(userId: string) {
    return this.db.selfAssessment.findMany({
      where: { userId },
      include: { ratings: true },
      orderBy: { createdAt: "asc" },
    });
  }
  async get(actor: string, userId: string, sportId: string) {
    if (actor !== userId)
      throw new ForbiddenException("Self-assessments are private");
    return this.db.selfAssessment.findUnique({
      where: { userId_sportId: { userId, sportId } },
      include: { ratings: true },
    });
  }
  create(userId: string, input: CreateSelfAssessmentInput) {
    return ratingTransaction(this.db, async (tx) => {
      await this.validate(tx, input, true);
      return tx.selfAssessment.create({
        data: {
          userId,
          sportId: input.sportId,
          overallLevel: input.overallLevel.toUpperCase(),
          ratings: { create: input.ratings },
        },
        include: { ratings: true },
      });
    });
  }
  update(userId: string, input: UpdateSelfAssessmentInput) {
    return ratingTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SelfAssessment" WHERE id=${input.id}::uuid FOR UPDATE`;
      const a = await tx.selfAssessment.findUnique({
        where: { id: input.id },
        include: { ratings: true, sport: true },
      });
      if (!a) throw new NotFoundException();
      if (a.userId !== userId) throw new ForbiddenException();
      await this.validate(tx, {
        sportId: a.sportId,
        overallLevel: input.overallLevel,
      });
      return tx.selfAssessment.update({
        where: { id: a.id },
        data: { overallLevel: input.overallLevel.toUpperCase() },
        include: { ratings: true },
      });
    });
  }
  updateRatings(userId: string, input: UpdateSelfAssessmentRatingsInput) {
    return ratingTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SelfAssessment" WHERE id=${input.id}::uuid FOR UPDATE`;
      const a = await tx.selfAssessment.findUnique({ where: { id: input.id } });
      if (!a) throw new NotFoundException();
      if (a.userId !== userId) throw new ForbiddenException();
      await this.validate(tx, { sportId: a.sportId, ratings: input.ratings });
      for (const r of input.ratings)
        await tx.selfAssessmentRating.upsert({
          where: {
            selfAssessmentId_skillId: {
              selfAssessmentId: a.id,
              skillId: r.skillId,
            },
          },
          create: { selfAssessmentId: a.id, ...r },
          update: { rating: r.rating },
        });
      await tx.selfAssessment.update({
        where: { id: a.id },
        data: { updatedAt: new Date() },
      });
      return tx.selfAssessment.findUniqueOrThrow({
        where: { id: a.id },
        include: { ratings: true },
      });
    });
  }
}
