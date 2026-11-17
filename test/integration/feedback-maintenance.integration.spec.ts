import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  options,
  inventory,
  enqueueHistorical,
} from "../../src/feedback-processing/maintenance";
import { FeedbackProcessingWorker } from "../../src/feedback-processing/worker";
import { ExtractionInput } from "../../src/feedback-processing/contracts";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("historical feedback maintenance", () => {
  let db: PrismaClient,
    player: string,
    other: string,
    sport: string,
    skill: string;
  const env = {
    FEEDBACK_EXTRACTION_MODEL: "fixture-extract",
    FEEDBACK_EMBEDDING_MODEL: "fixture-vector",
    FEEDBACK_EMBEDDING_VERSION: "v1",
    FEEDBACK_EMBEDDING_DIMENSIONS: "3",
  };
  const extract = jest.fn(async (input: ExtractionInput) => ({
    value: {
      moderation: "ALLOW",
      observations: [
        {
          sourceKey: input.sources[0].key,
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
  const worker = () =>
    new FeedbackProcessingWorker(
      db,
      {
        provider: "openai",
        modelVersion: env.FEEDBACK_EXTRACTION_MODEL,
        extract,
      },
      {
        provider: "openai",
        model: env.FEEDBACK_EMBEDDING_MODEL,
        modelVersion: "v1",
        dimensions: 3,
        embed,
      },
      { playerId: player },
    );
  const opts = () =>
    options(["enqueue", "--all", "--batch-size", "1", "--player-id", player]);
  const feedback = (extra: object = {}) =>
    db.feedback.create({
      data: {
        recipientId: player,
        reviewerId: other,
        submittedById: player,
        sportId: sport,
        status: "PUBLISHED",
        privateAnalyticsAllowed: true, privateCoachingAllowed: true, privacyNoticeVersion: "feedback-privacy-v1", privateAnalyticsConsentAt: new Date(), privateCoachingConsentAt: new Date(),
      analyticsAllowed: true,
        evidenceAllowed: true,
        overallComment: "Stable platform helps",
        ratings: {
          create: { skillId: skill, rating: 4, comment: "Stable platform" },
        },
        ...extra,
      },
    });
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    sport = (
      await db.sport.upsert({
        where: { slug: "beach-volleyball" },
        create: { slug: "beach-volleyball", name: "Beach Volleyball" },
        update: {},
      })
    ).id;
    skill = (
      await db.skill.upsert({
        where: { sportId_slug: { sportId: sport, slug: "passing" } },
        create: { sportId: sport, slug: "passing", name: "Passing" },
        update: { active: true },
      })
    ).id;
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
    [player, other] = users.map((u) => u.id);
  });
  afterEach(async () => {
    await db.feedback.deleteMany({
      where: { recipientId: { in: [player, other] } },
    });
    extract.mockClear();
    embed.mockClear();
  });
  afterAll(async () => {
    await db.playerFeedbackAnalysisProfile.deleteMany({
      where: { userId: { in: [player, other] } },
    });
    await db.user.deleteMany({ where: { id: { in: [player, other] } } });
    await db.$disconnect();
  });
  it("previews without writes, includes per-skill comments, scopes work, and resumes without duplicate calls", async () => {
    const f = await feedback({ overallComment: null });
    await feedback({ recipientId: other, reviewerId: player });
    const before = new Date();
    const p = await inventory(db, opts(), before, env);
    expect(p.counts).toMatchObject({
      eligible: 1,
      remaining: 1,
      needsExtraction: 1,
    });
    expect(p.estimatedOperations.llmRequests.minimum).toBe(1);
    expect(extract).not.toHaveBeenCalled();
    expect(
      await db.feedbackObservation.count({ where: { feedbackId: f.id } }),
    ).toBe(0);
    await enqueueHistorical(db, opts(), before, env);
    const w = worker();
    expect(await w.extractOne()).toBe(true);
    expect(await w.extractOne()).toBe(false);
    expect(extract.mock.calls[0][0].sources).toEqual([
      { key: `skill:${skill}`, text: "Stable platform" },
    ]);
    expect((await inventory(db, opts(), before, env)).counts.remaining).toBe(1); // Vector pending.
    expect(await w.embedOne()).toBe(true);
    expect(await w.embedOne()).toBe(false);
    expect((await inventory(db, opts(), before, env)).counts).toMatchObject({
      eligible: 1,
      skipped: 1,
      remaining: 0,
    });
    expect(await enqueueHistorical(db, opts(), before, env)).toBe(0);
    expect(await w.extractOne()).toBe(false);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
  });
  it("excludes consent, approval, publication and moderation failures; counts numeric-only without AI", async () => {
    await feedback({ privateAnalyticsAllowed: false });
    await feedback({ privateCoachingAllowed: false });
    await feedback({ status: "HIDDEN" });
    await feedback({ reviewerId: other, approvalRequired: true });
    const blocked = await feedback();
    await db.feedbackAnalysisJob.update({
      where: { feedbackId: blocked.id },
      data: { moderation: "PII", status: "SKIPPED" },
    });
    await feedback({
      overallComment: null,
      ratings: { create: { skillId: skill, rating: 5 } },
    });
    const p = await inventory(db, opts(), new Date(), env);
    expect(p.counts).toMatchObject({
      eligible: 1,
      numericOnly: 1,
      skipped: 1,
      needsExtraction: 0,
    });
    expect(await enqueueHistorical(db, opts(), new Date(), env)).toBe(0);
    expect(extract).not.toHaveBeenCalled();
  });
  it("requeues version changes once, preserves failures for explicit retry, and invalidates profiles", async () => {
    const f = await feedback();
    const w = worker();
    await w.extractOne();
    await w.embedOne();
    expect(
      await enqueueHistorical(db, opts(), new Date(), {
        ...env,
        FEEDBACK_EXTRACTION_MODEL: "new-version",
      }),
    ).toBe(1);
    expect(
      await enqueueHistorical(db, opts(), new Date(), {
        ...env,
        FEEDBACK_EXTRACTION_MODEL: "new-version",
      }),
    ).toBe(0);
    await db.feedbackAnalysisJob.update({
      where: { feedbackId: f.id },
      data: { status: "FAILED" },
    });
    expect(await enqueueHistorical(db, opts(), new Date(), env)).toBe(0);
    expect((await inventory(db, opts(), new Date(), env)).counts.failed).toBe(
      1,
    );
    expect(
      (
        await db.playerFeedbackAnalysisProfile.findUniqueOrThrow({
          where: { userId_sportId: { userId: player, sportId: sport } },
        })
      ).stale,
    ).toBe(true);
  });
});
