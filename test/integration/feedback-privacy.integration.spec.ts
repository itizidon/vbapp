import { PrismaClient, Feedback, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import {
  FeedbackPrivacyService,
  PRIVACY_NOTICE_VERSION,
} from "../../src/feedback/privacy";
import { FeedbackProcessingWorker } from "../../src/feedback-processing/worker";
import { PrismaService } from "../../src/prisma/prisma.service";
import { rebuildOneProfile } from "../../src/feedback-processing/profiles";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("purpose-specific feedback privacy", () => {
  let db: PrismaClient,
    service: FeedbackPrivacyService,
    recipient: string,
    reviewer: string,
    sport: string,
    skill: string;
  const jwt = new JwtService({ secret: "privacy-test-secret-only" });
  const grant = {
    privateAnalyticsAllowed: true,
    privateCoachingAllowed: true,
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    privateAnalyticsConsentAt: new Date(),
    privateCoachingConsentAt: new Date(),
  };
  const make = (extra: Partial<Feedback> = {}) =>
    db.feedback.create({
      data: {
        recipientId: recipient,
        submittedAt: new Date(), submittedById: reviewer,
        reviewerId: reviewer,
        sportId: sport,
        status: "PUBLISHED",
        overallComment: "Stable platform",
        ...grant,
        ...extra,
        ratings: {
          create: { skillId: skill, rating: 4, comment: "Stable platform" },
        },
      },
    });
  const eligible = async (id: string) => {
    const [r] = await db.$queryRaw<
      { analytics: boolean; coaching: boolean }[]
    >`SELECT feedback_private_analytics_eligible(f) AS analytics,feedback_analysis_eligible(f) AS coaching FROM "Feedback" f WHERE id=${id}::uuid`;
    return r;
  };
  const worker = () => {
    const extract = jest.fn(async () => ({
      value: {
        moderation: "ALLOW",
        observations: [
          {
            sourceKey: "overall",
            skill: "passing",
            theme: "platform_control",
            sentiment: "positive",
            evidence: "Stable platform",
          },
        ],
      },
      inputTokens: 1,
      outputTokens: 1,
    }));
    const embed = jest.fn(async () => [0.1, 0.2, 0.3]);
    return {
      extract,
      embed,
      w: new FeedbackProcessingWorker(
        db,
        { provider: "openai", modelVersion: "test", extract },
        {
          provider: "openai",
          model: "test",
          modelVersion: "v1",
          dimensions: 3,
          embed,
        },
        { playerId: recipient },
      ),
    };
  };
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    service = new FeedbackPrivacyService(db as PrismaService, jwt);
    sport = (
      await db.sport.upsert({
        where: { slug: "beach-volleyball" },
        create: { name: "Beach Volleyball", slug: "beach-volleyball" },
        update: {},
      })
    ).id;
    skill = (
      await db.skill.upsert({
        where: { sportId_slug: { sportId: sport, slug: "passing" } },
        create: { sportId: sport, name: "Passing", slug: "passing" },
        update: { active: true },
      })
    ).id;
  });
  beforeEach(async () => {
    const users = await Promise.all(
      [0, 1].map(() => {
        const id = randomUUID();
        return db.user.create({
          data: {
            username: id,
            email: id + "@example.test",
            passwordHash: "fixture",
            age: 25,
            heightCm: 180,
          },
        });
      }),
    );
    [recipient, reviewer] = users.map((u) => u.id);
  });
  afterEach(async () => {
    await db.aiCoachConversation.deleteMany({ where: { userId: recipient } });
    await db.feedback.deleteMany({ where: { recipientId: recipient } });
    await db.match.deleteMany({ where: { createdById: recipient } });
    await db.playerFeedbackAnalysisProfile.deleteMany({
      where: { userId: recipient },
    });
    await db.user.deleteMany({ where: { id: { in: [recipient, reviewer] } } });
  });
  afterAll(() => db.$disconnect());
  it("allows private AI without public consent, preserves old flags, and never promotes historical permissions", async () => {
    const current = await make({
      analyticsAllowed: false,
      evidenceAllowed: false,
    });
    expect(await eligible(current.id)).toEqual({
      analytics: true,
      coaching: true,
    });
    expect(current.publicAnalyticsAllowed).toBe(false);
    const legacy = await make({
      privateAnalyticsAllowed: false,
      privateCoachingAllowed: false,
      privacyNoticeVersion: null,
      privateAnalyticsConsentAt: null,
      privateCoachingConsentAt: null,
      analyticsAllowed: true,
      evidenceAllowed: true,
    });
    expect(await eligible(legacy.id)).toEqual({
      analytics: false,
      coaching: false,
    });
    const { w, extract, embed } = worker();
    expect(await w.extractOne()).toBe(true);
    expect(await w.extractOne()).toBe(false);
    await w.embedOne();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(
      (await db.feedback.findUniqueOrThrow({ where: { id: legacy.id } }))
        .analyticsAllowed,
    ).toBe(true);
  });
  it("supports private numerical-only analytics without sending it to an AI profile", async () => {
    const f = await make({
      privateCoachingAllowed: false,
      privateCoachingConsentAt: null,
      overallComment: null,
    });
    expect(await eligible(f.id)).toEqual({ analytics: true, coaching: false });
    const rows =
      await db.$queryRaw`SELECT id FROM "PrivateAnalyticsEligibleFeedback" WHERE id=${f.id}::uuid`;
    expect(rows).toHaveLength(1);
    expect(
      await db.$queryRaw`SELECT id FROM "AnalysisEligibleFeedback" WHERE id=${f.id}::uuid`,
    ).toHaveLength(0);
    expect(await worker().w.extractOne()).toBe(false);
  });
  it.each(["PENDING", "REJECTED", "HIDDEN", "DELETED"] as const)(
    "excludes %s feedback",
    async (status) => {
      const f = await make({ status });
      expect((await eligible(f.id)).coaching).toBe(false);
      expect(await worker().w.extractOne()).toBe(false);
    },
  );
  it("records independent public consent and preserves private consent timestamps", async () => {
    const f = await make();
    const row = await service.update(reviewer, {
      feedbackId: f.id,
      publicAnalyticsAllowed: true,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    });
    expect(row.publicAnalyticsAllowed).toBe(true);
    expect(row.publicConsentAt).toBeInstanceOf(Date);
    expect(row.privateCoachingConsentAt).toEqual(f.privateCoachingConsentAt);
    expect(
      await db.feedbackPrivacyEvent.count({
        where: {
          feedbackId: f.id,
          purpose: "PUBLIC_AGGREGATES",
          allowed: true,
        },
      }),
    ).toBe(1);
    await service.update(reviewer, {
      feedbackId: f.id,
      publicAnalyticsAllowed: false,
    });
    expect((await eligible(f.id)).coaching).toBe(true);
  });
  it("does not undo a moderation exclusion when processing choices change", async () => {
    const f = await make();
    await db.feedbackAnalysisJob.update({
      where: { feedbackId: f.id },
      data: { moderation: "PII", status: "SKIPPED" },
    });
    await service.update(reviewer, {
      feedbackId: f.id,
      privateCoachingAllowed: false,
    });
    await service.update(reviewer, {
      feedbackId: f.id,
      privateCoachingAllowed: true,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    });
    expect(
      (
        await db.feedbackAnalysisJob.findUniqueOrThrow({
          where: { feedbackId: f.id },
        })
      ).moderation,
    ).toBe("PII");
    expect(await worker().w.extractOne()).toBe(false);
  });
  it("requires actual assigned-reviewer approval even after permission is granted", async () => {
    const f = await make({
      status: "PENDING",
      approvalRequired: true,
      submittedById: recipient,
      privateAnalyticsAllowed: false,
      privateCoachingAllowed: false,
    });
    await expect(
      service.update(recipient, {
        feedbackId: f.id,
        privateCoachingAllowed: true,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      }),
    ).rejects.toThrow();
    await service.update(reviewer, {
      feedbackId: f.id,
      privateAnalyticsAllowed: true,
      privateCoachingAllowed: true,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    });
    expect((await eligible(f.id)).coaching).toBe(false);
    await db.feedback.update({
      where: { id: f.id },
      data: {
        status: "PUBLISHED",
        approvedById: reviewer,
        approvedAt: new Date(),
      },
    });
    expect((await eligible(f.id)).coaching).toBe(true);
  });
  it("withdraws with audit events, removes vectors and persisted answer evidence, and invalidates the profile", async () => {
    const f = await make();
    const { w } = worker();
    await w.extractOne();
    await w.embedOne();
    await rebuildOneProfile(db, recipient, sport);
    const c = await db.aiCoachConversation.create({
      data: {
        userId: recipient,
        sportId: sport,
        title: "fixture",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const turn = await db.aiCoachTurn.create({
      data: {
        userId: recipient,
        conversationId: c.id,
        clientRequestId: randomUUID(),
        requestHash: "fixture",
        question: "What changed?",
        promptVersion: "test",
        status: "COMPLETED",
        response: { message: "Stable platform" },
      },
    });
    await service.update(reviewer, {
      feedbackId: f.id,
      privateCoachingAllowed: false,
    });
    expect(await eligible(f.id)).toEqual({ analytics: true, coaching: false });
    expect(
      await db.feedbackObservation.count({ where: { feedbackId: f.id } }),
    ).toBe(0);
    expect(
      (await db.aiCoachTurn.findUniqueOrThrow({ where: { id: turn.id } }))
        .response,
    ).toBeNull();
    expect(
      (
        await db.playerFeedbackAnalysisProfile.findUniqueOrThrow({
          where: { userId_sportId: { userId: recipient, sportId: sport } },
        })
      ).stale,
    ).toBe(true);
    expect(
      await db.feedbackPrivacyEvent.count({
        where: {
          feedbackId: f.id,
          allowed: false,
          purpose: "PRIVATE_COACHING",
        },
      }),
    ).toBe(1);
    expect(
      await db.feedbackRating.findMany({
        where: { feedbackId: f.id },
        select: { rating: true },
      }),
    ).toEqual([{ rating: new Prisma.Decimal(4) }]);
  });
  it("grants no identity access with a guest receipt and supports withdrawal without a login", async () => {
    const f = await make({
      reviewerId: null,
      guestName: "Unverified guest",
      guestInviteNonce: randomUUID(),
    });
    const receipt = await service.guestReceipt(f);
    expect(receipt.privacyWithdrawalToken).toBeTruthy();
    await service.withdrawGuest(receipt.privacyWithdrawalToken!);
    expect((await eligible(f.id)).analytics).toBe(false);
    await expect(
      service.withdrawGuest(
        await jwt.signAsync({ kind: "login", feedbackId: f.id }),
      ),
    ).rejects.toThrow();
    expect(
      await db.feedbackPrivacyEvent.count({
        where: { feedbackId: f.id, actorRole: "GUEST_RECEIPT" },
      }),
    ).toBe(2);
  });
  it("removes only derived data on recipient opt-out and does not override reviewer permissions on re-enable", async () => {
    const f = await make();
    const { w } = worker();
    await w.extractOne();
    await w.embedOne();
    await db.user.update({
      where: { id: recipient },
      data: { aiCoachingEnabled: false },
    });
    expect(await eligible(f.id)).toEqual({ analytics: true, coaching: false });
    expect(
      await db.feedbackObservation.count({ where: { feedbackId: f.id } }),
    ).toBe(0);
    await service.update(reviewer, {
      feedbackId: f.id,
      privateCoachingAllowed: false,
    });
    await db.user.update({
      where: { id: recipient },
      data: { aiCoachingEnabled: true },
    });
    expect((await eligible(f.id)).coaching).toBe(false);
    expect(await w.extractOne()).toBe(false);
  });
  it("processes combined multi-match feedback once and hiding invalidates it", async () => {
    const f = await make();
    for (let i = 0; i < 2; i++) {
      const m = await db.match.create({
        data: { createdById: recipient, sportId: sport, status: "COMPLETED" },
      });
      await db.feedbackMatch.create({
        data: { feedbackId: f.id, matchId: m.id },
      });
    }
    const { w, extract } = worker();
    await w.extractOne();
    expect(await w.extractOne()).toBe(false);
    expect(extract).toHaveBeenCalledTimes(1);
    await db.feedback.update({
      where: { id: f.id },
      data: { status: "HIDDEN" },
    });
    expect(
      await db.feedbackObservation.count({ where: { feedbackId: f.id } }),
    ).toBe(0);
  });
});
