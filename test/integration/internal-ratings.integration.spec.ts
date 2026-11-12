import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { JwtService } from "@nestjs/jwt";
import { FeedbackService } from "../../src/feedback/feedback.service";
import { SelfAssessmentsService } from "../../src/self-assessments/self-assessments.service";
import { InternalRatingsService } from "../../src/internal-ratings/internal-ratings.service";
import { ratingTransaction } from "../../src/internal-ratings/transaction";
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;
describeDb("internal ratings PostgreSQL integration", () => {
  let db: PrismaClient,
    feedback: FeedbackService,
    self: SelfAssessmentsService,
    ratings: InternalRatingsService;
  const jwt = new JwtService({
    secret: "integration-ratings-secret-long-enough-32",
  });
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    ratings = new InternalRatingsService(db as any);
    feedback = new FeedbackService(db as any, jwt, ratings);
    self = new SelfAssessmentsService(db as any);
  });
  afterAll(() => db?.$disconnect());
  async function fixture(reviewerRating = 5) {
    const sport = await db.sport.create({
      data: {
        name: "Rating test",
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
      [3, reviewerRating, 2].map(async (value) => {
        const suffix = randomUUID();
        const user = await db.user.create({
          data: {
            username: suffix,
            email: `${suffix}@example.test`,
            passwordHash: "not-a-login",
            age: 20,
            heightCm: 180,
          },
        });
        const assessment = await self.create(user.id, {
          sportId: sport.id,
          overallLevel: "TEST",
          ratings: sport.skills.map((skill) => ({
            skillId: skill.id,
            rating: value,
          })),
        });
        return { ...user, assessment };
      }),
    );
    return {
      sport,
      skills: sport.skills,
      recipient: users[0],
      reviewer: users[1],
      other: users[2],
    };
  }
  const current = (userId: string, skillId: string) =>
    db.playerInternalRating.findUniqueOrThrow({
      where: { userId_skillId: { userId, skillId } },
    });
  it("initializes per skill and records self history without resetting internal ratings", async () => {
    const f = await fixture(),
      skill = f.skills[0];
    expect(
      (await current(f.recipient.id, skill.id)).currentRating.toString(),
    ).toBe("3");
    const before = await db.selfAssessmentRatingEvent.count({
      where: { userId: f.recipient.id, skillId: skill.id },
    });
    await self.updateRatings(f.recipient.id, {
      id: f.recipient.assessment.id,
      ratings: [{ skillId: skill.id, rating: 3 }],
    });
    expect(
      await db.selfAssessmentRatingEvent.count({
        where: { userId: f.recipient.id, skillId: skill.id },
      }),
    ).toBe(before);
    await self.updateRatings(f.recipient.id, {
      id: f.recipient.assessment.id,
      ratings: [{ skillId: skill.id, rating: 1 }],
    });
    expect(
      (await current(f.recipient.id, skill.id)).currentRating.toString(),
    ).toBe("3");
    const events = await db.selfAssessmentRatingEvent.findMany({
      where: { userId: f.recipient.id, skillId: skill.id },
      orderBy: { sequence: "asc" },
    });
    expect(events.map((e) => [e.type, e.previousRating, e.newRating])).toEqual([
      ["CREATED", null, 3],
      ["UPDATED", 3, 1],
    ]);
    await expect(
      db.selfAssessmentRatingEvent.update({
        where: { id: events[0].id },
        data: { newRating: 5 },
      }),
    ).rejects.toThrow();
  });
  it("applies positive and negative multi-skill feedback with matching-skill provisional snapshots", async () => {
    const f = await fixture(),
      [a, b] = f.skills;
    await self.updateRatings(f.reviewer.id, {
      id: f.reviewer.assessment.id,
      ratings: [{ skillId: a.id, rating: 1 }],
    });
    const saved = await feedback.submit(f.reviewer.id, {
      recipientId: f.recipient.id,
      sportId: f.sport.id,
      analyticsAllowed: false,
      evidenceAllowed: false,
      ratings: [
        { skillId: a.id, rating: 5 },
        { skillId: b.id, rating: 1 },
      ],
    });
    expect((await current(f.recipient.id, a.id)).currentRating.toString()).toBe(
      "3.03333333",
    );
    expect((await current(f.recipient.id, b.id)).currentRating.toString()).toBe(
      "2.96666667",
    );
    const event = await db.playerInternalRatingEvent.findUniqueOrThrow({
      where: { sourceKey: `${saved.id}:${a.id}` },
    });
    expect(event.reviewerInternalRating?.toString()).toBe("5");
    expect(event.confidence?.toString()).toBe("0.1");
    expect(
      saved.reviewerSkillSnapshots.find((s) => s.skillId === a.id)
        ?.ratingAtSubmission,
    ).toBe(1);
    await expect(
      db.playerInternalRatingEvent.update({
        where: { id: event.id },
        data: { delta: 0 },
      }),
    ).rejects.toThrow();
    await ratingTransaction(db as any, (tx) =>
      ratings.syncFeedback(tx, saved.id),
    );
    expect((await current(f.recipient.id, a.id)).feedbackCount).toBe(1);
  });
  it("caps repeated reviewer influence, handles concurrent writers, and rebuilds edits/deletion/restoration", async () => {
    const f = await fixture(),
      skill = f.skills[0];
    const input = {
      recipientId: f.recipient.id,
      sportId: f.sport.id,
      ratings: [{ skillId: skill.id, rating: 5 }],
    };
    const one = await feedback.submit(f.reviewer.id, input);
    await feedback.submit(f.reviewer.id, input);
    expect((await current(f.recipient.id, skill.id)).feedbackCount).toBe(1);
    await Promise.all([
      feedback.submit(f.other.id, {
        ...input,
        ratings: [{ skillId: skill.id, rating: 1 }],
      }),
      self.updateRatings(f.reviewer.id, {
        id: f.reviewer.assessment.id,
        ratings: [{ skillId: skill.id, rating: 2 }],
      }),
    ]);
    expect((await current(f.recipient.id, skill.id)).feedbackCount).toBe(2);
    await feedback.update(f.reviewer.id, {
      id: one.id,
      ratings: [{ skillId: skill.id, rating: 1 }],
    });
    const changed = await current(f.recipient.id, skill.id);
    expect(changed.currentRating.toNumber()).toBeLessThan(3);
    expect(changed.revision).toBe(2);
    const snapshot = await db.internalRatingContribution.findUniqueOrThrow({
      where: { feedbackId_skillId: { feedbackId: one.id, skillId: skill.id } },
    });
    expect(snapshot.reviewerInternalRating?.toString()).toBe("5");
    await feedback.delete(f.recipient.id, one.id);
    // The second review from the same reviewer is promoted, not counted twice.
    expect((await current(f.recipient.id, skill.id)).feedbackCount).toBe(2);
    await feedback.update(f.reviewer.id, { id: one.id, status: "PUBLISHED" });
    expect((await current(f.recipient.id, skill.id)).feedbackCount).toBe(2);
    expect(
      await db.playerInternalRatingEvent.count({
        where: { sourceKey: `${one.id}:${skill.id}` },
      }),
    ).toBe(1);
    expect(
      await db.playerInternalRatingEvent.count({
        where: {
          userId: f.recipient.id,
          skillId: skill.id,
          type: "CORRECTION",
        },
      }),
    ).toBe(3);
  });
  it("uses conservative guest and missing-reviewer-rating influence and deduplicates invite-day reviews", async () => {
    const f = await fixture(),
      skill = f.skills[0];
    const invite = await feedback.invite(
      f.recipient.id,
      f.recipient.id,
      f.sport.id,
    );
    const input = {
      recipientId: f.recipient.id,
      sportId: f.sport.id,
      token: invite.token,
      guestName: "Guest",
      ratings: [{ skillId: skill.id, rating: 5 }],
    };
    const guest = await feedback.submitGuest(input);
    await feedback.submitGuest(input);
    const source = await db.internalRatingContribution.findUniqueOrThrow({
      where: {
        feedbackId_skillId: { feedbackId: guest.id, skillId: skill.id },
      },
    });
    expect(source.reviewerInternalRating).toBeNull();
    expect(source.confidence.toString()).toBe("0.05");
    expect((await current(f.recipient.id, skill.id)).feedbackCount).toBe(1);
    const suffix = randomUUID();
    const unassessed = await db.user.create({
      data: {
        username: suffix,
        email: `${suffix}@example.test`,
        passwordHash: "unused",
        age: 20,
        heightCm: 180,
      },
    });
    const saved = await feedback.submit(unassessed.id, {
      recipientId: f.recipient.id,
      sportId: f.sport.id,
      ratings: [{ skillId: skill.id, rating: 1 }],
    });
    const missing = await db.internalRatingContribution.findUniqueOrThrow({
      where: {
        feedbackId_skillId: { feedbackId: saved.id, skillId: skill.id },
      },
    });
    expect(missing.rawWeight.toString()).toBe("1");
    expect(missing.confidence.toString()).toBe("0.1");
  });
  it("honors publication lifecycle and restores the exact replay result", async () => {
    const f = await fixture(),
      skill = f.skills[0];
    const saved = await ratingTransaction(db as any, async (tx) => {
      const source = await tx.feedback.create({
        data: {
          recipientId: f.recipient.id,
          reviewerId: f.reviewer.id,
          sportId: f.sport.id,
          status: "PENDING",
          ratings: { create: { skillId: skill.id, rating: 5 } },
        },
      });
      await ratings.syncFeedback(tx, source.id);
      return source;
    });
    expect((await current(f.recipient.id, skill.id)).feedbackCount).toBe(0);
    await feedback.update(f.reviewer.id, { id: saved.id, status: "PUBLISHED" });
    const first = (await current(f.recipient.id, skill.id)).currentRating;
    await feedback.update(f.reviewer.id, { id: saved.id, status: "HIDDEN" });
    expect(
      (await current(f.recipient.id, skill.id)).currentRating.toString(),
    ).toBe("3");
    await feedback.update(f.reviewer.id, { id: saved.id, status: "PUBLISHED" });
    expect(
      (await current(f.recipient.id, skill.id)).currentRating.equals(first),
    ).toBe(true);
    await feedback.update(f.reviewer.id, {
      id: saved.id,
      overallComment: "Only a comment",
    });
    expect((await current(f.recipient.id, skill.id)).revision).toBe(3);
  });
  it("provides private, paginated histories, opening baselines, deterministic ordering and revision checks", async () => {
    const f = await fixture(),
      skill = f.skills[0];
    const start = new Date();
    await feedback.submit(f.reviewer.id, {
      recipientId: f.recipient.id,
      sportId: f.sport.id,
      ratings: [{ skillId: skill.id, rating: 5 }],
    });
    const all = await ratings.history(
      f.recipient.id,
      f.recipient.id,
      skill.id,
      "internal",
      undefined,
      undefined,
      undefined,
      1,
    );
    expect(all.hasMore).toBe(true);
    expect(all.items[0].type).toBe("INITIALIZED");
    const next = await ratings.history(
      f.recipient.id,
      f.recipient.id,
      skill.id,
      "internal",
      undefined,
      undefined,
      all.nextCursor!,
      1,
      all.revision,
    );
    expect(next.items[0].type).toBe("FEEDBACK_APPLIED");
    const filtered = await ratings.history(
      f.recipient.id,
      f.recipient.id,
      skill.id,
      "internal",
      start,
    );
    expect(filtered.baseline?.newRating).toBe(3);
    await expect(
      ratings.history(f.other.id, f.recipient.id, skill.id, "internal"),
    ).rejects.toThrow("private");
    await expect(
      ratings.history(
        f.recipient.id,
        f.recipient.id,
        skill.id,
        "internal",
        undefined,
        undefined,
        undefined,
        100,
        999,
      ),
    ).rejects.toThrow("changed");
    await expect(
      ratings.history(
        f.recipient.id,
        f.recipient.id,
        skill.id,
        "internal",
        new Date("2030-01-01"),
        new Date("2020-01-01"),
      ),
    ).rejects.toThrow();
  });
  it("uses distinct independent reviewers for confidence and excludes reciprocal evidence", async () => {
    const f = await fixture(),
      skill = f.skills[0];
    const toReviewer = {
      recipientId: f.reviewer.id,
      sportId: f.sport.id,
      ratings: [{ skillId: skill.id, rating: 5 }],
    };
    await feedback.submit(f.other.id, toReviewer);
    await feedback.submit(f.other.id, toReviewer);
    const first = await feedback.submit(f.reviewer.id, {
      recipientId: f.recipient.id,
      sportId: f.sport.id,
      ratings: [{ skillId: skill.id, rating: 5 }],
    });
    expect(
      (
        await db.internalRatingContribution.findUniqueOrThrow({
          where: {
            feedbackId_skillId: { feedbackId: first.id, skillId: skill.id },
          },
        })
      ).confidence.toString(),
    ).toBe("0.35");
    await feedback.submit(f.reviewer.id, {
      recipientId: f.other.id,
      sportId: f.sport.id,
      ratings: [{ skillId: skill.id, rating: 5 }],
    });
    const suffix = randomUUID();
    const target = await db.user.create({
      data: {
        username: suffix,
        email: `${suffix}@example.test`,
        passwordHash: "unused",
        age: 20,
        heightCm: 180,
      },
    });
    await self.create(target.id, {
      sportId: f.sport.id,
      overallLevel: "TEST",
      ratings: [{ skillId: skill.id, rating: 3 }],
    });
    const second = await feedback.submit(f.reviewer.id, {
      recipientId: target.id,
      sportId: f.sport.id,
      ratings: [{ skillId: skill.id, rating: 5 }],
    });
    expect(
      (
        await db.internalRatingContribution.findUniqueOrThrow({
          where: {
            feedbackId_skillId: { feedbackId: second.id, skillId: skill.id },
          },
        })
      ).confidence.toString(),
    ).toBe("0.1");
  });
  it("backfills missing baselines idempotently, supports dry run and preserves established ratings", async () => {
    const f = await fixture();
    const added = await db.skill.create({
      data: { sportId: f.sport.id, name: "Legacy skill", slug: "legacy" },
    });
    await db.$executeRawUnsafe(
      'ALTER TABLE "SelfAssessmentRating" DISABLE TRIGGER self_rating_history',
    );
    try {
      await db.selfAssessmentRating.create({
        data: {
          selfAssessmentId: f.recipient.assessment.id,
          skillId: added.id,
          rating: 4,
        },
      });
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE "SelfAssessmentRating" ENABLE TRIGGER self_rating_history',
      );
    }
    const dry = await ratings.backfill(true);
    expect(dry.internalRatings).toBe(1);
    expect(dry.selfBaselines).toBe(1);
    expect(
      await db.playerInternalRating.findUnique({
        where: {
          userId_skillId: { userId: f.recipient.id, skillId: added.id },
        },
      }),
    ).toBeNull();
    const started = new Date();
    const applied = await ratings.backfill(false);
    const again = await ratings.backfill(false);
    expect(applied.internalRatings).toBe(1);
    expect(again.internalRatings).toBe(0);
    expect(again.selfBaselines).toBe(0);
    expect(again.initializationEvents).toBe(0);
    expect(
      (await current(f.recipient.id, added.id)).currentRating.toString(),
    ).toBe("4");
    const history = await ratings.history(
      f.recipient.id,
      f.recipient.id,
      added.id,
      "self",
    );
    expect(history.items[0].type).toBe("BASELINE");
    expect(history.items[0].timestamp.getTime()).toBeGreaterThanOrEqual(
      started.getTime(),
    );
    expect(
      (await current(f.recipient.id, f.skills[0].id)).currentRating.toString(),
    ).toBe("3");
  });
  it("exposes the immutable audit ledger without leaking reviewer influence", async () => {
    const f = await fixture(),
      skill = f.skills[0];
    const source = await feedback.submit(f.reviewer.id, {
      recipientId: f.recipient.id,
      sportId: f.sport.id,
      ratings: [{ skillId: skill.id, rating: 5 }],
    });
    await feedback.update(f.reviewer.id, {
      id: source.id,
      ratings: [{ skillId: skill.id, rating: 1 }],
    });
    const audit = await ratings.history(
      f.recipient.id,
      f.recipient.id,
      skill.id,
      "audit",
    );
    expect(
      audit.items.some(
        (e) => e.type === "FEEDBACK_APPLIED" && e.newRating === 3.03333333,
      ),
    ).toBe(true);
    expect(
      audit.items.some(
        (e) => e.type === "CORRECTION" && e.newRating === 2.96666667,
      ),
    ).toBe(true);
    expect(audit.items.some((e) => e.type === "REBUILT")).toBe(true);
    expect(audit.items[0]).not.toHaveProperty("confidence");
    expect(audit.items[0]).not.toHaveProperty("reviewerInternalRating");
    const corrected = await ratings.history(
      f.recipient.id,
      f.recipient.id,
      skill.id,
      "internal",
    );
    expect(corrected.items[corrected.items.length - 1].newRating).toBe(
      2.96666667,
    );
  });
});
