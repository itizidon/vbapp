import { Prisma } from "@prisma/client";
import { InternalRatingsService } from "../src/internal-ratings/internal-ratings.service";
const userId = "11111111-1111-4111-8111-111111111111",
  sportId = "22222222-2222-4222-8222-222222222222";
function setup() {
  const tx: any = {
    skill: {
      findMany: jest.fn().mockResolvedValue([
        { id: "passing", name: "Passing", slug: "passing" },
        { id: "defense", name: "Defense", slug: "defense" },
      ]),
    },
    playerInternalRating: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            skillId: "passing",
            currentRating: new Prisma.Decimal("3.5"),
            revision: 2,
          },
        ]),
    },
    selfAssessmentRating: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ skillId: "passing", rating: 4 }]),
    },
    selfAssessmentRatingEvent: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ skillId: "passing", newRating: 2 }]),
    },
    playerInternalRatingEvent: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { skillId: "passing", newRating: new Prisma.Decimal("2.75") },
        ]),
    },
    feedbackRating: {
      groupBy: jest
        .fn()
        .mockResolvedValue([
          { skillId: "passing", _avg: { rating: 4.25 }, _count: 4 },
        ]),
    },
  };
  const db: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { tx, db, service: new InternalRatingsService(db) };
}
it("returns independent real current sources in a bounded set of batched queries", async () => {
  const { service, tx } = setup();
  const result = await service.radarProfile(userId, userId, sportId);
  expect(result.skills[0]).toMatchObject({
    selfRating: 4,
    internalRating: 3.5,
    averageFeedbackRating: 4.25,
    feedbackCount: 4,
  });
  expect(result.skills[1]).toMatchObject({
    selfRating: null,
    internalRating: null,
    averageFeedbackRating: null,
    feedbackCount: 0,
  });
  expect(tx.feedbackRating.groupBy).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        skill: { sportId, active: true },
        feedback: { recipientId: userId, sportId, status: "PUBLISHED" },
      },
    }),
  );
  expect(tx.playerInternalRatingEvent.findMany).not.toHaveBeenCalled();
});
it("uses immutable dated histories and the latest corrected revision for snapshots", async () => {
  const { service, tx } = setup(),
    asOf = new Date("2026-01-01T23:59:59Z");
  const result = await service.radarProfile(userId, userId, sportId, asOf);
  expect(result.skills[0]).toMatchObject({
    selfRating: 2,
    internalRating: 2.75,
  });
  expect(tx.selfAssessmentRating.findMany).not.toHaveBeenCalled();
  expect(tx.playerInternalRatingEvent.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId,
        chartPoint: true,
        effectiveAt: { lte: asOf },
        OR: [{ skillId: "passing", revision: 2 }],
      },
      distinct: ["skillId"],
    }),
  );
});
it("does not substitute current ratings when historical evidence is absent", async () => {
  const { service, tx } = setup();
  tx.selfAssessmentRatingEvent.findMany.mockResolvedValue([]);
  tx.playerInternalRatingEvent.findMany.mockResolvedValue([]);
  expect(
    (
      await service.radarProfile(
        userId,
        userId,
        sportId,
        new Date("2020-01-01"),
      )
    ).skills[0],
  ).toMatchObject({ selfRating: null, internalRating: null });
});
it("enforces owner access and rejects future snapshots", async () => {
  const { service, db } = setup();
  await expect(
    service.radarProfile(
      "33333333-3333-4333-8333-333333333333",
      userId,
      sportId,
    ),
  ).rejects.toThrow("private");
  await expect(
    service.radarProfile(userId, userId, sportId, new Date("2100-01-01")),
  ).rejects.toThrow("Invalid");
  expect(db.$transaction).not.toHaveBeenCalled();
});
