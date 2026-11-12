import { Prisma } from "@prisma/client";
import { InternalRatingsService } from "../src/internal-ratings/internal-ratings.service";
const userId = "11111111-1111-4111-8111-111111111111",
  sportId = "22222222-2222-4222-8222-222222222222";
function setup(values: number[]) {
  const tx: any = {
    skill: { count: jest.fn().mockResolvedValue(5) },
    playerInternalRating: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          values.map((value, i) => ({
            skillId: `skill-${i}`,
            skill: { name: `Skill ${i}` },
            initialRating: new Prisma.Decimal(3),
            currentRating: new Prisma.Decimal(value),
            feedbackCount: i ? 1 : 100,
          })),
        ),
    },
  };
  const db: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  return { tx, db, service: new InternalRatingsService(db) };
}
it("averages active internal ratings equally without treating missing skills as zero", async () => {
  const { service, tx } = setup([4, 3]);
  const result = await service.summary(userId, userId, sportId);
  expect(result.overallRating).toBe(3.5);
  expect(result.ratedSkillCount).toBe(2);
  expect(result.totalSkillCount).toBe(5);
  expect(tx.playerInternalRating.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId, skill: { sportId, active: true } },
    }),
  );
  expect(tx.skill.count).toHaveBeenCalledWith({
    where: { sportId, active: true },
  });
});
it("uses decimal rounding and returns no overall rating when no skills are initialized", async () => {
  expect(
    (await setup([1.00005]).service.summary(userId, userId, sportId))
      .overallRating,
  ).toBe(1.0001);
  const result = await setup([]).service.summary(userId, userId, sportId);
  expect(result.overallRating).toBeNull();
  expect(result.ratedSkillCount).toBe(0);
});
it("rejects another user before querying private ratings", async () => {
  const { service, db } = setup([3]);
  await expect(
    service.summary("33333333-3333-4333-8333-333333333333", userId, sportId),
  ).rejects.toThrow("private");
  expect(db.$transaction).not.toHaveBeenCalled();
});
