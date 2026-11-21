/** In-memory Clerk SDK fixtures only. No identity/profile tables are created in PostgreSQL. */
import { PrismaClient as DomainPrismaClient } from "@prisma/client";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { SelfAssessmentsService } from "../../src/self-assessments/self-assessments.service";
import { ClerkUserService } from "../../src/auth/clerk/users";
export const clerkId = () => "user_" + randomUUID().replace(/-/g, "");
export const fixtureUsers = new Map<string, any>();
const sessions = new Map<string, any>();
const missing = () =>
  Object.assign(new Error("Fixture user not found"), { status: 404 });
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const merge = (a: any, b: any): any => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {}))
    out[k] =
      v && typeof v === "object" && !Array.isArray(v)
        ? merge(out[k] ?? {}, v)
        : v;
  return out;
};
export function createFixtureUser(data: any = {}) {
  const id = data.id ?? clerkId();
  if (!id.startsWith("user_"))
    throw Error("Identity fixture must use clerkId(), not a UUID");
  const emailId = "idn_" + randomUUID();
  const user = {
    id,
    username: data.username ?? id,
    firstName: null,
    lastName: null,
    imageUrl: "https://images.clerk.test/avatar",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    primaryEmailAddressId: emailId,
    emailAddresses: [
      {
        id: emailId,
        emailAddress: data.email ?? `${id}@example.test`,
        verification: {
          status: data.emailVerifiedAt === null ? "unverified" : "verified",
        },
      },
    ],
    banned: !!data.disabledAt,
    locked: false,
    publicMetadata: {
      bvbtips: {
        version: 1,
        isPublic: data.isPublic ?? false,
        onboardingComplete: true,
      },
    },
    privateMetadata: {
      bvbtips: {
        version: 1,
        role: "PLAYER",
        age: data.age ?? 25,
        heightCm: data.heightCm ?? 180,
        aiCoachingEnabled: data.aiCoachingEnabled ?? true,
      },
    },
    unsafeMetadata: {},
  };
  fixtureUsers.set(id, user);
  return user;
}
export const fixtureClient = {
  users: {
    getUser: async (id: string) => {
      const user = fixtureUsers.get(id);
      if (!user) throw missing();
      return clone(user);
    },
    getUserList: async (params: any = {}) => {
      let rows = [...fixtureUsers.values()];
      if (params.userId)
        rows = rows.filter((u) => params.userId.includes(u.id));
      if (params.query)
        rows = rows.filter((u) =>
          (u.username + " " + u.emailAddresses[0].emailAddress)
            .toLowerCase()
            .includes(params.query.toLowerCase()),
        );
      rows.sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );
      if (params.startingAfter) {
        const index = rows.findIndex((u) => u.id === params.startingAfter);
        rows = rows.slice(index + 1);
      }
      return {
        data: clone(
          rows.slice(
            params.offset ?? 0,
            (params.offset ?? 0) + (params.limit ?? 10),
          ),
        ),
        totalCount: rows.length,
      };
    },
    updateUserMetadata: async (id: string, patch: any) => {
      const user = fixtureUsers.get(id);
      if (!user) throw missing();
      if (patch.privateMetadata)
        user.privateMetadata = merge(
          user.privateMetadata,
          patch.privateMetadata,
        );
      if (patch.publicMetadata)
        user.publicMetadata = merge(user.publicMetadata, patch.publicMetadata);
      user.updatedAt = Date.now();
      return clone(user);
    },
    deleteUser: async (id: string) => {
      fixtureUsers.delete(id);
      return { id, deleted: true };
    },
  },
  sessions: {
    getSession: async (id: string) => {
      const s = sessions.get(id);
      if (!s) throw missing();
      return s;
    },
  },
};
export const fixtureKeyPair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
export const fixtureJwtKey = fixtureKeyPair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
export function clerkToken(id: string, extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000),
    sid = "sess_" + randomUUID().replace(/-/g, "");
  sessions.set(sid, { id: sid, userId: id, status: "active" });
  const header = Buffer.from(
      JSON.stringify({
        alg: "RS256",
        typ: "JWT",
        kid: "clerk-fixture",
        cat: "cl_B7d4PD111AAA",
      }),
    ).toString("base64url"),
    body = Buffer.from(
      JSON.stringify({
        iss: "https://clerk.fixture.test",
        sub: id,
        sid,
        azp: "http://localhost:3001",
        iat: now,
        nbf: now - 1,
        exp: now + 300,
        ...extra,
      }),
    ).toString("base64url"),
    payload = header + "." + body;
  return (
    payload +
    "." +
    sign(
      "RSA-SHA256",
      Buffer.from(payload),
      fixtureKeyPair.privateKey,
    ).toString("base64url")
  );
}
export function fixtureRole(id: string, role: "PLAYER" | "COACH" | "ADMIN") {
  fixtureUsers.get(id).privateMetadata.bvbtips.role = role;
}
function localUser(u: any) {
  return {
    ...u,
    email: u.emailAddresses[0].emailAddress,
    isPublic: u.publicMetadata.bvbtips.isPublic,
    aiCoachingEnabled: u.privateMetadata.bvbtips.aiCoachingEnabled,
    age: u.privateMetadata.bvbtips.age,
    heightCm: u.privateMetadata.bvbtips.heightCm,
  };
}
/** Compatibility factory for existing domain regression fixtures; delegates identity to the fake Clerk API. */
export class TestDatabase extends DomainPrismaClient {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  private directory = new ClerkUserService(this as never);
  private assessmentService = new SelfAssessmentsService(
    this as never,
    this.directory,
  );
  readonly user: any = {
    create: async ({ data }: any) => localUser(createFixtureUser(data)),
    findUnique: async ({ where }: any) => {
      const u = where.id
        ? fixtureUsers.get(where.id)
        : [...fixtureUsers.values()].find(
            (u) =>
              (where.username && u.username === where.username) ||
              (where.email && u.emailAddresses[0].emailAddress === where.email),
          );
      return u ? localUser(clone(u)) : null;
    },
    findUniqueOrThrow: async (args: any) => {
      const u = await this.user.findUnique(args);
      if (!u) throw missing();
      return u;
    },
    update: async ({ where, data }: any) => {
      const u = fixtureUsers.get(where.id);
      if (!u) throw missing();
      if ("aiCoachingEnabled" in data)
        await this.directory.updatePlayerMetadata(u.id, {
          aiCoachingEnabled: data.aiCoachingEnabled,
        });
      if ("isPublic" in data)
        await this.directory.updatePlayerMetadata(
          u.id,
          {},
          { isPublic: data.isPublic },
        );
      if ("disabledAt" in data) u.banned = !!data.disabledAt;
      return localUser(clone(u));
    },
    deleteMany: async ({ where }: any = {}) => {
      const ids = where?.id?.in ?? [...fixtureUsers.keys()];
      for (const id of ids) fixtureUsers.delete(id);
      return { count: ids.length };
    },
    delete: async ({ where }: any) => {
      const u = fixtureUsers.get(where.id);
      fixtureUsers.delete(where.id);
      return u;
    },
  };
  private async assessment(where: any) {
    const id = where.id;
    for (const u of fixtureUsers.values()) {
      const a = u.privateMetadata.bvbtips.assessment;
      if (
        a &&
        ((id && a.id === id) ||
          (where.userId_sportId?.userId === u.id &&
            where.userId_sportId.sportId === a.sportId))
      ) {
        return {
          id: a.id,
          userId: u.id,
          sportId: a.sportId,
          overallLevel: a.overallLevel,
          updatedAt: new Date(a.updatedAt),
          createdAt: new Date(a.updatedAt),
          ratings: a.ratings.map((r: any) => ({
            ...r,
            selfAssessmentId: a.id,
            updatedAt: new Date(a.updatedAt),
            createdAt: new Date(a.updatedAt),
          })),
        };
      }
    }
    return null;
  }
  readonly selfAssessment: any = {
    create: async ({ data }: any) => {
      const a = await this.assessmentService.create(data.userId, {
        sportId: data.sportId,
        overallLevel: data.overallLevel === "TEST" ? "B" : data.overallLevel,
        ratings: [data.ratings.create].flat(),
      });
      return this.assessment({ id: a.id });
    },
    findUnique: async ({ where }: any) => this.assessment(where),
    findUniqueOrThrow: async ({ where }: any) => {
      const a = await this.assessment(where);
      if (!a) throw missing();
      return a;
    },
    update: async ({ where, data }: any) => {
      const a = await this.assessment(where);
      if (!a) throw missing();
      if (data.overallLevel)
        await this.assessmentService.update(a.userId, {
          id: a.id,
          overallLevel: data.overallLevel,
        });
      return this.assessment(where);
    },
  };
  readonly selfAssessmentRating: any = {
    update: async ({ where, data }: any) => {
      const a = await this.assessment({
        id: where.selfAssessmentId_skillId.selfAssessmentId,
      });
      if (!a) throw missing();
      await this.assessmentService.updateRatings(a.userId, {
        id: a.id,
        ratings: [
          {
            skillId: where.selfAssessmentId_skillId.skillId,
            rating: data.rating,
          },
        ],
      });
      return (await this.assessment({ id: a.id }))!.ratings.find(
        (r: any) => r.skillId === where.selfAssessmentId_skillId.skillId,
      );
    },
    upsert: async (args: any) => {
      const a = args.where.selfAssessmentId_skillId;
      return this.selfAssessmentRating.update({
        where: args.where,
        data: { rating: args.update.rating ?? args.create.rating },
      });
    },
  };
}
