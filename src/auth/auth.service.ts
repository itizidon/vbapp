import { ratingTransaction } from "../internal-ratings/transaction";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { hash, verify, argon2id } from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { isUUID } from "class-validator";
import { LoginInput, RegisterInput } from "../common/inputs";

const LEVELS: Record<string, string[]> = {
  volleyball: ["B", "BB", "A", "AA", "OPEN"],
  "beach-volleyball": ["B", "BB", "A", "AA", "OPEN"],
};
@Injectable()
export class AuthService {
  constructor(
    private db: PrismaService,
    private jwt: JwtService,
  ) {}
  async register(input: RegisterInput) {
    const duplicates = new Set(input.ratings.map((r) => r.skillId));
    if (duplicates.size !== input.ratings.length)
      throw new BadRequestException("Duplicate skill rating");
    const sport = await this.db.sport.findUnique({
      where: { id: input.sportId },
      include: { skills: { where: { active: true } } },
    });
    if (!sport) throw new BadRequestException("Sport not found");
    if (
      LEVELS[sport.slug] &&
      !LEVELS[sport.slug].includes(input.overallLevel.toUpperCase())
    )
      throw new BadRequestException("Invalid overall level for sport");
    const skillMap = new Map(sport.skills.map((s) => [s.id, s]));
    if (input.ratings.some((r) => !skillMap.has(r.skillId)))
      throw new BadRequestException("A skill belongs to another sport");
    const supplied = new Set(input.ratings.map((r) => r.skillId));
    const missing = sport.skills.filter(
      (s) => s.requiredForSelfAssessment && !supplied.has(s.id),
    );
    if (missing.length)
      throw new BadRequestException(
        `Missing required skills: ${missing.map((s) => s.name).join(", ")}`,
      );
    const passwordHash = await hash(input.password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    try {
      const user = await ratingTransaction(this.db, async (tx) => {
        const created = await tx.user.create({
          data: {
            username: input.username.trim(),
            email: input.email.trim(),
            passwordHash,
            age: input.age,
            heightCm: input.heightCm,
          },
        });
        await tx.selfAssessment.create({
          data: {
            userId: created.id,
            sportId: sport.id,
            overallLevel: input.overallLevel.toUpperCase(),
            ratings: {
              create: input.ratings.map((r) => ({
                skillId: r.skillId,
                rating: r.rating,
              })),
            },
          },
        });
        return created;
      });
      return this.payload(user);
    } catch (e: any) {
      if (e.code === "P2002")
        throw new ConflictException("Username or email already exists");
      throw e;
    }
  }
  async login(input: LoginInput) {
    const user = await this.db.user.findFirst({
      where: { OR: [{ username: input.login }, { email: input.login }] },
    });
    if (!user || !(await verify(user.passwordHash, input.password)))
      throw new UnauthorizedException("Invalid credentials");
    return this.payload(user);
  }
  async me(id: string) {
    return this.db.user.findUniqueOrThrow({ where: { id } });
  }
  async members(actorId: string, search: string) {
    const query = search.trim();
    if (query.length < 2) return [];
    if (query.length > 40)
      throw new BadRequestException("Search must be at most 40 characters");
    return this.db.user.findMany({
      where: {
        id: { not: actorId },
        username: { contains: query, mode: "insensitive" },
      },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
      take: 10,
    });
  }
  updateVisibility(actorId: string, isPublic: boolean) {
    return this.db.user.update({ where: { id: actorId }, data: { isPublic } });
  }
  async searchPlayers(search: string, cursor?: string) {
    const query = search.trim();
    if (query.length > 40)
      throw new BadRequestException("Search must be at most 40 characters");
    if (cursor && !isUUID(cursor))
      throw new BadRequestException("Invalid player cursor");
    return this.db.user.findMany({
      where: query
        ? { username: { contains: query, mode: "insensitive" } }
        : {},
      select: { id: true, username: true, isPublic: true },
      orderBy: [{ username: "asc" }, { id: "asc" }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
  async playerSuggestions(search: string) {
    const query = search.trim();
    if (query.length < 2) return [];
    if (query.length > 254)
      throw new BadRequestException("Search must be at most 254 characters");
    const escaped = query.replace(/[\\%_]/g, "\\$&");
    const contains = `%${escaped}%`,
      prefix = `${escaped}%`;
    return this.db.$queryRaw<
      { id: string; username: string; isPublic: boolean }[]
    >(Prisma.sql`
      SELECT id, username::text AS username, "isPublic" FROM "User"
      WHERE username ILIKE ${contains} OR email ILIKE ${contains}
      ORDER BY CASE
        WHEN username = ${query}::citext OR email = ${query}::citext THEN 0
        WHEN username ILIKE ${prefix} OR email ILIKE ${prefix} THEN 1
        ELSE 2 END, lower(username::text) ASC, id ASC
      LIMIT 5
    `);
  }
  async playerProfile(id: string) {
    if (!isUUID(id)) throw new BadRequestException("Invalid player ID");
    const player = await this.db.user.findUnique({
      where: { id },
      select: { id: true, username: true, isPublic: true },
    });
    if (!player) throw new NotFoundException("Player not found");
    return player;
  }
  private async payload(user: {
    id: string;
    username: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      accessToken: await this.jwt.signAsync({
        sub: user.id,
        id: user.id,
        username: user.username,
      }),
      user,
    };
  }
}
