import {Prisma } from "@prisma/client";
import {TestDatabase as PrismaClient,clerkId,clerkToken,fixtureRole}from"../helpers/clerk-fixtures";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { JwtService } from "@nestjs/jwt";
import { FeedbackService } from "../../src/feedback/feedback.service";
import { SelfAssessmentsService } from "../../src/self-assessments/self-assessments.service";
import { PRIVACY_NOTICE_VERSION } from "../../src/feedback/privacy";
import { RatingAlgorithm } from "../../src/internal-ratings/algorithm";
import { AnalyticsResolver } from "../../src/analytics/analytics.resolver";
import { DashboardService } from "../../src/analytics/dashboard.service";
import { rebuildOneProfile } from "../../src/feedback-processing/profiles";
import { FeedbackProcessingWorker } from "../../src/feedback-processing/worker";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("decimal peer feedback end to end", () => {
  let db: PrismaClient,
    service: FeedbackService,
    sportId: string,
    skillId: string,
    recipient: string,
    reviewer: string;
  const recipients: string[] = [];
  const jwt = new JwtService({
    secret: "decimal-feedback-test-secret-only-long-enough",
  });
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    service = new FeedbackService(db as never, jwt);
    sportId = (
      await db.sport.upsert({
        where: { slug: "beach-volleyball" },
        create: { name: "Beach Volleyball", slug: "beach-volleyball" },
        update: {},
      })
    ).id;
    skillId = (
      await db.skill.upsert({
        where: { sportId_slug: { sportId, slug: "passing" } },
        create: { sportId, slug: "passing", name: "Passing" },
        update: { active: true },
      })
    ).id;
  });
  beforeEach(async () => {
    const self = new SelfAssessmentsService(db as never);
    const users = [];
    for (let i = 0; i < 2; i++) {
      const id = clerkId();
      const user = await db.user.create({
        data: {
          id,
          username: id,
          email: id + "@example.test",
          emailVerifiedAt: new Date(), // Authenticated feature fixtures have completed email verification.
          passwordHash: "fixture",
          age: 25,
          heightCm: 180,
        },
      });
      users.push(user.id);
      await self.create(user.id, {
        sportId,
        overallLevel: "B",
        ratings: [{ skillId, rating: 3 }],
      });
    }
    [recipient, reviewer] = users;
    recipients.push(recipient);
  });
  afterEach(async () => {
    // Drain only these test users' numeric-only jobs with a deterministic provider.
    const w = new FeedbackProcessingWorker(
      db,
      {
        provider: "test",
        modelVersion: "test",
        extract: async () => ({
          value: { moderation: "ALLOW", observations: [] },
          inputTokens: 0,
          outputTokens: 0,
        }),
      },
      {
        provider: "test",
        model: "test",
        modelVersion: "v1",
        dimensions: 3,
        embed: async () => [0.1, 0.2, 0.3],
      },
      { playerId: recipient },
    );
    while (await w.extractOne()) {}
  });
  afterAll(() => db.$disconnect());
  const input = (rating: number) => ({
    recipientId: recipient,
    sportId,
    ratings: [{ skillId, rating }],
  });
  it("runs the actual migration on integer rows without changing audit values or event counts", async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE "FeedbackRating" (rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5)) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE "InternalRatingContribution" ("submittedRating" integer NOT NULL) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE "PlayerInternalRatingEvent" ("submittedRating" integer, "newRating" numeric(12,8), delta numeric(12,8), revision integer) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE "PlayerFeedbackAnalysisProfile" (stale boolean,revision integer,data jsonb,"invalidatedAt" timestamp) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe('INSERT INTO "FeedbackRating" VALUES(4)');
      await tx.$executeRawUnsafe(
        'INSERT INTO "InternalRatingContribution" VALUES(4)',
      );
      await tx.$executeRawUnsafe(
        'INSERT INTO "PlayerInternalRatingEvent" VALUES(4,3.1,.1,2)',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "PlayerFeedbackAnalysisProfile" VALUES(false,1,'{}',CURRENT_TIMESTAMP)`,
      );
      const script = readFileSync(
        "prisma/migrations/20261120000000_decimal_feedback_ratings/migration.sql",
        "utf8",
      ).replace(/--.*$/gm, "");
      for (const statement of script
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s && !["BEGIN", "COMMIT"].includes(s)))
        await tx.$executeRawUnsafe(statement);
      expect(
        await tx.$queryRaw`SELECT rating::text AS value FROM "FeedbackRating"`,
      ).toEqual([{ value: "4.0" }]);
      expect(
        await tx.$queryRaw`SELECT "submittedRating"::text AS value FROM "InternalRatingContribution"`,
      ).toEqual([{ value: "4.0" }]);
      expect(
        await tx.$queryRaw`SELECT "submittedRating"::text AS value,"newRating"::text AS rating,delta::text AS delta,revision FROM "PlayerInternalRatingEvent"`,
      ).toEqual([
        {
          value: "4.0",
          rating: "3.10000000",
          delta: "0.10000000",
          revision: 2,
        },
      ]);
      expect(
        await tx.$queryRaw`SELECT stale,revision FROM "PlayerFeedbackAnalysisProfile"`,
      ).toEqual([{ stale: true, revision: 2 }]);
    });
  });
  it.each([3.5, 4.2, 4.7])(
    "stores %s exactly and applies the unchanged snapshot weights",
    async (rating) => {
      const f = await service.submit(reviewer, input(rating));
      expect(f.ratings[0].rating.toNumber()).toBe(rating);
      const event = await db.playerInternalRatingEvent.findFirstOrThrow({
        where: { feedbackId: f.id, type: "FEEDBACK_APPLIED" },
      });
      expect(event.submittedRating!.toNumber()).toBe(rating);
      const expected = new RatingAlgorithm().apply(
        new Prisma.Decimal(3),
        new Prisma.Decimal(rating),
        f.ratings[0].reviewerFinalRateAtSubmission!,
      );
      expect(event.newRating.equals(expected.next)).toBe(true);
      const [raw] = await db.$queryRaw<
        { value: string }[]
      >`SELECT rating::text AS value FROM "FeedbackRating" WHERE "feedbackId"=${f.id}::uuid`;
      expect(raw.value).toBe(rating.toFixed(1));
    },
  );
  it("approves a decimal review once and does not replay rating events on comment-only edits", async () => {
    const invite = await service.invite(
      recipient,
      recipient,
      sportId,
      undefined,
      reviewer,
    );
    const f = await service.submitGuest({
      ...input(4.7),
      token: invite.token,
      guestName: "Prepared name",
    });
    expect(f.status).toBe("PENDING");
    expect(
      await db.playerInternalRatingEvent.count({ where: { feedbackId: f.id } }),
    ).toBe(0);
    await Promise.all(
      [1, 2, 3].map(() => service.decide(reviewer, f.id, true)),
    );
    const before = await db.playerInternalRatingEvent.count({
      where: { feedbackId: f.id },
    });
    expect(before).toBe(1);
    await service.update(reviewer, {
      id: f.id,
      overallComment: "Comment changed; score did not",
    });
    expect(
      await db.playerInternalRatingEvent.count({ where: { feedbackId: f.id } }),
    ).toBe(before);
    expect(
      (
        await db.internalRatingContribution.findFirstOrThrow({
          where: { feedbackId: f.id },
        })
      ).submittedRating.toNumber(),
    ).toBe(4.7);
  });
  it("rejects invalid precision before writing any feedback", async () => {
    for (const value of [0, 5.5, 3.55, NaN, Infinity])
      await expect(service.submit(reviewer, input(value))).rejects.toThrow(
        "increments",
      );
    expect(await db.feedback.count({ where: { recipientId: recipient } })).toBe(
      0,
    );
  });
  it("keeps individual decimal match scores separate and a combined review single", async () => {
    const matches = [];
    for (let i = 0; i < 2; i++)
      matches.push(
        await db.match.create({
          data: {
            createdById: recipient,
            sportId,
            playedAt: new Date(),
            status: "COMPLETED",
            participants: { create: { userId: recipient } },
          },
        }),
      );
    const ids = matches.map((m) => m.id);
    const invitation = await service.invite(
      recipient,
      recipient,
      sportId,
      undefined,
      reviewer,
      ids,
      "INDIVIDUAL_MATCHES",
    );
    const rows = await service.submitRequest({
      token: invitation.token,
      submissionId: randomUUID(),
      asGuest: true,
      guestName: "Guest",
      reviews: ids.map((matchId, i) => ({
        matchId,
        ratings: [{ skillId, rating: i ? 3.5 : 4.7 }],
      })),
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.find((r) => r.matchId === ids[0])!.ratings[0].rating.toNumber(),
    ).toBe(4.7);
    expect(
      rows.find((r) => r.matchId === ids[1])!.ratings[0].rating.toNumber(),
    ).toBe(3.5);
    const combined = await service.invite(
      recipient,
      recipient,
      sportId,
      undefined,
      reviewer,
      ids,
      "COMBINED_MATCHES",
    );
    const request = {
      token: combined.token,
      submissionId: randomUUID(),
      asGuest: true,
      guestName: "Guest",
      reviews: [{ ratings: [{ skillId, rating: 4.2 }] }],
    };
    const first = await service.submitRequest(request),
      again = await service.submitRequest(request);
    expect(first).toHaveLength(1);
    expect(again[0].id).toBe(first[0].id);
    expect(first[0].associatedMatches).toHaveLength(2);
    expect(first[0].ratings[0].rating.toNumber()).toBe(4.2);
  });
  it("aggregates decimal ratings in SQL and returns numeric chart/profile values without early rounding", async () => {
    const permission = {
      privateAnalyticsAllowed: true,
      privateCoachingAllowed: true,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    };
    await service.submit(reviewer, { ...input(4.7), ...permission });
    await service.submit(reviewer, { ...input(3.5), ...permission });
    const points = await new DashboardService(db as never).categoryFeedback(
      recipient,
      skillId,
    );
    expect(points.map((p) => p.rating).sort()).toEqual([3.5, 4.7]);
    const averages = await new AnalyticsResolver(db as never).userSkillRatings(
      { id: recipient } as never,
      recipient,
      sportId,
    );
    expect(averages[0].average).toBeCloseTo(4.1);
    expect(typeof averages[0].average).toBe("number");
    expect(await rebuildOneProfile(db, recipient, sportId)).toBe(true);
    const p = await db.playerFeedbackAnalysisProfile.findUniqueOrThrow({
      where: { userId_sportId: { userId: recipient, sportId } },
    });
    expect(
      (
        p.data as unknown as {
          skills: { skillId: string; peer: { average: number } }[];
        }
      ).skills.find((s) => s.skillId === skillId)!.peer.average,
    ).toBeCloseTo(4.1);
  });
  it("exposes Float ratings through authenticated feedback and approval GraphQL, retaining integer self assessment", async () => {
    const saved = { ...process.env };
    process.env.DATABASE_URL = url;
    process.env.JWT_SECRET = "decimal-graphql-fixture-secret-longer-than-32";
    process.env.NODE_ENV = "test";
    const { Test } = await import("@nestjs/testing"),
      { AppModule } = await import("../../src/app.module"),
      { PrismaService } = await import("../../src/prisma/prisma.service"),
      { GraphQLSchemaHost } = await import("@nestjs/graphql"),
      { graphql, printSchema } = await import("graphql");
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const schema = module.get(GraphQLSchemaHost).schema,
        token = clerkToken(reviewer);
      const run = (source: string, variables: object = {}) =>
        graphql({
          schema,
          source,
          variableValues: variables as Record<string, unknown>,
          contextValue: {
            req: {
              headers: { authorization: `Bearer ${token}` },
              ip: "127.0.0.1",
            },
            res: { header: () => {}, setHeader: () => {} },
          },
        });
      const result = await run(
        "mutation($input:SubmitFeedbackInput!){submitFeedback(input:$input){id ratings{rating}}}",
        { input: input(4.7) },
      );
      expect(result.errors).toBeUndefined();
      expect((result.data as any).submitFeedback.ratings[0].rating).toBe(4.7);
      const invite = await service.invite(
        recipient,
        recipient,
        sportId,
        undefined,
        reviewer,
      );
      await service.submitGuest({ ...input(4.2), token: invite.token });
      const approvals = await run(
        "query{myFeedbackApprovals{items{ratings{rating}}}}",
      );
      expect(approvals.errors).toBeUndefined();
      expect(
        (approvals.data as any).myFeedbackApprovals.items[0].ratings[0].rating,
      ).toBe(4.2);
      const bad = await run(
        "mutation($input:SubmitFeedbackInput!){submitFeedback(input:$input){id}}",
        { input: input(3.55) },
      );
      expect(bad.errors).toBeTruthy();
      const sdl = printSchema(schema);
      expect(sdl).toMatch(/input RatingInput \{[\s\S]*?rating: Float!/);
      expect(sdl).toMatch(/input AssessmentRatingInput \{[\s\S]*?rating: Int!/);
    } finally {
      await app.close();
      process.env = saved;
    }
  });
});
