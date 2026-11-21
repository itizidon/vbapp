import {FeedbackStatus } from "@prisma/client";
import {TestDatabase as PrismaClient,clerkId,clerkToken,fixtureRole}from"../helpers/clerk-fixtures";
import { randomUUID } from "node:crypto";
import { FeedbackService } from "../../src/feedback/feedback.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "approval notification and history queries",
  () => {
    let db: PrismaClient,
      service: FeedbackService,
      recipient: string,
      reviewer: string,
      other: string,
      sport: string,
      skill: string;
    const records: string[] = [];
    const users: string[] = [];
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      service = new FeedbackService(
        db as PrismaService,
        new JwtService({ secret: "approval-query-fixture-only" }),
      );
      sport = (
        await db.sport.create({
          data: { name: "Approval query test", slug: randomUUID() },
        })
      ).id;
      skill = (
        await db.skill.create({
          data: { sportId: sport, name: "Passing", slug: "passing" },
        })
      ).id;
      for (let i = 0; i < 3; i++) {
        const id = clerkId();
        users.push(id);
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
      }
      [recipient, reviewer, other] = users;
    });
    afterEach(async () => {
      await db.feedback.deleteMany({ where: { id: { in: records } } });
      records.length = 0;
      await db.match.deleteMany({ where: { createdById: recipient } });
    });
    afterAll(async () => {
      await db.playerFeedbackAnalysisProfile.deleteMany({
        where: { userId: { in: users } },
      });
      await db.skill.delete({ where: { id: skill } });
      await db.sport.delete({ where: { id: sport } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    });
    async function make(
      status: FeedbackStatus = "PENDING",
      actor = reviewer,
      extra: object = {},
    ) {
      const f = await db.feedback.create({
        data: {
          recipientId: recipient,
          reviewerId: actor,
          submittedById: recipient,
          sportId: sport,
          approvalRequired: true,
          status,
          overallComment: "Secret overall review",
          ...(status === "PUBLISHED"
            ? { approvedAt: new Date(), approvedById: actor }
            : {}),
          ...(status === "REJECTED"
            ? { rejectedAt: new Date(), rejectedById: actor }
            : {}),
          ...extra,
          ratings: {
            create: {
              skillId: skill,
              rating: 4,
              comment: "Secret skill comment",
            },
          },
        },
      });
      records.push(f.id);
      return f;
    }
    it("counts Feedback IDs once, not matches or ratings, and returns only three bounded previews", async () => {
      const combined = await make();
      for (let i = 0; i < 3; i++) {
        const m = await db.match.create({
          data: { createdById: recipient, sportId: sport },
        });
        await db.feedbackMatch.create({
          data: { feedbackId: combined.id, matchId: m.id },
        });
      }
      for (let i = 0; i < 3; i++) await make();
      await make("PENDING", other);
      await make("PUBLISHED");
      await make("PENDING", reviewer, { approvalRequired: false });
      expect(await service.pendingApprovalCount(reviewer)).toBe(4);
      expect(await service.pendingApprovalCount(other)).toBe(1);
      expect(await service.pendingApprovalCount(recipient)).toBe(0);
      const previews = await service.recentPendingApprovals(reviewer);
      expect(previews).toHaveLength(3);
      expect(previews.every((p) => p.ratedSkillCount === 1)).toBe(true);
      expect(JSON.stringify(previews)).not.toMatch(
        /Secret overall|Secret skill/,
      );
      const full = await service.approvals(reviewer);
      expect(full.totalCount).toBe(4);
      expect(
        full.items.find((i) => i.id === combined.id)?.matches,
      ).toHaveLength(3);
    });
    it("paginates newest first with a stable cursor and never accepts another reviewer's cursor", async () => {
      const timestamp = new Date("2026-11-01T12:00:00Z");
      for (let i = 0; i < 13; i++)
        await make("PENDING", reviewer, { createdAt: timestamp });
      const foreign = await make("PENDING", other);
      const first = await service.approvals(reviewer);
      expect(first.items).toHaveLength(10);
      expect(first.totalCount).toBe(13);
      expect(first.nextCursor).toBeTruthy();
      const next = await service.approvals(
        reviewer,
        "PENDING",
        first.nextCursor!,
      );
      expect(next.items).toHaveLength(3);
      expect(next.nextCursor).toBeNull();
      const ids = [...first.items, ...next.items].map((i) => i.id);
      expect(new Set(ids).size).toBe(13);
      expect(ids).toEqual([...ids].sort().reverse());
      await expect(
        service.approvals(reviewer, "PENDING", foreign.id),
      ).rejects.toThrow("Refresh");
    });
    it("returns only the authenticated reviewer's assigned approved/rejected records", async () => {
      const approved = await make("PUBLISHED"),
        rejected = await make("REJECTED");
      await make("PUBLISHED", other);
      await make("REJECTED", other);
      await make("HIDDEN");
      expect(
        (await service.approvals(reviewer, "PUBLISHED")).items.map((i) => i.id),
      ).toEqual([approved.id]);
      expect(
        (await service.approvals(reviewer, "REJECTED")).items.map((i) => i.id),
      ).toEqual([rejected.id]);
      await expect(service.approvals(reviewer, "DELETED")).rejects.toThrow(
        "Choose",
      );
    });
  },
);
