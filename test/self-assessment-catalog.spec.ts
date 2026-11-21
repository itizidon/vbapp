import { randomUUID } from "node:crypto";
import { SelfAssessmentsService } from "../src/self-assessments/self-assessments.service";
import { assessmentSchema } from "../src/auth/clerk/metadata";

function setup() {
  const sportId = randomUUID(),
    skillId = randomUUID();
  const assessment = assessmentSchema.parse({
    id: randomUUID(),
    sportId,
    ratings: [{ skillId, rating: 3 }],
    overallLevel: "B",
    revision: randomUUID(),
    updatedAt: new Date().toISOString(),
  });
  const user = { privateMetadata: { bvbtips: { version: 1, assessment } } };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
    skill: { findMany: jest.fn().mockResolvedValue([{ id: skillId }]) },
    selfAssessmentRatingEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    playerInternalRating: {
      upsert: jest.fn().mockResolvedValue({ initialRating: 3 }),
    },
    playerInternalRatingEvent: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const db = {
    $transaction: jest.fn(async (work) => work(tx)),
    sport: {
      findUnique: jest.fn().mockResolvedValue({
        id: sportId,
        skills: [{ id: skillId, requiredForSelfAssessment: true }],
      }),
    },
  };
  const users = {
    getUserById: jest.fn().mockResolvedValue(user),
    withPlayerLock: jest.fn(async (_id, work) => work()),
    updatePlayerMetadata: jest.fn().mockResolvedValue(user),
  };
  return {
    sportId,
    skillId,
    assessment,
    tx,
    db,
    users,
    service: new SelfAssessmentsService(db as never, users as never),
  };
}
it("does not replay missing skill IDs from Clerk after a database replacement", async () => {
  const { service, assessment, tx } = setup();
  tx.skill.findMany.mockResolvedValue([]);
  expect(await service.reconcile("user_fixture", assessment)).toBe(false);
  expect(tx.selfAssessmentRatingEvent.findUnique).not.toHaveBeenCalled();
  expect(tx.selfAssessmentRatingEvent.create).not.toHaveBeenCalled();
  expect(tx.playerInternalRating.upsert).not.toHaveBeenCalled();
});
it("does not expose an obsolete Clerk assessment as a current database assessment", async () => {
  const { service, tx } = setup();
  tx.skill.findMany.mockResolvedValue([]);
  expect(await service.list("user_fixture")).toEqual([]);
});
it("rejects the entire stale revision rather than importing a partial set of skills", async () => {
  const { service, assessment, tx } = setup();
  assessment.ratings.push({ skillId: randomUUID(), rating: 4 });
  expect(await service.reconcile("user_fixture", assessment)).toBe(false);
  expect(tx.selfAssessmentRatingEvent.create).not.toHaveBeenCalled();
});
it("can replace obsolete Clerk metadata using the new catalog during onboarding", async () => {
  const { service, sportId, skillId, tx, users, assessment } = setup();
  assessment.sportId = randomUUID();
  assessment.ratings[0].skillId = randomUUID();
  tx.skill.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: skillId }]);
  const saved = await service.onboard("user_fixture", {
    age: 25,
    heightCm: 180,
    sportId,
    overallLevel: "B",
    ratings: [{ skillId, rating: 4 }],
  });
  expect(saved.id).not.toBe(assessment.id);
  expect(users.updatePlayerMetadata).toHaveBeenCalledWith(
    "user_fixture",
    expect.objectContaining({
      assessment: expect.objectContaining({
        sportId,
        ratings: [{ skillId, rating: 4 }],
      }),
    }),
    { onboardingComplete: true },
    true,
  );
  expect(tx.selfAssessmentRatingEvent.create).toHaveBeenCalledTimes(1);
  expect(tx.selfAssessmentRatingEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ skillId, newRating: 4 }),
  });
});
it("reconciles current ratings once and does not cache an invalid revision", async () => {
  const { service, tx, assessment } = setup();
  tx.skill.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValue([{ id: assessment.ratings[0].skillId }]);
  expect(await service.reconcile("user_fixture", assessment)).toBe(false);
  expect(await service.reconcile("user_fixture", assessment)).toBe(true);
  expect(await service.reconcile("user_fixture", assessment)).toBe(true);
  expect(tx.selfAssessmentRatingEvent.create).toHaveBeenCalledTimes(1);
  expect(tx.skill.findMany).toHaveBeenCalledTimes(2);
});
