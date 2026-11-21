import {Feedback } from "@prisma/client";
import {TestDatabase as PrismaClient,clerkId,clerkToken,fixtureRole}from"../helpers/clerk-fixtures";
import { randomUUID } from "node:crypto";
import { FeedbackProcessingWorker } from "../../src/feedback-processing/worker";
import {
  Embedder,
  Extractor,
  ExtractionInput,
  ProcessingError,
} from "../../src/feedback-processing/contracts";
import {
  readOwnAnalysisProfile,
  rebuildOneProfile,
} from "../../src/feedback-processing/profiles";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "write-time feedback processing PostgreSQL",
  () => {
    let db: PrismaClient,
      worker: FeedbackProcessingWorker,
      sportId: string,
      skillId: string,
      userId: string,
      reviewerId: string;
    let extract: jest.Mock, embed: jest.Mock;
    const eligible = {
      submittedAt: new Date(),
      status: "PUBLISHED" as const,
      privateAnalyticsAllowed: true,
      privateCoachingAllowed: true,
      privacyNoticeVersion: "feedback-privacy-v1",
      privateAnalyticsConsentAt: new Date(),
      privateCoachingConsentAt: new Date(),
      analyticsAllowed: true,
      evidenceAllowed: true,
    };
    const result = (input: ExtractionInput) => ({
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
      inputTokens: 20,
      outputTokens: 40,
    });
    const embedder = (): Embedder => ({
      provider: "test",
      model: "test-vector",
      modelVersion: "v1",
      dimensions: 3,
      embed,
    });
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      const sport = await db.sport.upsert({
        where: { slug: "beach-volleyball" },
        update: {},
        create: { name: "Beach Volleyball", slug: "beach-volleyball" },
      });
      sportId = sport.id;
      const skill = await db.skill.upsert({
        where: { sportId_slug: { sportId, slug: "passing" } },
        update: {},
        create: { sportId, name: "Passing", slug: "passing" },
      });
      skillId = skill.id;
      const users = await Promise.all(
        [0, 1].map(() => {
          const id = clerkId();
          return db.user.create({
            data: {
              username: id,
              email: `${id}@example.test`,
              passwordHash: "not-login",
              age: 25,
              heightCm: 180,
            },
          });
        }),
      );
      [userId, reviewerId] = users.map((u) => u.id);
    });
    beforeEach(async () => {
      await db.feedback.deleteMany({ where: { recipientId: userId } });
      extract = jest.fn(async (input: ExtractionInput) => result(input));
      embed = jest.fn(async () => [0.1, 0.2, 0.3]);
      const extractor: Extractor = {
        provider: "test",
        modelVersion: "v1",
        extract,
      };
      worker = new FeedbackProcessingWorker(db, extractor, embedder(), {
        playerId: userId,
      });
    });
    afterAll(async () => {
      await db?.feedback.deleteMany({ where: { recipientId: userId } });
      await db?.$disconnect();
    });
    async function feedback(overrides: Partial<Feedback> = {}) {
      return db.feedback.create({
        data: {
          recipientId: userId,
          reviewerId,
          submittedById: reviewerId,
          sportId,
          ...eligible,
          overallComment: "Stable platform helps.",
          ...overrides,
          ratings: { create: { skillId, rating: 4 } },
        },
      });
    }
    const job = (id: string) =>
      db.feedbackAnalysisJob.findUniqueOrThrow({ where: { feedbackId: id } });
    const observations = () =>
      db.feedbackObservation.findMany({
        where: { job: { feedback: { recipientId: userId } } },
      });
    it("queues transactionally, extracts once, records provenance, embeds and rebuilds private profile", async () => {
      const f = await feedback();
      expect((await job(f.id)).status).toBe("PENDING");
      expect(extract).not.toHaveBeenCalled();
      expect(await worker.extractOne()).toBe(true);
      expect(await worker.extractOne()).toBe(false);
      const rows = await observations();
      expect(rows).toHaveLength(1);
      expect(rows[0].sourceKey).toBe("overall");
      expect(rows[0].sourceHash).toHaveLength(64);
      expect(await worker.embedOne()).toBe(true);
      expect(await worker.embedOne()).toBe(false);
      const vectors = await db.$queryRaw<
        { dims: number; hash: string }[]
      >`SELECT vector_dims(vector) AS dims,"sourceHash" AS hash FROM "FeedbackObservationEmbedding" WHERE "observationId"=${rows[0].id}::uuid`;
      expect(vectors[0].dims).toBe(3);
      expect(vectors[0].hash).toHaveLength(64);
      const run = await db.feedbackExtractionRun.findFirstOrThrow({
        where: { feedbackId: f.id },
      });
      expect(run).toMatchObject({
        status: "COMPLETED",
        inputTokens: 20,
        outputTokens: 40,
        apiAttempts: 1,
      });
      await rebuildOneProfile(db, userId, sportId);
      expect(await readOwnAnalysisProfile(db, userId, sportId)).toMatchObject({
        state: "READY",
        data: { feedback: 1 },
      });
      expect(await readOwnAnalysisProfile(db, reviewerId, sportId)).toEqual({
        state: "STALE",
        data: null,
      });
    });
    it("rolls back the job with the original transaction", async () => {
      const id = randomUUID();
      await expect(
        db.$transaction(async (tx) => {
          await tx.feedback.create({
            data: { id, recipientId: userId, reviewerId, sportId, ...eligible },
          });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(
        await db.feedbackAnalysisJob.findUnique({ where: { feedbackId: id } }),
      ).toBeNull();
    });
    it.each([
      { status: "PENDING" },
      { status: "HIDDEN" },
      { status: "DELETED" },
      { status: "REJECTED" },
      { privateAnalyticsAllowed: false },
      { privateCoachingAllowed: false },
      { approvalRequired: true },
    ])("does not process ineligible feedback %j", async (override) => {
      const f = await feedback(override as Partial<Feedback>);
      expect((await job(f.id)).status).toBe("SKIPPED");
      expect(await worker.extractOne()).toBe(false);
    });
    it("starts after actual reviewer approval and clears results if consent is withdrawn", async () => {
      const f = await feedback({ approvalRequired: true, status: "PENDING" });
      await db.feedback.update({
        where: { id: f.id },
        data: { ...eligible, approvedAt: new Date(), approvedById: reviewerId },
      });
      await worker.extractOne();
      await worker.embedOne();
      await rebuildOneProfile(db, userId, sportId);
      await db.feedback.update({
        where: { id: f.id },
        data: { privateAnalyticsAllowed: false },
      });
      expect(await observations()).toHaveLength(0);
      expect(
        await db.feedbackObservationEmbedding.count({
          where: {
            observation: { job: { feedback: { recipientId: userId } } },
          },
        }),
      ).toBe(0);
      expect(await readOwnAnalysisProfile(db, userId, sportId)).toEqual({
        state: "STALE",
        data: null,
      });
      expect((await job(f.id)).status).toBe("SKIPPED");
    });
    it("numeric edits invalidate aggregates without re-extraction; comment edits replace derived records", async () => {
      const f = await feedback();
      await worker.extractOne();
      const before = await job(f.id);
      await rebuildOneProfile(db, userId, sportId);
      await db.feedbackRating.update({
        where: { feedbackId_skillId: { feedbackId: f.id, skillId } },
        data: { rating: 2 },
      });
      expect((await job(f.id)).generation).toBe(before.generation);
      expect((await job(f.id)).status).toBe("COMPLETED");
      expect(await readOwnAnalysisProfile(db, userId, sportId)).toMatchObject({
        state: "STALE",
      });
      await db.feedbackRating.update({
        where: { feedbackId_skillId: { feedbackId: f.id, skillId } },
        data: { comment: "Stable platform on serve receive" },
      });
      expect((await job(f.id)).generation).toBeGreaterThan(before.generation);
      expect(await observations()).toHaveLength(0);
      await worker.extractOne();
      expect(await observations()).toHaveLength(1);
    });
    it("rejects output when a source is edited or eligibility is revoked during the API call", async () => {
      const f = await feedback();
      extract.mockImplementationOnce(async (input: ExtractionInput) => {
        await db.feedback.update({
          where: { id: f.id },
          data: { overallComment: "New comment" },
        });
        return result(input);
      });
      await worker.extractOne();
      expect(await observations()).toHaveLength(0);
      expect((await job(f.id)).status).toBe("PENDING");
      expect(
        await db.feedbackExtractionRun.findFirst({
          where: { feedbackId: f.id },
        }),
      ).toMatchObject({ status: "DISCARDED" });
    });
    it("rejects superseded lease output, even for the same generation", async () => {
      const f = await feedback();
      const other = new FeedbackProcessingWorker(
        db,
        {
          provider: "test",
          modelVersion: "v1",
          extract: async (i) => result(i),
        },
        embedder(),
        { playerId: userId },
      );
      extract.mockImplementationOnce(async (input: ExtractionInput) => {
        await db.feedbackAnalysisJob.update({
          where: { feedbackId: f.id },
          data: { leaseUntil: new Date(0) },
        });
        await other.extractOne();
        return result(input);
      });
      await worker.extractOne();
      expect(await observations()).toHaveLength(1);
      expect((await job(f.id)).status).toBe("COMPLETED");
      const runs = await db.feedbackExtractionRun.findMany({
        where: { feedbackId: f.id },
      });
      expect(runs.filter((r) => r.status === "COMPLETED")).toHaveLength(1);
    });
    it("retries malformed extraction once, and retains failed jobs without duplicating observations", async () => {
      const f = await feedback();
      extract.mockResolvedValue({ value: {}, inputTokens: 2, outputTokens: 1 });
      await worker.extractOne();
      expect(extract).toHaveBeenCalledTimes(2);
      expect((await job(f.id)).status).toBe("FAILED");
      expect(await observations()).toHaveLength(0);
    });
    it("backs off transient errors and eventually fails after the retry budget", async () => {
      const f = await feedback();
      extract.mockRejectedValue(new ProcessingError("PROVIDER_HTTP_429"));
      await worker.extractOne();
      expect((await job(f.id)).status).toBe("PENDING");
      expect(await worker.extractOne()).toBe(false);
      await db.feedbackAnalysisJob.update({
        where: { feedbackId: f.id },
        data: { attempts: 4, runAfter: new Date(0) },
      });
      await worker.extractOne();
      expect((await job(f.id)).status).toBe("FAILED");
    });
    it("allows negative sports feedback but quarantines moderation separately", async () => {
      const f = await feedback();
      extract.mockImplementationOnce(async (i) => ({
        ...result(i),
        value: { ...result(i).value, moderation: "INJECTION" },
      }));
      await worker.extractOne();
      expect((await job(f.id)).moderation).toBe("INJECTION");
      expect(await observations()).toHaveLength(0);
      expect(
        await db.feedback.findUnique({ where: { id: f.id } }),
      ).toMatchObject({ status: "PUBLISHED" });
    });
    it("supports no-comment feedback without calling the LLM", async () => {
      const f = await feedback({ overallComment: null });
      await worker.extractOne();
      expect(extract).not.toHaveBeenCalled();
      expect((await job(f.id)).status).toBe("COMPLETED");
    });
    it("retries embeddings independently and retains multiple model versions", async () => {
      await feedback();
      await worker.extractOne();
      embed.mockRejectedValueOnce(new ProcessingError("EMBEDDING_UNAVAILABLE"));
      await worker.embedOne();
      expect(extract).toHaveBeenCalledTimes(1);
      await db.feedbackEmbeddingJob.updateMany({
        where: {
          status: "PENDING",
          observation: { job: { feedback: { recipientId: userId } } },
        },
        data: { runAfter: new Date(0) },
      });
      await worker.embedOne();
      expect(extract).toHaveBeenCalledTimes(1);
      const next = new FeedbackProcessingWorker(
        db,
        worker.extractor,
        {
          ...embedder(),
          modelVersion: "v2",
        },
        { playerId: userId },
      );
      expect(await next.enqueueEmbeddings()).toBe(1);
      expect(await next.enqueueEmbeddings()).toBe(0);
      await next.embedOne();
      expect(
        await db.feedbackObservationEmbedding.count({
          where: {
            observation: { job: { feedback: { recipientId: userId } } },
          },
        }),
      ).toBe(2);
    });
    it("does not save embedding output when consent changes while the API runs", async () => {
      const f = await feedback();
      await worker.extractOne();
      embed.mockImplementationOnce(async () => {
        await db.feedback.update({
          where: { id: f.id },
          data: { privateCoachingAllowed: false },
        });
        return [0.1, 0.2, 0.3];
      });
      await worker.embedOne();
      expect(
        await db.feedbackObservationEmbedding.count({
          where: {
            observation: { job: { feedback: { recipientId: userId } } },
          },
        }),
      ).toBe(0);
    });
    it("deletion cascades observations, vectors and jobs and invalidates profiles", async () => {
      const f = await feedback();
      await worker.extractOne();
      await worker.embedOne();
      await rebuildOneProfile(db, userId, sportId);
      await db.feedback.delete({ where: { id: f.id } });
      expect(await observations()).toHaveLength(0);
      expect(
        await db.feedbackObservationEmbedding.count({
          where: {
            observation: { job: { feedback: { recipientId: userId } } },
          },
        }),
      ).toBe(0);
      expect(
        await db.feedbackAnalysisJob.findUnique({
          where: { feedbackId: f.id },
        }),
      ).toBeNull();
      expect(await readOwnAnalysisProfile(db, userId, sportId)).toMatchObject({
        state: "STALE",
      });
    });
    it("counts a combined multi-match review once, preserving its match links", async () => {
      const matches = await Promise.all(
        [0, 1].map(() =>
          db.match.create({
            data: { createdById: userId, sportId, status: "COMPLETED" },
          }),
        ),
      );
      const f = await feedback();
      await db.feedbackMatch.createMany({
        data: matches.map((m) => ({ feedbackId: f.id, matchId: m.id })),
      });
      await worker.extractOne();
      await rebuildOneProfile(db, userId, sportId);
      expect(await readOwnAnalysisProfile(db, userId, sportId)).toMatchObject({
        data: { feedback: 1 },
      });
      expect(
        await db.feedbackMatch.count({ where: { feedbackId: f.id } }),
      ).toBe(2);
    });
    it("accepts ordinary negative observations and invalidates profiles on taxonomy changes", async () => {
      await feedback();
      extract.mockImplementationOnce(async (i) => ({
        ...result(i),
        value: {
          moderation: "ALLOW",
          observations: [
            { ...result(i).value.observations[0], sentiment: "negative" },
          ],
        },
      }));
      await worker.extractOne();
      await rebuildOneProfile(db, userId, sportId);
      expect((await observations())[0].sentiment).toBe("negative");
      await db.feedbackTheme.update({
        where: { id: "platform_control" },
        data: { active: false },
      });
      expect(await readOwnAnalysisProfile(db, userId, sportId)).toMatchObject({
        state: "STALE",
      });
      const rows = await db.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "EligibleFeedbackObservation" WHERE "feedbackId" IN (SELECT id FROM "Feedback" WHERE "recipientId"=${userId}::text)`;
      expect(rows).toHaveLength(0);
      await db.feedbackTheme.update({
        where: { id: "platform_control" },
        data: { active: true },
      });
    });
    it("enforces vector dimensions in PostgreSQL, not only in the provider adapter", async () => {
      await feedback();
      await worker.extractOne();
      await worker.embedOne();
      const [observation] = await observations();
      await expect(
        db.$executeRaw`UPDATE "FeedbackObservationEmbedding" SET vector='[1,2]'::vector WHERE "observationId"=${observation.id}::uuid`,
      ).rejects.toThrow();
    });
    it("only one concurrent worker claims an available extraction job", async () => {
      await feedback();
      const outcomes = await Promise.all([
        worker.extractOne(),
        worker.extractOne(),
      ]);
      expect(outcomes.sort()).toEqual([false, true]);
      expect(extract).toHaveBeenCalledTimes(1);
      expect(await observations()).toHaveLength(1);
    });
  },
);
