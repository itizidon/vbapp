import { PrismaClient, Feedback, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  rebuildOneProfile,
  rebuildProfiles,
  readOwnAnalysisProfile,
} from "../../src/feedback-processing/profiles";
import {
  FeedbackAnalysisProfile,
  EvidenceStatus as E,
  RatingTrend as R,
  TechniqueTrend as T,
} from "../../src/feedback-analysis/models";
import { FeedbackAnalysisService } from "../../src/feedback-analysis/service";
import * as queries from "../../src/feedback-analysis/queries";
import { DAY_MS } from "../../src/feedback-analysis/config";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("SQL feedback analytical profiles", () => {
  let db: PrismaClient,
    sportId: string,
    skills: Record<string, string>,
    userId: string,
    reviewers: string[];
  let testUsers: string[] = [];
  const asOf = new Date();
  const day = (n: number) => new Date(asOf.getTime() - n * DAY_MS);
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    const sport = await db.sport.upsert({
      where: { slug: "beach-volleyball" },
      create: { name: "Beach Volleyball", slug: "beach-volleyball" },
      update: {},
    });
    sportId = sport.id;
    skills = {};
    for (const slug of ["attack", "defense", "passing", "setting", "serving"])
      skills[slug] = (
        await db.skill.upsert({
          where: { sportId_slug: { sportId, slug } },
          create: { sportId, slug, name: slug },
          update: { active: true },
        })
      ).id;
  });
  const user = async () => {
    const id = randomUUID();
    testUsers.push(id);
    return (
      await db.user.create({
        data: {
          id,
          username: id,
          email: id + "@example.test",
          passwordHash: "test-only",
          age: 25,
          heightCm: 180,
        },
      })
    ).id;
  };
  beforeEach(async () => {
    testUsers = [];
    userId = await user();
    reviewers = await Promise.all([user(), user(), user()]);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.feedback.deleteMany({ where: { recipientId: { in: testUsers } } });
    await db.playerFeedbackAnalysisProfile.deleteMany({
      where: { userId: { in: testUsers } },
    });
  });
  afterAll(() => db?.$disconnect());
  async function review(
    options: {
      days?: number;
      rating?: number | null;
      skill?: string;
      guest?: boolean;
      reviewer?: string;
      overrides?: Partial<Feedback>;
      written?: boolean;
    } = {},
  ) {
    const skill = options.skill ?? "passing";
    return db.feedback.create({
      data: {
        recipientId: userId,
        sportId,
        reviewerId: options.guest ? null : (options.reviewer ?? reviewers[0]),
        guestName: options.guest ? "Same guest name" : null,
        status: "PUBLISHED",
        privateAnalyticsAllowed: true, privateCoachingAllowed: true, privacyNoticeVersion: "feedback-privacy-v1", privateAnalyticsConsentAt: new Date(), privateCoachingConsentAt: new Date(),
      analyticsAllowed: true,
        evidenceAllowed: true,
        createdAt: day(options.days ?? 1),
        overallComment:
          options.written === false
            ? null
            : "Platform needs work. Steady platform. Communicate.",
        ...options.overrides,
        ...(options.rating === null
          ? {}
          : {
              ratings: {
                create: {
                  skillId: skills[skill],
                  rating: options.rating ?? 3,
                  comment:
                    options.written === false
                      ? null
                      : "Platform needs work. Steady platform.",
                },
              },
            }),
      },
      include: { ratings: true },
    });
  }
  async function observations(
    f: Feedback,
    sentiments: ("positive" | "negative" | "neutral")[],
    theme = "platform_control",
  ) {
    const job = await db.feedbackAnalysisJob.findUniqueOrThrow({
      where: { feedbackId: f.id },
    });
    const hash = "fixture-source-hash";
    for (let i = 0; i < sentiments.length; i++)
      await db.feedbackObservation.create({
        data: {
          feedbackId: f.id,
          generation: job.generation,
          sourceKey: "overall",
          skillId: theme === "communication" ? null : skills.passing,
          themeId: theme,
          sentiment: sentiments[i],
          evidence: "Platform needs work",
          fingerprint: randomUUID(),
          sourceHash: hash,
          provider: "fixture",
          modelVersion: "fixture",
          promptVersion: "fixture",
          feedbackCreatedAt: f.createdAt,
        },
      });
    await db.feedbackAnalysisJob.update({
      where: { feedbackId: f.id },
      data: { status: "COMPLETED", moderation: "ALLOW", sourceHash: hash },
    });
  }
  async function complete(f: Feedback) {
    await observations(f, []);
  }
  async function build() {
    expect(await rebuildOneProfile(db, userId, sportId, asOf)).toBe(true);
    return (
      await db.playerFeedbackAnalysisProfile.findUniqueOrThrow({
        where: { userId_sportId: { userId, sportId } },
      })
    ).data as unknown as FeedbackAnalysisProfile;
  }
  const passing = (p: FeedbackAnalysisProfile) =>
    p.skills.find((s) => s.slug === "passing")!;
  const platform = (p: FeedbackAnalysisProfile) =>
    p.themes.find((t) => t.themeId === "platform_control")!;
  it("builds complete numerical ratings without comments, observations, embeddings or provider calls", async () => {
    await review({ written: false, rating: 4 });
    const p = await build();
    expect(p.state).toBe("COMPLETE");
    expect(p.awaiting).toBe(0);
    expect(p.writtenFeedbackCount).toBe(0);
    expect(passing(p).peer).toEqual({ count: 1, average: 4 });
    expect(p.themes.every((t) => t.rawObservationCount === 0)).toBe(true);
  });
  it("returns an empty, complete profile with all five existing skills and null averages", async () => {
    const p = await build();
    expect(p.feedback).toBe(0);
    expect(p.state).toBe("COMPLETE");
    expect(p.evidenceStatus).toBe(E.NO_DATA);
    expect(p.skills).toHaveLength(5);
    expect(
      p.skills.every(
        (s) =>
          s.peer.count === 0 &&
          s.peer.average === null &&
          s.lastFiveComparison.delta === null,
      ),
    ).toBe(true);
    expect(p.weaknesses).toEqual([]);
  });
  it("keeps missing ratings out of averages and never divides by all reviews", async () => {
    await complete(await review({ rating: 5 }));
    await complete(await review({ rating: null }));
    await complete(await review({ rating: 1, skill: "serving" }));
    const p = await build();
    expect(p.feedback).toBe(3);
    expect(passing(p).peer).toEqual({ count: 1, average: 5 });
    expect(passing(p).trend).toBe(R.INSUFFICIENT_DATA);
    expect(p.weaknesses).toEqual([]);
  });
  it("calculates recent/previous five, UTC windows, and latest eligible timestamps", async () => {
    for (let i = 0; i < 5; i++)
      await complete(
        await review({ rating: 5, days: i + 1, reviewer: reviewers[i % 2] }),
      );
    for (let i = 0; i < 5; i++)
      await complete(
        await review({ rating: 2, days: 100 + i, reviewer: reviewers[i % 2] }),
      );
    const p = await build(),
      s = passing(p);
    expect(s.peer).toEqual({ count: 10, average: 3.5 });
    expect(s.lastFiveComparison).toMatchObject({
      recent: { count: 5, average: 5 },
      previous: { count: 5, average: 2 },
      delta: 3,
      trend: R.IMPROVING,
    });
    expect(s.ninetyDayComparison.trend).toBe(R.IMPROVING);
    expect(s.last30Days).toEqual({ count: 5, average: 5 });
    expect(s.trend).toBe(R.IMPROVING);
    expect(p.latestEligibleFeedbackAt).toBe(day(1).toISOString());
  });
  it("uses half-open comparable time windows and excludes future feedback", async () => {
    await complete(await review({ rating: 5, days: 90 }));
    await complete(await review({ rating: 1, days: 180 }));
    await complete(await review({ rating: 1, days: -1 }));
    const p = await build(),
      s = passing(p);
    expect(p.feedback).toBe(2);
    expect(s.last90Days).toEqual({ count: 1, average: 5 });
    expect(s.previous90Days).toEqual({ count: 1, average: 1 });
  });
  it.each([
    { status: "PENDING" },
    { status: "HIDDEN" },
    { status: "DELETED" },
    { status: "REJECTED" },
    { privateAnalyticsAllowed: false },
    { privateCoachingAllowed: false },
  ])(
    "excludes ineligible feedback %j from every aggregate",
    async (overrides) => {
      const valid = await review({ rating: 5 });
      await observations(valid, ["positive"]);
      await review({ rating: 1, overrides: overrides as Partial<Feedback> });
      const p = await build();
      expect(p.feedback).toBe(1);
      expect(passing(p).peer.average).toBe(5);
      expect(platform(p).feedbackCount).toBe(1);
    },
  );
  it("excludes assigned reviews until the designated reviewer approves, and respects moderation exclusions", async () => {
    const f = await review({
      overrides: {
        approvalRequired: true,
        submittedById: userId,
        status: "PENDING",
      },
    });
    expect((await build()).feedback).toBe(0);
    await db.feedback.update({
      where: { id: f.id },
      data: {
        status: "PUBLISHED",
        approvedAt: new Date(),
        approvedById: reviewers[0],
      },
    });
    await observations(f, ["negative"]);
    expect((await build()).feedback).toBe(1);
    await db.feedbackAnalysisJob.update({
      where: { feedbackId: f.id },
      data: { status: "SKIPPED", moderation: "ABUSE" },
    });
    const p = await build();
    expect(p.feedback).toBe(0);
    expect(p.moderated).toBe(1);
    expect(passing(p).peer.average).toBeNull();
    expect(platform(p).rawObservationCount).toBe(0);
  });
  it("deduplicates theme sentiment per review, preserves mixed sentiments, and counts verified identities correctly", async () => {
    await observations(await review(), [
      "negative",
      "negative",
      "negative",
      "positive",
      "neutral",
    ]);
    await observations(await review({ reviewer: reviewers[0] }), ["negative"]);
    await observations(await review({ reviewer: reviewers[1] }), ["positive"]);
    await observations(await review({ guest: true }), ["negative"]);
    await observations(await review({ guest: true }), ["negative"]);
    const p = await build(),
      t = platform(p);
    expect(t).toMatchObject({
      rawObservationCount: 9,
      feedbackCount: 5,
      negativeFeedbackCount: 4,
      positiveFeedbackCount: 2,
      neutralFeedbackCount: 1,
      distinctVerifiedReviewers: 2,
      distinctNegativeReviewers: 1,
      guestFeedbackCount: 2,
      relevantFeedbackCount: 5,
      negativeMentionRate: 0.8,
    });
    expect(p.distinctVerifiedReviewers).toBe(2);
    expect(p.guestFeedbackCount).toBe(2);
    expect(JSON.stringify(p)).not.toContain(reviewers[0]);
  });
  it("uses skill-written coverage denominators and labels general written-review denominators", async () => {
    await observations(await review(), ["negative"]);
    await observations(
      await review({ skill: "serving" }),
      ["negative"],
      "communication",
    );
    await complete(await review({ written: false }));
    const p = await build();
    expect(platform(p)).toMatchObject({
      relevantFeedbackCount: 1,
      denominatorKind: "SKILL_WRITTEN_REVIEWS",
      negativeMentionRate: 1,
      totalEligibleFeedbackCount: 3,
    });
    expect(p.themes.find((t) => t.themeId === "communication")).toMatchObject({
      relevantFeedbackCount: 2,
      denominatorKind: "ELIGIBLE_WRITTEN_REVIEWS",
    });
  });
  it("counts one combined multi-match review once and individual records separately", async () => {
    const matches = await Promise.all(
      [0, 1].map(() =>
        db.match.create({
          data: { createdById: userId, sportId, status: "COMPLETED" },
        }),
      ),
    );
    const combined = await review();
    await complete(combined);
    await db.feedbackMatch.createMany({
      data: matches.map((m) => ({ feedbackId: combined.id, matchId: m.id })),
    });
    for (const m of matches)
      await complete(await review({ overrides: { matchId: m.id } }));
    const p = await build();
    expect(p.feedback).toBe(3);
    expect(passing(p).peer.count).toBe(3);
  });
  it("ranks supported recurring weaknesses and labels guest-only evidence as tentative", async () => {
    for (let i = 0; i < 6; i++)
      await observations(
        await review({ rating: 2, reviewer: reviewers[i % 2] }),
        ["negative", "negative"],
      );
    let p = await build();
    expect(p.weaknesses[0]).toMatchObject({
      themeId: "platform_control",
      supportingFeedbackCount: 6,
      negativeMentionRate: 1,
      distinctVerifiedReviewers: 2,
      evidenceStatus: E.SUFFICIENT,
    });
    expect(p.weaknesses[0].priorityScore).toBeGreaterThan(50);
    const other = await user();
    userId = other;
    for (let i = 0; i < 5; i++)
      await observations(await review({ guest: true }), ["negative"]);
    p = await build();
    expect(p.weaknesses[0]).toMatchObject({
      distinctVerifiedReviewers: 0,
      evidenceStatus: E.LIMITED_REVIEWER_DIVERSITY,
      evidenceFactor: 0.5,
    });
    expect(
      p.weaknesses[0].components.find((c) => c.name === "reviewerAgreement")
        ?.value,
    ).toBeNull();
  });
  it("does not rank incomplete extraction as a reliable set of weaknesses", async () => {
    for (let i = 0; i < 5; i++)
      await observations(await review({ reviewer: reviewers[i % 2] }), [
        "negative",
      ]);
    await review();
    const p = await build();
    expect(p.state).toBe("PARTIAL");
    expect(p.awaiting).toBe(1);
    expect(p.evidenceStatus).toBe(E.PARTIAL_ANALYSIS);
    expect(p.weaknesses).toEqual([]);
  });
  it("detects technique improvement from positive corroboration and skill trends, not silence", async () => {
    for (let i = 0; i < 5; i++) {
      await observations(
        await review({ days: 100 + i, rating: 2, reviewer: reviewers[i % 2] }),
        ["negative"],
      );
      await observations(
        await review({ days: 1 + i, rating: 5, reviewer: reviewers[i % 2] }),
        ["positive"],
      );
    }
    const p = await build();
    expect(platform(p).improvement).toBe(T.LIKELY_IMPROVING);
    expect(platform(p).previous.negativeMentionRate).toBe(1);
    expect(platform(p).recent.positiveMentionRate).toBe(1);
  });
  it("keeps current self, internal and peer measurements distinct and invalidates on context edits", async () => {
    await complete(await review({ rating: 2 }));
    const a = await db.selfAssessment.create({
      data: {
        userId,
        sportId,
        overallLevel: "B",
        ratings: { create: { skillId: skills.passing, rating: 4 } },
      },
    });
    let p = await build();
    expect(passing(p)).toMatchObject({
      selfAssessment: 4,
      internalRating: 4,
      selfMinusPeer: 2,
      peer: { average: 2, count: 1 },
    });
    await db.selfAssessmentRating.update({
      where: {
        selfAssessmentId_skillId: {
          selfAssessmentId: a.id,
          skillId: skills.passing,
        },
      },
      data: { rating: 5 },
    });
    expect(await readOwnAnalysisProfile(db, userId, sportId)).toMatchObject({
      state: "STALE",
      data: null,
    });
    p = await build();
    expect(passing(p).selfAssessment).toBe(5);
    expect(passing(p).internalRating).toBe(4);
  });
  it("invalidates and masks a private cached profile after consent withdrawal", async () => {
    const f = await review();
    await observations(f, ["negative"]);
    await build();
    await db.feedback.update({
      where: { id: f.id },
      data: { privateAnalyticsAllowed: false },
    });
    expect(await readOwnAnalysisProfile(db, userId, sportId)).toEqual({
      state: "STALE",
      data: null,
    });
    expect((await build()).feedback).toBe(0);
  });
  it("preserves the last valid snapshot on failure, records sanitized errors, and permits a retry", async () => {
    await complete(await review());
    const before = await build();
    jest
      .spyOn(queries, "themeQuery")
      .mockRejectedValueOnce(new Error("private source content"));
    expect(await rebuildOneProfile(db, userId, sportId, asOf)).toBe(false);
    const row = await db.playerFeedbackAnalysisProfile.findUniqueOrThrow({
      where: { userId_sportId: { userId, sportId } },
    });
    expect(row.data).toEqual(before);
    expect(row.rebuildError).toBe("PROFILE_REBUILD_FAILED");
    expect(row.rebuildErrorAt).not.toBeNull();
    expect(row.rebuildRetryAt).not.toBeNull();
    expect(await readOwnAnalysisProfile(db, userId, sportId)).toMatchObject({
      state: "STALE",
    });
    expect(await rebuildOneProfile(db, userId, sportId, asOf)).toBe(true);
  });
  it("skips a concurrent rebuild while the player lock is held", async () => {
    await build();
    let release!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>((resolve) => (ready = resolve));
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const held = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(73011422,hashtext(${userId + ":" + sportId}))`;
        ready();
        await waiting;
      },
      { timeout: 15000 },
    );
    await locked;
    try {
      expect(await rebuildOneProfile(db, userId, sportId, asOf)).toBe(false);
    } finally {
      release();
      await held;
    }
    expect(await rebuildOneProfile(db, userId, sportId, asOf)).toBe(true);
  });
  it("refuses a stale aggregate when a source changes during calculation", async () => {
    const f = await review();
    await complete(f);
    const before = await build();
    const original = queries.skillQuery;
    jest
      .spyOn(queries, "skillQuery")
      .mockImplementationOnce(async (...args) => {
        const rows = await original(...args);
        await db.feedback.update({
          where: { id: f.id },
          data: { overallComment: "Changed during rebuild" },
        });
        return rows;
      });
    expect(await rebuildOneProfile(db, userId, sportId, asOf)).toBe(false);
    const row = await db.playerFeedbackAnalysisProfile.findUniqueOrThrow({
      where: { userId_sportId: { userId, sportId } },
    });
    expect(row.data).toEqual(before);
    expect(row.stale).toBe(true);
  });
  it("rebuilds expired profiles, uses bounded stale batches, and repeats deterministically", async () => {
    await complete(await review());
    const first = await build();
    const second = await build();
    expect({ ...first, calculatedAt: "" }).toEqual({
      ...second,
      calculatedAt: "",
    });
    await db.playerFeedbackAnalysisProfile.update({
      where: { userId_sportId: { userId, sportId } },
      data: { expiresAt: new Date(0) },
    });
    expect(await readOwnAnalysisProfile(db, userId, sportId)).toMatchObject({
      state: "STALE",
    });
    expect(await rebuildProfiles(db, 1)).toBeLessThanOrEqual(1);
    await rebuildOneProfile(db, userId, sportId, asOf);
    const service = new FeedbackAnalysisService(db as any);
    const cache = new Map();
    const spy = jest.spyOn(db.playerFeedbackAnalysisProfile, "upsert");
    await Promise.all([
      service.get(userId, sportId, cache),
      service.get(userId, sportId, cache),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("isolates authenticated player cache keys and never shares another player profile", async () => {
    await complete(await review({ rating: 5 }));
    await build();
    const other = await user();
    await rebuildOneProfile(db, other, sportId, asOf);
    const service = new FeedbackAnalysisService(db as any),
      cache = new Map();
    const [a, b] = await Promise.all([
      service.get(userId, sportId, cache),
      service.get(other, sportId, cache),
    ]);
    expect(a.profile?.feedback).toBe(1);
    expect(b.profile?.feedback).toBe(0);
    expect(a.profile?.playerId).toBe(userId);
    expect(b.profile?.playerId).toBe(other);
    await expect(service.get(userId, randomUUID())).rejects.toThrow(
      "sport not found",
    );
  });
  it("exposes guarded GraphQL profiles and isolates sessions without accepting player IDs", async () => {
    await complete(await review({ rating: 5 }));
    await build();
    const other = await user();
    await rebuildOneProfile(db, other, sportId, asOf);
    process.env.JWT_SECRET = "analysis-test-secret-at-least-32-characters";
    process.env.DATABASE_URL = url;
    process.env.NODE_ENV = "test";
    const { Test } = await import("@nestjs/testing");
    const { AppModule } = await import("../../src/app.module");
    const { PrismaService } = await import("../../src/prisma/prisma.service");
    const { GraphQLSchemaHost } = await import("@nestjs/graphql");
    const { JwtService } = await import("@nestjs/jwt");
    const { graphql } = await import("graphql");
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const schema = module.get(GraphQLSchemaHost).schema;
      const source = `query($sport:ID!) { myFeedbackAnalysisProfile(sportId:$sport) { state profile { playerId totalEligibleFeedbackCount } } mySkillAnalysis(sportId:$sport) { state skills { skillId peer {count average} } } myThemeTrends(sportId:$sport) { state themes {themeId} } myTopWeaknesses(sportId:$sport) {state weaknesses {themeId}} }`;
      const execute = async (actor?: string) => {
        const token = actor
          ? await module
              .get(JwtService)
              .signAsync({ id: actor, sub: actor, username: "fixture" })
          : undefined;
        return graphql({
          schema,
          source,
          variableValues: { sport: sportId },
          contextValue: {
            req: {
              headers: token ? { authorization: "Bearer " + token } : {},
              ip: "127.0.0.1",
            },
            res: { header: () => undefined, setHeader: () => undefined },
          },
        });
      };
      const unauthorized = await execute();
      expect(unauthorized.errors?.length).toBeGreaterThan(0);
      const spy = jest.spyOn(db.playerFeedbackAnalysisProfile, "upsert");
      const a = await execute(userId);
      expect(a.errors).toBeUndefined();
      expect(a.data?.myFeedbackAnalysisProfile).toMatchObject({
        state: "READY",
        profile: { playerId: userId, totalEligibleFeedbackCount: 1 },
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const b = await execute(other);
      expect(b.errors).toBeUndefined();
      expect(b.data?.myFeedbackAnalysisProfile).toMatchObject({
        profile: { playerId: other, totalEligibleFeedbackCount: 0 },
      });
      const invalid = await graphql({
        schema,
        source: `{ myFeedbackAnalysisProfile(sportId:"${sportId}", userId:"${other}") {state} }`,
      });
      expect(invalid.errors?.[0].message).toContain("Unknown argument");
    } finally {
      await app.close();
    }
  });
});
