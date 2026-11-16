import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { JwtService } from "@nestjs/jwt";
import { FeedbackService } from "../../src/feedback/feedback.service";
import { InternalRatingsService } from "../../src/internal-ratings/internal-ratings.service";
import { SelfAssessmentsService } from "../../src/self-assessments/self-assessments.service";
import { AnalyticsResolver } from "../../src/analytics/analytics.resolver";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "multi-match feedback atomic PostgreSQL workflow",
  () => {
    let db: PrismaClient, service: FeedbackService;
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      await db.$connect();
      service = new FeedbackService(
        db as any,
        new JwtService({
          secret: "multi-match-test-secret-at-least-32-characters",
          signOptions: { expiresIn: "15m" },
        }),
        new InternalRatingsService(db as any),
      );
    });
    afterAll(() => db?.$disconnect());
    async function fixture(
      assigned = false,
      mode: "INDIVIDUAL_MATCHES" | "COMBINED_MATCHES" = "INDIVIDUAL_MATCHES",
      matchCount = 2,
    ) {
      const sport = await db.sport.create({
        data: {
          name: "Multi beach",
          slug: randomUUID(),
          skills: {
            create: [
              { name: "Passing", slug: "passing" },
              { name: "Setting", slug: "setting" },
            ],
          },
        },
        include: { skills: true },
      });
      const self = new SelfAssessmentsService(db as any);
      const users = [];
      for (const rating of [3, 5, 2]) {
        const id = randomUUID();
        const user = await db.user.create({
          data: {
            id,
            username: id,
            email: `${id}@example.test`,
            passwordHash: "not-a-login",
            age: 25,
            heightCm: 180,
          },
        });
        await self.create(id, {
          sportId: sport.id,
          overallLevel: "B",
          ratings: sport.skills.map((s) => ({ skillId: s.id, rating })),
        });
        users.push(user);
      }
      const [recipient, reviewer, outsider] = users;
      const matches = [];
      for (let i = 0; i < matchCount; i++)
        matches.push(
          await db.match.create({
            data: {
              createdById: recipient.id,
              sportId: sport.id,
              playedAt: new Date(Date.now() - (i + 1) * 86400000),
              status: "COMPLETED",
              participants: { create: { userId: recipient.id } },
              teams: {
                create: [
                  { teamNumber: 1, score: 21 },
                  { teamNumber: 2, score: 16 },
                ],
              },
            },
          }),
        );
      const ids = matches.map((m) => m.id).reverse();
      const link = await service.invite(
        recipient.id,
        recipient.id,
        sport.id,
        undefined,
        assigned ? reviewer.id : undefined,
        ids,
        mode,
      );
      const reviews =
        mode === "INDIVIDUAL_MATCHES"
          ? ids.map((matchId, i) => ({
              matchId,
              ratings: [
                {
                  skillId: sport.skills[0].id,
                  rating: i ? 2 : 5,
                  comment: `match ${i + 1}`,
                },
              ],
            }))
          : [
              {
                ratings: sport.skills.map((s) => ({
                  skillId: s.id,
                  rating: 4,
                })),
              },
            ];
      const input = { token: link.token, submissionId: randomUUID(), reviews };
      return {
        sport,
        recipient,
        reviewer,
        outsider,
        matches,
        ids,
        link,
        input,
      };
    }
    it.each(["INDIVIDUAL_MATCHES", "COMBINED_MATCHES"] as const)(
      "hands a completed %s assignment to an independent guest batch without changing Pending reviews",
      async (mode) => {
        const f = await fixture(true, mode, 3);
        await expect(
          service.startGuestReviewSession(f.link.token, f.input.submissionId),
        ).rejects.toThrow("completed");
        const original = await service.submitRequest(
          { ...f.input, asGuest: true },
          f.recipient.id,
        );
        const expected = mode === "INDIVIDUAL_MATCHES" ? f.ids.length : 1;
        expect(original).toHaveLength(expected);
        const pendingBefore = await service.pendingApprovals(f.reviewer.id);
        expect(pendingBefore.totalCount).toBe(expected);
        const followup = await service.startGuestReviewSession(
          f.link.token,
          f.input.submissionId,
        );
        expect(
          await service.startGuestReviewSession(
            f.link.token,
            f.input.submissionId,
          ),
        ).toEqual(followup);
        expect(followup.expiresAt.getTime()).toBeLessThanOrEqual(
          f.link.expiresAt.getTime(),
        );
        expect(
          (await service.invitation(f.link.token)).assignedReviewer?.id,
        ).toBe(f.reviewer.id);
        const invitation = await service.invitation(followup.token);
        expect(invitation).toMatchObject({
          guestSession: true,
          approvalRequired: false,
          assignedReviewer: null,
          reviewMode: mode,
        });
        expect(invitation.matches.map((m) => m.id)).toEqual(f.ids);
        const input = {
          ...f.input,
          token: followup.token,
          submissionId: randomUUID(),
          asGuest: true,
          guestName: "New guest",
        };
        await expect(
          service.submitRequest({ ...input, asGuest: false }, f.reviewer.id),
        ).rejects.toThrow("guest review only");
        await expect(
          service.submitRequest({
            ...input,
            assignedReviewerId: f.reviewer.id,
          }),
        ).rejects.toThrow("guest review only");
        const guest = await service.submitRequest(input, f.recipient.id);
        expect(guest).toHaveLength(expected);
        expect(
          guest.every(
            (row) =>
              row.reviewerId === null &&
              row.status === "PUBLISHED" &&
              !row.approvalRequired &&
              row.guestName === "New guest",
          ),
        ).toBe(true);
        expect(
          guest.every(
            (row) => !original.some((previous) => previous.id === row.id),
          ),
        ).toBe(true);
        expect(guest[0].submissionId).not.toBe(original[0].submissionId);
        expect(
          (await service.pendingApprovals(f.reviewer.id)).items.map(
            (r) => r.id,
          ),
        ).toEqual(pendingBefore.items.map((r) => r.id));
        expect(
          await db.feedback.findMany({
            where: { id: { in: original.map((r) => r.id) } },
            orderBy: { createdAt: "asc" },
            include: {
              ratings: true,
              associatedMatches: { include: { match: true } },
            },
          }),
        ).toEqual(original);
        expect(
          await db.playerInternalRatingEvent.count({
            where: { feedbackId: { in: original.map((r) => r.id) } },
          }),
        ).toBe(0);
        const eventsBefore = await db.playerInternalRatingEvent.count({
          where: { feedbackId: { in: guest.map((r) => r.id) } },
        });
        expect(
          (await service.submitRequest(input, f.recipient.id)).map((r) => r.id),
        ).toEqual(guest.map((r) => r.id));
        expect(
          await db.playerInternalRatingEvent.count({
            where: { feedbackId: { in: guest.map((r) => r.id) } },
          }),
        ).toBe(eventsBefore);
        expect(
          await db.feedbackSubmission.count({
            where: { feedbackLinkId: f.link.linkId },
          }),
        ).toBe(2);
        for (const row of guest)
          for (const rating of row.ratings)
            expect(rating.reviewerInternalRatingAtSubmission).toBeNull();
        if (mode === "COMBINED_MATCHES")
          expect(guest[0].associatedMatches).toHaveLength(f.ids.length);
        const next = await service.startGuestReviewSession(
          followup.token,
          input.submissionId,
        );
        expect((await service.invitation(next.token)).guestSession).toBe(true);
        await expect(
          service.startGuestReviewSession(f.link.token, input.submissionId),
        ).rejects.toThrow("another review session");
        await service.revokeLink(f.recipient.id, f.link.linkId);
        await expect(service.invitation(followup.token)).rejects.toThrow(
          "expired",
        );
        await expect(
          service.startGuestReviewSession(next.token, input.submissionId),
        ).rejects.toThrow("expired");
      },
    );
    it("rejects invented receipts, another link's receipt, and expired or tampered handoff tokens", async () => {
      const f = await fixture(true),
        other = await fixture(true);
      await service.submitRequest(f.input);
      await expect(
        service.startGuestReviewSession(f.link.token, randomUUID()),
      ).rejects.toThrow("completed");
      await expect(
        service.startGuestReviewSession(other.link.token, f.input.submissionId),
      ).rejects.toThrow("completed");
      const session = await service.startGuestReviewSession(
        f.link.token,
        f.input.submissionId,
      );
      const parts = session.token.split(".");
      parts[1] = Buffer.from(
        JSON.stringify({
          kind: "guest-feedback-followup",
          linkId: other.link.linkId,
          exp: 9999999999,
        }),
      ).toString("base64url");
      await expect(service.invitation(parts.join("."))).rejects.toThrow(
        "expired",
      );
      await db.feedbackLink.update({
        where: { id: f.link.linkId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(service.invitation(session.token)).rejects.toThrow(
        "expired",
      );
      await expect(
        service.startGuestReviewSession(f.link.token, f.input.submissionId),
      ).rejects.toThrow("expired");
    });
    it("counts individual match reviews independently while retaining the existing daily influence cap", async () => {
      const f = await fixture();
      const records = await service.submitRequest({
        ...f.input,
        asGuest: true,
      });
      expect(records).toHaveLength(2);
      const analytics = new AnalyticsResolver(db as any);
      expect(
        (
          await analytics.feedbackCount(
            { id: f.recipient.id } as any,
            f.recipient.id,
            f.sport.id,
          )
        ).count,
      ).toBe(2);
      expect(
        (
          await analytics.userSkillRatings(
            { id: f.recipient.id } as any,
            f.recipient.id,
            f.sport.id,
          )
        )[0].count,
      ).toBe(2);
      expect(
        await db.playerInternalRatingEvent.count({
          where: {
            feedbackId: { in: records.map((r) => r.id) },
            type: "FEEDBACK_APPLIED",
          },
        }),
      ).toBe(1);
    });
    it("queues every individual match in the selected giver’s Account for same-device guest review, including an assignment chosen on the form", async () => {
      const f = await fixture();
      const records = await service.submitRequest(
        { ...f.input, asGuest: true, assignedReviewerId: f.reviewer.id },
        f.recipient.id,
      );
      expect(records).toHaveLength(f.ids.length);
      expect(
        records.every(
          (row) =>
            row.status === "PENDING" &&
            row.reviewerId === f.reviewer.id &&
            row.submittedById === f.recipient.id,
        ),
      ).toBe(true);
      const queue = await service.pendingApprovals(f.reviewer.id);
      expect(queue.totalCount).toBe(f.ids.length);
      expect(new Set(queue.items.map((row) => row.match?.id))).toEqual(
        new Set(f.ids),
      );
      expect(await service.received(f.recipient.id)).toHaveLength(0);
      await service.decide(f.reviewer.id, queue.items[0].id, true);
      expect((await service.pendingApprovals(f.reviewer.id)).totalCount).toBe(
        f.ids.length - 1,
      );
      await service.decide(f.reviewer.id, queue.items[1].id, false);
      expect((await service.pendingApprovals(f.reviewer.id)).totalCount).toBe(
        0,
      );
    });
    it("stores default individual semantics, selection order, and trusted match previews", async () => {
      const f = await fixture();
      const invitation = await service.invitation(f.link.token);
      expect(invitation.reviewMode).toBe("INDIVIDUAL_MATCHES");
      expect(invitation.matches.map((m) => m.id)).toEqual(f.ids);
      expect(invitation.matches[0].teams[0].score).toBe(21);
    });
    it("creates N independent Pending records and supports independent approval/rejection", async () => {
      const f = await fixture(true);
      const records = await service.submitRequest(f.input);
      expect(records).toHaveLength(2);
      expect(new Set(records.map((r) => r.matchId))).toEqual(new Set(f.ids));
      expect(records.every((r) => r.status === "PENDING")).toBe(true);
      expect(
        await db.playerInternalRatingEvent.count({
          where: { feedbackId: { in: records.map((r) => r.id) } },
        }),
      ).toBe(0);
      expect(await service.received(f.recipient.id)).toHaveLength(0);
      await expect(
        service.decide(f.outsider.id, records[0].id, true),
      ).rejects.toThrow("designated");
      await service.decide(f.reviewer.id, records[0].id, true);
      await service.decide(f.reviewer.id, records[1].id, false);
      expect(
        await db.playerInternalRatingEvent.count({
          where: { feedbackId: records[0].id, type: "FEEDBACK_APPLIED" },
        }),
      ).toBe(1);
      expect(
        await db.playerInternalRatingEvent.count({
          where: { feedbackId: records[1].id },
        }),
      ).toBe(0);
    });
    it("creates one combined review with all associations, one approval and one application per skill", async () => {
      const f = await fixture(true, "COMBINED_MATCHES");
      const records = await service.submitRequest(f.input);
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record.matchId).toBeNull();
      expect(record.associatedMatches).toHaveLength(2);
      expect((await service.pendingApprovals(f.reviewer.id)).totalCount).toBe(
        1,
      );
      expect(
        (await service.pendingApprovals(f.reviewer.id)).items[0].matches,
      ).toHaveLength(2);
      await service.decide(f.reviewer.id, record.id, true);
      await service.decide(f.reviewer.id, record.id, true);
      expect(
        await db.playerInternalRatingEvent.count({
          where: { feedbackId: record.id, type: "FEEDBACK_APPLIED" },
        }),
      ).toBe(2);
      expect(
        await db.internalRatingContribution.count({
          where: { feedbackId: record.id },
        }),
      ).toBe(2);
      const analytics = new AnalyticsResolver(db as any);
      expect(
        (
          await analytics.feedbackCount(
            { id: f.recipient.id } as any,
            f.recipient.id,
            f.sport.id,
          )
        ).count,
      ).toBe(1);
      expect(
        (
          await analytics.userSkillRatings(
            { id: f.recipient.id } as any,
            f.recipient.id,
            f.sport.id,
          )
        ).every((r) => r.count === 1),
      ).toBe(true);
      for (const id of f.ids)
        expect(
          (
            await service.received(
              f.recipient.id,
              undefined,
              undefined,
              undefined,
              undefined,
              id,
            )
          ).map((r) => r.id),
        ).toEqual([record.id]);
      expect(
        (await service.received(f.recipient.id, undefined, true)).map(
          (r) => r.id,
        ),
      ).toEqual([record.id]);
      expect(
        await service.received(f.recipient.id, undefined, false),
      ).toHaveLength(0);
    });
    it("deduplicates concurrent retries without making the reusable request single-use", async () => {
      const f = await fixture(false, "COMBINED_MATCHES");
      const results = await Promise.all([
        service.submitRequest(f.input),
        service.submitRequest(f.input),
        service.submitRequest(f.input),
      ]);
      expect(new Set(results.map((r) => r[0].id)).size).toBe(1);
      expect(
        await db.feedbackSubmission.count({
          where: { feedbackLinkId: f.link.linkId },
        }),
      ).toBe(1);
      await expect(
        service.submitRequest({ ...f.input, guestName: "changed" }),
      ).rejects.toThrow("different feedback");
      const again = await service.submitRequest({
        ...f.input,
        submissionId: randomUUID(),
      });
      expect(again[0].id).not.toBe(results[0][0].id);
    });
    it("rolls back every record and submission marker when a later match has an invalid skill", async () => {
      const f = await fixture();
      const bad = {
        ...f.input,
        reviews: f.input.reviews.map((r, i) =>
          i ? { ...r, ratings: [{ skillId: randomUUID(), rating: 4 }] } : r,
        ),
      };
      await expect(service.submitRequest(bad)).rejects.toThrow("skill");
      expect(
        await db.feedback.count({ where: { feedbackLinkId: f.link.linkId } }),
      ).toBe(0);
      expect(
        await db.feedbackSubmission.count({
          where: { feedbackLinkId: f.link.linkId },
        }),
      ).toBe(0);
    });
    it("rejects missing, duplicate, extra and unauthorized request matches", async () => {
      const f = await fixture();
      await expect(
        service.invite(
          f.recipient.id,
          f.recipient.id,
          f.sport.id,
          undefined,
          undefined,
          [f.ids[0], f.ids[0]],
        ),
      ).rejects.toThrow("distinct");
      await expect(
        service.invite(
          f.outsider.id,
          f.recipient.id,
          f.sport.id,
          undefined,
          undefined,
          f.ids,
        ),
      ).rejects.toThrow("themselves");
      await expect(
        service.invite(
          f.outsider.id,
          f.outsider.id,
          f.sport.id,
          undefined,
          undefined,
          f.ids,
        ),
      ).rejects.toThrow("Every selected");
      await expect(
        service.submitRequest({
          ...f.input,
          reviews: f.input.reviews.slice(0, 1),
        }),
      ).rejects.toThrow("exactly");
      await expect(
        service.submitRequest({
          ...f.input,
          reviews: [f.input.reviews[0], f.input.reviews[0]],
        }),
      ).rejects.toThrow("exactly");
      await expect(
        service.submitRequest({
          ...f.input,
          reviews: f.input.reviews.map((r, i) =>
            i ? { ...r, matchId: randomUUID() } : r,
          ),
        }),
      ).rejects.toThrow("exactly");
      await expect(
        service.submitGuest({
          token: f.link.token,
          recipientId: f.recipient.id,
          sportId: f.sport.id,
          ratings: f.input.reviews[0].ratings,
        }),
      ).rejects.toThrow("together");
    });
    it("preserves verified registered reviewer identity and permits explicit guest device review", async () => {
      const f = await fixture(false, "COMBINED_MATCHES");
      const [record] = await service.submitRequest(
        { ...f.input, asGuest: false },
        f.reviewer.id,
      );
      expect(record.reviewerId).toBe(f.reviewer.id);
      expect(record.guestName).toBeNull();
      await expect(
        service.submitRequest({
          ...f.input,
          submissionId: randomUUID(),
          asGuest: false,
        }),
      ).rejects.toThrow("Sign in");
      const [guest] = await service.submitRequest(
        { ...f.input, submissionId: randomUUID(), asGuest: true },
        f.recipient.id,
      );
      expect(guest.reviewerId).toBeNull();
    });
    it("keeps old single-match opaque links working and honors revocation", async () => {
      const f = await fixture();
      const legacy = await service.invite(
        f.recipient.id,
        f.recipient.id,
        f.sport.id,
        f.ids[0],
      );
      expect((await service.invitation(legacy.token)).matches).toEqual([]);
      expect(
        (
          await service.submitGuest({
            token: legacy.token,
            recipientId: f.recipient.id,
            sportId: f.sport.id,
            matchId: f.ids[0],
            ratings: f.input.reviews[0].ratings,
          })
        ).matchId,
      ).toBe(f.ids[0]);
      await service.revokeLink(f.recipient.id, f.link.linkId);
      await expect(service.submitRequest(f.input)).rejects.toThrow("expired");
    });
  },
);
