import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { JwtService } from "@nestjs/jwt";
import { FeedbackService } from "../../src/feedback/feedback.service";
import { InternalRatingsService } from "../../src/internal-ratings/internal-ratings.service";
import { SelfAssessmentsService } from "../../src/self-assessments/self-assessments.service";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "feedback assignment and approval PostgreSQL integration",
  () => {
    let db: PrismaClient,
      service: FeedbackService,
      self: SelfAssessmentsService,
      internal: InternalRatingsService;
    const jwt = new JwtService({
      secret: "approvals-integration-secret-long-enough-32",
    });
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      await db.$connect();
      internal = new InternalRatingsService(db as any);
      service = new FeedbackService(db as any, jwt, internal);
      self = new SelfAssessmentsService(db as any);
    });
    afterAll(() => db?.$disconnect());
    async function fixture() {
      const sport = await db.sport.create({
        data: {
          name: "Approvals sport",
          slug: randomUUID(),
          skills: {
            create: [
              { name: "Passing", slug: "passing" },
              { name: "Serving", slug: "serving" },
            ],
          },
        },
        include: { skills: true },
      });
      const users = await Promise.all(
        [3, 5, 2].map(async (rating) => {
          const id = randomUUID();
          const user = await db.user.create({
            data: {
              username: id,
              email: `${id}@example.test`,
              passwordHash: "not-a-login",
              age: 25,
              heightCm: 180,
            },
          });
          await self.create(user.id, {
            sportId: sport.id,
            overallLevel: "B",
            ratings: sport.skills.map((skill) => ({
              skillId: skill.id,
              rating,
            })),
          });
          return user;
        }),
      );
      const [recipient, reviewer, other] = users;
      const input = {
        recipientId: recipient.id,
        sportId: sport.id,
        guestName: "Prepared by guest",
        overallComment: "Keep working on placement",
        ratings: [
          { skillId: sport.skills[0].id, rating: 5, comment: "Good control" },
        ],
      };
      const link = await service.invite(
        recipient.id,
        recipient.id,
        sport.id,
        undefined,
        reviewer.id,
      );
      return { sport, recipient, reviewer, other, input, link };
    }
    async function rating(userId: string, skillId: string) {
      return db.playerInternalRating.findUniqueOrThrow({
        where: { userId_skillId: { userId, skillId } },
      });
    }
    it("stores a hashed opaque token and resolves reviewer and categories without private emails", async () => {
      const f = await fixture();
      expect(f.link.token).toMatch(/^[a-f0-9]{64}$/);
      const stored = await db.feedbackLink.findUniqueOrThrow({
        where: { id: f.link.linkId },
      });
      expect(stored.tokenHash).not.toBe(f.link.token);
      expect(stored.assignedReviewerId).toBe(f.reviewer.id);
      const view = await service.invitation(f.link.token);
      expect(view.assignedReviewer).toEqual({
        id: f.reviewer.id,
        username: f.reviewer.username,
      });
      expect(view.approvalRequired).toBe(true);
      expect(view.sport.skills).toHaveLength(2);
      expect(JSON.stringify(view)).not.toContain("@example.test");
    });
    it("prevents assigning the recipient, unknown reviewers and another recipient’s link", async () => {
      const f = await fixture();
      await expect(
        service.invite(
          f.recipient.id,
          f.recipient.id,
          f.sport.id,
          undefined,
          f.recipient.id,
        ),
      ).rejects.toThrow("other than");
      await expect(
        service.invite(
          f.recipient.id,
          f.recipient.id,
          f.sport.id,
          undefined,
          randomUUID(),
        ),
      ).rejects.toThrow("Reviewer not found");
      await expect(
        service.invite(f.other.id, f.recipient.id, f.sport.id),
      ).rejects.toThrow("themselves");
    });
    it("rejects invalid, expired, revoked and tampered invitations on opening and submitting", async () => {
      const f = await fixture();
      await expect(service.invitation("f".repeat(64))).rejects.toThrow(
        "Invalid or expired",
      );
      await expect(
        service.invitation(f.link.token.slice(0, -1) + "z"),
      ).rejects.toThrow("Invalid or expired");
      await db.feedbackLink.update({
        where: { id: f.link.linkId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(service.invitation(f.link.token)).rejects.toThrow(
        "Invalid or expired",
      );
      await expect(
        service.submitGuest({ ...f.input, token: f.link.token }),
      ).rejects.toThrow("Invalid or expired");
      const fresh = await service.invite(
        f.recipient.id,
        f.recipient.id,
        f.sport.id,
        undefined,
        f.reviewer.id,
      );
      await expect(
        service.revokeLink(f.other.id, fresh.linkId),
      ).rejects.toThrow();
      await service.revokeLink(f.recipient.id, fresh.linkId);
      await expect(service.invitation(fresh.token)).rejects.toThrow(
        "Invalid or expired",
      );
      await expect(
        service.submitGuest({ ...f.input, token: fresh.token }),
      ).rejects.toThrow("Invalid or expired");
    });
    it("preserves unassigned reusable links and guest publication behavior", async () => {
      const f = await fixture();
      const link = await service.invite(
        f.recipient.id,
        f.recipient.id,
        f.sport.id,
      );
      expect((await service.invitation(link.token)).approvalRequired).toBe(
        false,
      );
      const a = await service.submitGuest({ ...f.input, token: link.token });
      const b = await service.submitGuest({ ...f.input, token: link.token });
      expect(a.status).toBe("PUBLISHED");
      expect(a.reviewerId).toBeNull();
      expect(a.id).not.toBe(b.id);
      expect(
        (await rating(f.recipient.id, f.sport.skills[0].id)).currentRating.gt(
          3,
        ),
      ).toBe(true);
    });
    it("continues to accept existing unassigned signed invitations", async () => {
      const f = await fixture();
      const token = await jwt.signAsync(
        {
          kind: "guest-feedback",
          nonce: randomUUID(),
          recipientId: f.recipient.id,
          sportId: f.sport.id,
        },
        { expiresIn: "24h" },
      );
      expect((await service.invitation(token)).assignedReviewer).toBeNull();
      expect((await service.submitGuest({ ...f.input, token })).status).toBe(
        "PUBLISHED",
      );
    });
    it("saves assigned drafts with submitter and guest identity without any rating contribution or event", async () => {
      const f = await fixture();
      const draft = await service.submitGuest(
        { ...f.input, token: f.link.token },
        f.other.id,
      );
      expect(draft).toMatchObject({
        status: "PENDING",
        reviewerId: f.reviewer.id,
        submittedById: f.other.id,
        guestName: "Prepared by guest",
        feedbackLinkId: f.link.linkId,
        approvalRequired: true,
      });
      expect(draft.ratings[0]).toMatchObject({
        rating: 5,
        comment: "Good control",
      });
      expect(
        await db.internalRatingContribution.count({
          where: { feedbackId: draft.id },
        }),
      ).toBe(0);
      expect(
        await db.playerInternalRatingEvent.count({
          where: { feedbackId: draft.id },
        }),
      ).toBe(0);
      expect(
        (
          await rating(f.recipient.id, f.sport.skills[0].id)
        ).currentRating.toString(),
      ).toBe("3");
      expect(
        await db.feedback.count({
          where: { recipientId: f.recipient.id, status: "PUBLISHED" },
        }),
      ).toBe(0);
      expect(await service.received(f.recipient.id)).toHaveLength(0);
      await expect(service.get(f.recipient.id, draft.id)).rejects.toThrow();
    });
    it("does not let even the designated reviewer auto-publish at submission", async () => {
      const f = await fixture();
      const draft = await service.submitGuest(
        { ...f.input, token: f.link.token },
        f.reviewer.id,
      );
      expect(draft.status).toBe("PENDING");
      await expect(
        service.update(f.reviewer.id, { id: draft.id, status: "PUBLISHED" }),
      ).rejects.toThrow("approval or rejection");
      await expect(service.delete(f.recipient.id, draft.id)).rejects.toThrow();
    });
    it("prevents changing the invitation recipient, sport or match", async () => {
      const f = await fixture();
      await expect(
        service.submitGuest({
          ...f.input,
          recipientId: f.other.id,
          token: f.link.token,
        }),
      ).rejects.toThrow("does not match");
      await expect(
        service.submitGuest({
          ...f.input,
          sportId: randomUUID(),
          token: f.link.token,
        }),
      ).rejects.toThrow("does not match");
      await expect(
        service.submitGuest({
          ...f.input,
          matchId: randomUUID(),
          token: f.link.token,
        }),
      ).rejects.toThrow("does not match");
    });
    it("exposes only the authenticated reviewer’s assigned pending queue with bounded pagination", async () => {
      const f = await fixture();
      for (let i = 0; i < 12; i++)
        await service.submitGuest({ ...f.input, token: f.link.token });
      const page = await service.pendingApprovals(f.reviewer.id);
      expect(page.totalCount).toBe(12);
      expect(page.items).toHaveLength(10);
      expect(page.items[0]).toMatchObject({
        recipientUsername: f.recipient.username,
        status: "PENDING",
      });
      expect(page.items[0].ratings[0].skillName).toBe("Passing");
      const next = await service.pendingApprovals(
        f.reviewer.id,
        page.nextCursor!,
      );
      expect(next.items).toHaveLength(2);
      expect(next.nextCursor).toBeNull();
      expect(
        new Set([...page.items, ...next.items].map((r) => r.id)).size,
      ).toBe(12);
      expect((await service.pendingApprovals(f.other.id)).totalCount).toBe(0);
      expect(
        (await service.pendingApprovals(f.recipient.id)).items,
      ).toHaveLength(0);
    });
    it("prevents recipients and unrelated users from approving or rejecting", async () => {
      const f = await fixture();
      const draft = await service.submitGuest({
        ...f.input,
        token: f.link.token,
      });
      for (const actor of [f.recipient.id, f.other.id])
        for (const approve of [true, false])
          await expect(
            service.decide(actor, draft.id, approve),
          ).rejects.toThrow("designated reviewer");
      expect(
        (await db.feedback.findUniqueOrThrow({ where: { id: draft.id } }))
          .status,
      ).toBe("PENDING");
    });
    it("uses the reviewer’s internal rating and confidence at submission time and stores weighted immutable events atomically", async () => {
      const f = await fixture(),
        skill = f.sport.skills[0];
      const draft = await service.submitGuest({
        ...f.input,
        token: f.link.token,
      });
      await service.submit(f.other.id, {
        recipientId: f.reviewer.id,
        sportId: f.sport.id,
        ratings: [{ skillId: skill.id, rating: 1 }],
      });
      const reviewerNow = await rating(f.reviewer.id, skill.id);
      expect(reviewerNow.currentRating.eq(5)).toBe(false);
      const approved = await service.decide(f.reviewer.id, draft.id, true);
      expect(approved).toMatchObject({
        status: "PUBLISHED",
        approvedById: f.reviewer.id,
        approvedAt: expect.any(Date),
      });
      const event = await db.playerInternalRatingEvent.findFirstOrThrow({
        where: { feedbackId: draft.id, type: "FEEDBACK_APPLIED" },
      });
      expect(event.reviewerInternalRating!.eq(5)).toBe(true);
      expect(
        event.confidence!.eq(internal.algorithm.parameters.confidence[0]),
      ).toBe(true);
      const saved = draft.ratings[0];
      expect(saved.reviewerInternalSnapshotCapturedAt).toBeInstanceOf(Date);
      expect(saved.reviewerInternalRatingAtSubmission!.eq(5)).toBe(true);
      expect(event.finalRate!.eq(saved.reviewerFinalRateAtSubmission!)).toBe(
        true,
      );
      expect(event.confidence!.eq(saved.reviewerConfidenceAtSubmission!)).toBe(
        true,
      );
      await expect(
        db.feedbackRating.update({
          where: {
            feedbackId_skillId: { feedbackId: draft.id, skillId: skill.id },
          },
          data: { reviewerFinalRateAtSubmission: 1 },
        }),
      ).rejects.toThrow("snapshot is immutable");
      expect(event.reviewerId).toBe(f.reviewer.id);
      expect(event.confidence).not.toBeNull();
      const expected = internal.algorithm.apply(
        new Prisma.Decimal(3),
        5,
        event.finalRate!,
      );
      expect(event.newRating.eq(expected.next)).toBe(true);
      expect(
        (await rating(f.recipient.id, skill.id)).currentRating.eq(
          expected.next,
        ),
      ).toBe(true);
      expect(
        (await service.received(f.recipient.id)).map((r) => r.id),
      ).toContain(draft.id);
      await expect(
        db.playerInternalRatingEvent.update({
          where: { id: event.id },
          data: { delta: 0 },
        }),
      ).rejects.toThrow();
    });
    it("retains submission weights when published scores or comments are edited", async () => {
      const f = await fixture();
      const draft = await service.submitGuest({
        ...f.input,
        token: f.link.token,
      });
      await service.decide(f.reviewer.id, draft.id, true);
      const before = draft.ratings[0];
      const updated = await service.update(f.reviewer.id, {
        id: draft.id,
        ratings: [
          { skillId: before.skillId, rating: 2, comment: "Corrected score" },
        ],
      });
      expect(updated.ratings[0].reviewerInternalSnapshotCapturedAt).toEqual(
        before.reviewerInternalSnapshotCapturedAt,
      );
      expect(
        updated.ratings[0].reviewerFinalRateAtSubmission!.eq(
          before.reviewerFinalRateAtSubmission!,
        ),
      ).toBe(true);
      expect(updated.ratings[0].rating).toBe(2);
      const contribution =
        await db.internalRatingContribution.findUniqueOrThrow({
          where: {
            feedbackId_skillId: {
              feedbackId: draft.id,
              skillId: before.skillId,
            },
          },
        });
      expect(
        contribution.finalRate.eq(before.reviewerFinalRateAtSubmission!),
      ).toBe(true);
    });
    it("keeps approval-time weighting for legacy pending rows without submission snapshots", async () => {
      const f = await fixture();
      const legacy = await db.feedback.create({
        data: {
          recipientId: f.recipient.id,
          reviewerId: f.reviewer.id,
          sportId: f.sport.id,
          feedbackLinkId: f.link.linkId,
          approvalRequired: true,
          status: "PENDING",
          guestName: "Legacy guest",
          ratings: { create: f.input.ratings },
        },
      });
      await service.decide(f.reviewer.id, legacy.id, true);
      const event = await db.playerInternalRatingEvent.findFirstOrThrow({
        where: { feedbackId: legacy.id, type: "FEEDBACK_APPLIED" },
      });
      expect(event.reviewerInternalRating!.eq(5)).toBe(true);
      expect(event.finalRate!.gt(0)).toBe(true);
    });
    it("serializes concurrent approvals and applies each skill exactly once", async () => {
      const f = await fixture();
      const draft = await service.submitGuest({
        ...f.input,
        token: f.link.token,
        ratings: f.sport.skills.map((s) => ({ skillId: s.id, rating: 5 })),
      });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.decide(f.reviewer.id, draft.id, true),
        ),
      );
      expect(results.every((r) => r.status === "PUBLISHED")).toBe(true);
      expect(
        await db.playerInternalRatingEvent.count({
          where: { feedbackId: draft.id, type: "FEEDBACK_APPLIED" },
        }),
      ).toBe(2);
      expect(
        await db.internalRatingContribution.count({
          where: { feedbackId: draft.id },
        }),
      ).toBe(2);
      expect(
        (await rating(f.recipient.id, f.sport.skills[0].id)).feedbackCount,
      ).toBe(1);
      await expect(
        service.decide(f.reviewer.id, draft.id, false),
      ).rejects.toThrow("already been processed");
    });
    it("rejects idempotently without changes, keeps audit data private and removes the pending card", async () => {
      const f = await fixture();
      const draft = await service.submitGuest({
        ...f.input,
        token: f.link.token,
      });
      for (let i = 0; i < 2; i++)
        expect(
          (
            await service.decide(
              f.reviewer.id,
              draft.id,
              false,
              "Not my observations",
            )
          ).status,
        ).toBe("REJECTED");
      expect((await service.pendingApprovals(f.reviewer.id)).totalCount).toBe(
        0,
      );
      expect(
        await db.playerInternalRatingEvent.count({
          where: { feedbackId: draft.id },
        }),
      ).toBe(0);
      const rejected = await service.get(f.reviewer.id, draft.id);
      expect(rejected).toMatchObject({
        rejectedById: f.reviewer.id,
        rejectedAt: expect.any(Date),
        rejectionReason: "Not my observations",
      });
      expect(await service.received(f.recipient.id)).toHaveLength(0);
      await expect(service.get(f.recipient.id, draft.id)).rejects.toThrow();
      await expect(
        service.decide(f.reviewer.id, draft.id, true),
      ).rejects.toThrow("already been processed");
      await expect(
        service.update(f.reviewer.id, { id: draft.id, status: "PUBLISHED" }),
      ).rejects.toThrow();
    });
    it("allows already-submitted drafts to be reviewed after link expiry but blocks revoked approvals", async () => {
      const f = await fixture();
      const draft = await service.submitGuest({
        ...f.input,
        token: f.link.token,
      });
      await db.feedbackLink.update({
        where: { id: f.link.linkId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await service.decide(f.reviewer.id, draft.id, true)).status).toBe(
        "PUBLISHED",
      );
      const fresh = await service.invite(
        f.recipient.id,
        f.recipient.id,
        f.sport.id,
        undefined,
        f.reviewer.id,
      );
      const another = await service.submitGuest({
        ...f.input,
        token: fresh.token,
      });
      await service.revokeLink(f.recipient.id, fresh.linkId);
      await expect(
        service.decide(f.reviewer.id, another.id, true),
      ).rejects.toThrow("revoked");
      expect(
        (await service.decide(f.reviewer.id, another.id, false)).status,
      ).toBe("REJECTED");
    });
    it("rolls back publication and audit fields if rating application fails", async () => {
      const f = await fixture();
      const draft = await service.submitGuest({
        ...f.input,
        token: f.link.token,
      });
      const broken = new FeedbackService(db as any, jwt, {
        syncFeedback: async () => {
          throw new Error("Rating failure");
        },
      } as any);
      await expect(
        broken.decide(f.reviewer.id, draft.id, true),
      ).rejects.toThrow("Rating failure");
      const stored = await db.feedback.findUniqueOrThrow({
        where: { id: draft.id },
      });
      expect(stored.status).toBe("PENDING");
      expect(stored.approvedAt).toBeNull();
    });
    it("refuses publication if the recipient has no initialized internal skill baseline", async () => {
      const f = await fixture();
      const person = await db.user.create({
        data: {
          username: randomUUID(),
          email: `${randomUUID()}@example.test`,
          passwordHash: "not-a-login",
          age: 25,
          heightCm: 180,
        },
      });
      const link = await service.invite(
        person.id,
        person.id,
        f.sport.id,
        undefined,
        f.reviewer.id,
      );
      const draft = await service.submitGuest({
        ...f.input,
        recipientId: person.id,
        token: link.token,
      });
      await expect(
        service.decide(f.reviewer.id, draft.id, true),
      ).rejects.toThrow("must be initialized");
      expect(
        (await db.feedback.findUniqueOrThrow({ where: { id: draft.id } }))
          .status,
      ).toBe("PENDING");
    });

    it("searches reviewers for a validated invitation without exposing emails or the recipient", async () => {
      const f = await fixture();
      const link = await service.invite(
        f.recipient.id,
        f.recipient.id,
        f.sport.id,
      );
      expect(
        await service.reviewerSuggestions(
          undefined,
          f.reviewer.username,
          link.token,
        ),
      ).toEqual([{ id: f.reviewer.id, username: f.reviewer.username }]);
      expect(
        await service.reviewerSuggestions(
          undefined,
          f.recipient.username,
          link.token,
        ),
      ).toEqual([]);
      expect(
        await service.reviewerSuggestions(
          f.other.id,
          f.reviewer.username,
          undefined,
          f.recipient.id,
        ),
      ).toHaveLength(1);
      await expect(
        service.reviewerSuggestions(undefined, f.reviewer.username),
      ).rejects.toThrow("Sign in");
      await expect(
        service.reviewerSuggestions(
          undefined,
          f.reviewer.username,
          link.token,
          f.other.id,
        ),
      ).rejects.toThrow("does not match");
      await service.revokeLink(f.recipient.id, link.linkId);
      await expect(
        service.reviewerSuggestions(undefined, f.reviewer.username, link.token),
      ).rejects.toThrow("Invalid or expired");
    });
    it("assigns one draft from an unassigned link without reassigning the reusable link", async () => {
      const f = await fixture();
      const link = await service.invite(
        f.recipient.id,
        f.recipient.id,
        f.sport.id,
      );
      const draft = await service.submitGuest({
        ...f.input,
        token: link.token,
        assignedReviewerId: f.reviewer.id,
      });
      expect(draft).toMatchObject({
        status: "PENDING",
        reviewerId: f.reviewer.id,
        feedbackLinkId: link.linkId,
        approvalRequired: true,
      });
      expect(
        (
          await db.feedbackLink.findUniqueOrThrow({
            where: { id: link.linkId },
          })
        ).assignedReviewerId,
      ).toBeNull();
      expect(
        (
          await rating(f.recipient.id, f.sport.skills[0].id)
        ).currentRating.toString(),
      ).toBe("3");
      expect(
        (await service.pendingApprovals(f.reviewer.id)).items.map(
          (row) => row.id,
        ),
      ).toContain(draft.id);
      await service.decide(f.reviewer.id, draft.id, true);
      expect(
        (await rating(f.recipient.id, f.sport.skills[0].id)).currentRating.gt(
          3,
        ),
      ).toBe(true);
      expect(
        (await service.submitGuest({ ...f.input, token: link.token })).status,
      ).toBe("PUBLISHED");
    });
    it("supports authenticated in-form assignments without an invitation and applies approval once", async () => {
      const f = await fixture();
      const draft = await service.submit(f.other.id, {
        ...f.input,
        assignedReviewerId: f.reviewer.id,
      });
      expect(draft).toMatchObject({
        status: "PENDING",
        reviewerId: f.reviewer.id,
        submittedById: f.other.id,
        feedbackLinkId: null,
      });
      await expect(service.decide(f.other.id, draft.id, true)).rejects.toThrow(
        "designated reviewer",
      );
      await Promise.all([
        service.decide(f.reviewer.id, draft.id, true),
        service.decide(f.reviewer.id, draft.id, true),
      ]);
      expect(
        await db.playerInternalRatingEvent.count({
          where: { feedbackId: draft.id, type: "FEEDBACK_APPLIED" },
        }),
      ).toBe(1);
    });
    it("lets a recipient prepare a draft for another reviewer without self-approving", async () => {
      const f = await fixture();
      const draft = await service.submit(f.recipient.id, {
        ...f.input,
        assignedReviewerId: f.reviewer.id,
      });
      expect(draft.status).toBe("PENDING");
      await expect(
        service.decide(f.recipient.id, draft.id, true),
      ).rejects.toThrow("designated reviewer");
      expect(
        (await service.decide(f.reviewer.id, draft.id, false)).status,
      ).toBe("REJECTED");
    });
    it("rejects recipient/unknown assignments and changes to a link's fixed reviewer", async () => {
      const f = await fixture();
      const link = await service.invite(
        f.recipient.id,
        f.recipient.id,
        f.sport.id,
      );
      await expect(
        service.submitGuest({
          ...f.input,
          token: link.token,
          assignedReviewerId: f.recipient.id,
        }),
      ).rejects.toThrow("Self-feedback");
      await expect(
        service.submitGuest({
          ...f.input,
          token: link.token,
          assignedReviewerId: randomUUID(),
        }),
      ).rejects.toThrow("Reviewer not found");
      await expect(
        service.submitGuest({
          ...f.input,
          token: f.link.token,
          assignedReviewerId: f.other.id,
        }),
      ).rejects.toThrow("already has a designated");
      expect(
        await db.feedback.count({ where: { recipientId: f.recipient.id } }),
      ).toBe(0);
    });
    it("supports selecting an approver on legacy signed invitations", async () => {
      const f = await fixture();
      const token = await jwt.signAsync(
        {
          kind: "guest-feedback",
          nonce: randomUUID(),
          recipientId: f.recipient.id,
          sportId: f.sport.id,
        },
        { expiresIn: "24h" },
      );
      const draft = await service.submitGuest({
        ...f.input,
        token,
        assignedReviewerId: f.reviewer.id,
      });
      expect(draft.status).toBe("PENDING");
      expect(draft.feedbackLinkId).not.toBeNull();
      expect((await service.decide(f.reviewer.id, draft.id, true)).status).toBe(
        "PUBLISHED",
      );
    });
  },
);
