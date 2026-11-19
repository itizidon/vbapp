import { PrismaClient, Feedback, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { FeedbackService } from "../../src/feedback/feedback.service";
import { FeedbackPrivacyService } from "../../src/feedback/privacy";
import { SelfAssessmentsService } from "../../src/self-assessments/self-assessments.service";
import { FeedbackProcessingWorker } from "../../src/feedback-processing/worker";
import { rebuildOneProfile } from "../../src/feedback-processing/profiles";
import { FeedbackAnalysisProfile } from "../../src/feedback-analysis/models";
import {
  isEligibleForAiAnalysis,
  isEligibleForInternalRating,
} from "../../src/feedback/eligibility";
import { CoachTools } from "../../src/ai-coach/tools";
import { profileFacts, observationFact } from "../../src/ai-coach/facts";
import {
  inventory,
  enqueueHistorical,
  options,
} from "../../src/feedback-processing/maintenance";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "separate AI trust and internal rating eligibility",
  () => {
    let db: PrismaClient,
      service: FeedbackService,
      privacy: FeedbackPrivacyService,
      sportId: string,
      skillId: string,
      recipient: string,
      reviewer: string,
      worker: FeedbackProcessingWorker;
    const jwt = new JwtService({
      secret: "trust-integration-only-long-jwt-secret-32",
    });
    const grant = {
      privateAnalyticsAllowed: true,
      privateCoachingAllowed: true,
      privacyNoticeVersion: "feedback-privacy-v1",
    };
    let extract: jest.Mock, embed: jest.Mock;
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      service = new FeedbackService(db as never, jwt);
      privacy = new FeedbackPrivacyService(db as never, jwt);
      sportId = (
        await db.sport.upsert({
          where: { slug: "beach-volleyball" },
          create: { slug: "beach-volleyball", name: "Beach Volleyball" },
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
      const ids = [];
      for (let i = 0; i < 2; i++) {
        const id = randomUUID();
        await db.user.create({
          data: {
            id,
            username: id,
            email: id + "@example.test",
            passwordHash: "fixture",
            age: 25,
            heightCm: 180,
          },
        });
        await new SelfAssessmentsService(db as never).create(id, {
          sportId,
          overallLevel: "B",
          ratings: [{ skillId, rating: 3 }],
        });
        ids.push(id);
      }
      [recipient, reviewer] = ids;
      extract = jest.fn(async (input) => ({
        value: {
          moderation: "ALLOW",
          observations: input.sources.map((s: { key: string }) => ({
            sourceKey: s.key,
            skill: "passing",
            theme: "platform_control",
            sentiment: "negative",
            evidence: "Platform needs work",
          })),
        },
        inputTokens: 10,
        outputTokens: 20,
      }));
      embed = jest.fn(async () => [0.1, 0.2, 0.3]);
      worker = new FeedbackProcessingWorker(
        db,
        { provider: "openai", modelVersion: "trust-test", extract },
        {
          provider: "test",
          model: "trust",
          modelVersion: "v1",
          dimensions: 3,
          embed,
        },
        { playerId: recipient },
      );
    });
    afterEach(async () => {
      while (await worker.extractOne()) {}
      while (await worker.embedOne()) {}
    });
    afterAll(() => db.$disconnect());
    const input = () => ({
      recipientId: recipient,
      sportId,
      ...grant,
      overallComment: "Platform needs work",
      ratings: [{ skillId, rating: 4.7, comment: "Platform needs work" }],
    });
    const events = () =>
      db.playerInternalRatingEvent.findMany({
        where: { userId: recipient },
        orderBy: { sequence: "asc" },
      });
    const guest = async () => {
      const link = await service.invite(recipient, recipient, sportId);
      return service.submitGuest({
        ...input(),
        token: link.token,
        guestName: "Same name",
      });
    };
    const pending = async () => {
      const link = await service.invite(
        recipient,
        recipient,
        sportId,
        undefined,
        reviewer,
      );
      return service.submitGuest({ ...input(), token: link.token });
    };
    const disclose = (id: string) =>
      privacy.update(reviewer, {
        feedbackId: id,
        ...grant,
        pendingAiAllowed: true,
        pendingAiNoticeVersion: "pending-ai-disclosure-v1",
      });
    const drain = async () => {
      while (await worker.extractOne()) {}
      while (await worker.embedOne()) {}
    };
    const profile = async () => {
      expect(await rebuildOneProfile(db, recipient, sportId)).toBe(true);
      return (
        await db.playerFeedbackAnalysisProfile.findUniqueOrThrow({
          where: { userId_sportId: { userId: recipient, sportId } },
        })
      ).data as unknown as FeedbackAnalysisProfile;
    };
    async function eligibility(id: string) {
      const [row] = await db.$queryRaw<
        { ai: boolean; internal: boolean; trust: string }[]
      >`SELECT feedback_analysis_eligible(f) AS ai,feedback_internal_rating_eligible(f) AS internal,feedback_trust_classification(f) AS trust FROM "Feedback" f WHERE id=${id}::uuid`;
      return row;
    }
    it("processes overall and skill guest comments once without any rating event or contribution", async () => {
      const before = await events(),
        f = await guest();
      await drain();
      expect(await eligibility(f.id)).toEqual({
        ai: true,
        internal: false,
        trust: "UNVERIFIED_GUEST",
      });
      expect(await events()).toEqual(before);
      expect(
        await db.internalRatingContribution.count({
          where: { feedbackId: f.id },
        }),
      ).toBe(0);
      expect(
        await db.feedbackObservation.count({ where: { feedbackId: f.id } }),
      ).toBe(2);
      const p = await profile();
      expect(
        p.skills.find((s) => s.skillId === skillId)!.unverifiedPeer,
      ).toEqual({ count: 1, average: 4.7 });
      expect(p.distinctVerifiedReviewers).toBe(0);
      expect(p.guestFeedbackCount).toBe(1);
      expect(
        [...profileFacts(p).values()].find((f) => f.factId === "profile.total")!
          .claim,
      ).toContain("1 unverified guest");
    });
    it("preserves pending privacy until authorized explicit disclosure; approval refreshes trust without paid work and rates once", async () => {
      const before = await events(),
        f = await pending();
      expect((await eligibility(f.id)).ai).toBe(false);
      await expect(
        privacy.update(recipient, {
          feedbackId: f.id,
          ...grant,
          pendingAiAllowed: true,
          pendingAiNoticeVersion: "pending-ai-disclosure-v1",
        }),
      ).rejects.toThrow();
      await expect(
        privacy.update(reviewer, {
          feedbackId: f.id,
          ...grant,
          pendingAiAllowed: true,
        }),
      ).rejects.toThrow(/disclosure/);
      await disclose(f.id);
      expect(await eligibility(f.id)).toEqual({
        ai: true,
        internal: false,
        trust: "AWAITING_REVIEWER_APPROVAL",
      });
      await drain();
      expect(await events()).toEqual(before);
      const observations = await db.feedbackObservation.findMany({
        where: { feedbackId: f.id },
      });
      const embeddings =
        await db.$queryRaw`SELECT "observationId","sourceHash" FROM "FeedbackObservationEmbedding" WHERE "observationId" IN (SELECT id FROM "FeedbackObservation" WHERE "feedbackId"=${f.id}::uuid)`;
      await expect(service.decide(recipient, f.id, true)).rejects.toThrow();
      await service.decide(reviewer, f.id, true);
      await service.decide(reviewer, f.id, true);
      expect((await eligibility(f.id)).internal).toBe(true);
      expect((await eligibility(f.id)).trust).toBe("VERIFIED_APPROVED");
      expect(
        await db.feedbackObservation.findMany({ where: { feedbackId: f.id } }),
      ).toEqual(observations);
      expect(
        await db.$queryRaw`SELECT "observationId","sourceHash" FROM "FeedbackObservationEmbedding" WHERE "observationId" IN (SELECT id FROM "FeedbackObservation" WHERE "feedbackId"=${f.id}::uuid)`,
      ).toEqual(embeddings);
      await drain();
      expect(extract).toHaveBeenCalledTimes(1);
      expect(embed).toHaveBeenCalledTimes(2);
      const job = await db.feedbackAnalysisJob.findUniqueOrThrow({
        where: { feedbackId: f.id },
      });
      expect(job.trustClassification).toBe("VERIFIED_APPROVED");
      expect(job.trustAtExtraction).toBe("AWAITING_REVIEWER_APPROVAL");
      expect(
        (await events()).filter((e) => e.type === "FEEDBACK_APPLIED"),
      ).toHaveLength(1);
      expect((await profile()).verifiedFeedbackCount).toBe(1);
    });
    it.each(["REJECTED", "HIDDEN", "DELETED"] as const)(
      "removes %s from AI retrieval and profile",
      async (status) => {
        const f = await pending();
        await disclose(f.id);
        await drain();
        if (status === "REJECTED") await service.decide(reviewer, f.id, false);
        else
          await db.feedback.update({ where: { id: f.id }, data: { status } });
        expect((await eligibility(f.id)).ai).toBe(false);
        expect(
          await db.feedbackObservation.count({ where: { feedbackId: f.id } }),
        ).toBe(0);
        expect((await profile()).totalEligibleFeedbackCount).toBe(0);
        expect(
          (await events()).filter((e) => e.type === "FEEDBACK_APPLIED"),
        ).toHaveLength(0);
      },
    );
    it("excludes drafts and historical permissions and enforces moderation even across approval", async () => {
      const f = await guest();
      await db.feedback.update({
        where: { id: f.id },
        data: { submittedAt: null },
      });
      expect((await eligibility(f.id)).ai).toBe(false);
      await db.feedback.update({
        where: { id: f.id },
        data: { submittedAt: new Date(), privateCoachingAllowed: false },
      });
      expect((await eligibility(f.id)).ai).toBe(false);
      const p = await pending();
      await disclose(p.id);
      await drain();
      await db.feedbackAnalysisJob.update({
        where: { feedbackId: p.id },
        data: { moderation: "ABUSE", status: "SKIPPED" },
      });
      expect((await eligibility(p.id)).ai).toBe(false);
      await service.decide(reviewer, p.id, true);
      expect((await eligibility(p.id)).ai).toBe(false);
      expect((await profile()).totalEligibleFeedbackCount).toBe(0);
    });
    it("withdraws pending disclosure without changing approval or internal ratings", async () => {
      const f = await pending();
      await disclose(f.id);
      await drain();
      const before = await events();
      await privacy.update(reviewer, {
        feedbackId: f.id,
        pendingAiAllowed: false,
      });
      expect((await eligibility(f.id)).ai).toBe(false);
      expect(await events()).toEqual(before);
      expect(
        await db.feedbackObservation.count({ where: { feedbackId: f.id } }),
      ).toBe(0);
    });
    it("aggregates mixed trust and caps repeated verified and unverified influence while keeping raw counts", async () => {
      for (let i = 0; i < 3; i++) await service.submit(reviewer, input());
      for (let i = 0; i < 4; i++) await guest();
      const f = await pending();
      await disclose(f.id);
      await drain();
      const p = await profile();
      expect(p.totalEligibleFeedbackCount).toBe(8);
      expect(p.verifiedFeedbackCount).toBe(3);
      expect(p.guestFeedbackCount).toBe(4);
      expect(p.awaitingReviewerApprovalCount).toBe(1);
      expect(p.distinctVerifiedReviewers).toBe(1);
      expect(
        p.skills.find((s) => s.skillId === skillId)!.verifiedPeer?.count,
      ).toBe(3);
      expect(
        p.skills.find((s) => s.skillId === skillId)!.unverifiedPeer?.count,
      ).toBe(5);
      const theme = p.themes.find((t) => t.themeId === "platform_control")!;
      expect(theme.feedbackCount).toBe(8);
      expect(theme.rawObservationCount).toBe(16);
      expect(theme.trustEvidenceFactor).toBeCloseTo(1.35 / 8);
      expect(p.weaknesses[0].supportingFeedbackCount).toBe(8);
      expect(p.weaknesses[0].verifiedSupportingFeedbackCount).toBe(3);
      expect(p.weaknesses[0].unverifiedSupportingFeedbackCount).toBe(5);
    });
    it("retrieves current trust without identities and isolates players", async () => {
      await guest();
      await drain();
      const tools = new CoachTools(db as never, {} as never);
      const rows = await tools.observationsByIds(
        recipient,
        sportId,
        (
          await db.feedbackObservation.findMany({
            where: { job: { feedback: { recipientId: recipient } } },
          })
        ).map((o) => o.id),
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].trustClassification).toBe("UNVERIFIED_GUEST");
      expect(JSON.stringify(rows)).not.toContain(reviewer);
      expect(observationFact(rows[0]).limited).toBe(true);
      expect(
        await tools.observationsByIds(
          reviewer,
          sportId,
          rows.map((o) => o.observationId),
        ),
      ).toEqual([]);
    });
    it("backfills guests idempotently with hashes unchanged and no internal effects", async () => {
      const before = await events();
      await guest();
      const opts = options([
        "enqueue",
        "--all",
        "--dry-run",
        "--player-id",
        recipient,
      ]);
      const env = {
        FEEDBACK_EXTRACTION_MODEL: "trust-test",
        FEEDBACK_EMBEDDING_MODEL: "trust",
        FEEDBACK_EMBEDDING_VERSION: "v1",
        FEEDBACK_EMBEDDING_DIMENSIONS: "3",
      };
      expect(
        (await inventory(db, opts, new Date(), env)).trustCounts
          .UNVERIFIED_GUEST,
      ).toBe(1);
      await enqueueHistorical(db, opts, new Date(), env);
      await drain();
      const observations = await db.feedbackObservation.findMany({
        where: { job: { feedback: { recipientId: recipient } } },
      });
      expect(await enqueueHistorical(db, opts, new Date(), env)).toBe(0);
      await drain();
      expect(extract).toHaveBeenCalledTimes(1);
      expect(
        await db.feedbackObservation.findMany({
          where: { job: { feedback: { recipientId: recipient } } },
        }),
      ).toEqual(observations);
      expect(await events()).toEqual(before);
    });
    it("agrees with pure policies on a submitted guest", async () => {
      const f = await guest(),
        live = await db.feedback.findUniqueOrThrow({ where: { id: f.id } }),
        sql = await eligibility(f.id);
      expect(sql.ai).toBe(
        isEligibleForAiAnalysis(live, {
          sportSlug: "beach-volleyball",
          moderation: "UNASSESSED",
          recipientCoachingEnabled: true,
        }),
      );
      expect(sql.internal).toBe(isEligibleForInternalRating(live));
    });
  },
);
