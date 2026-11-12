import { Prisma } from "@prisma/client";
import {
  summarizePerformance,
  DashboardService,
} from "../src/analytics/dashboard.service";
const match = (a: number | null, b: number | null) => ({
  playedAt: new Date(),
  teams: [
    { id: "mine", score: a },
    { id: "theirs", score: b },
  ],
  participants: [{ teamId: "mine" }],
});
it("calculates real win rate and consecutive wins from newest-first scored matches", () => {
  expect(
    summarizePerformance([match(21, 18), match(21, 19), match(15, 21)]),
  ).toEqual({
    winRate: expect.closeTo(66.6666667, 5),
    currentStreak: 2,
    streakKind: "WIN",
    gamesPlayed: 3,
  });
});
it("counts completed unscored games without inventing outcomes and breaks streaks on ties", () => {
  expect(
    summarizePerformance([
      match(null, null),
      match(18, 21),
      match(15, 15),
      match(10, 21),
    ]),
  ).toEqual({
    winRate: 0,
    currentStreak: 1,
    streakKind: "LOSS",
    gamesPlayed: 4,
  });
  expect(
    summarizePerformance([match(15, 15), match(21, 10)]).currentStreak,
  ).toBe(0);
  expect(summarizePerformance([])).toEqual({
    winRate: null,
    currentStreak: 0,
    streakKind: "NONE",
    gamesPlayed: 0,
  });
});
it("scopes career statistics and internal rating average to the signed-in player", async () => {
  const tx: any = {
    match: { findMany: jest.fn().mockResolvedValue([match(21, 15)]) },
    playerInternalRating: {
      aggregate: jest.fn().mockResolvedValue({
        _avg: { currentRating: new Prisma.Decimal("3.752345") },
        _count: 3,
      }),
    },
  };
  const db: any = { $transaction: async (fn: any) => fn(tx) };
  expect(
    await new DashboardService(db).performanceSummary("owner"),
  ).toMatchObject({
    winRate: 100,
    gamesPlayed: 1,
    averagePlayerRating: 3.7523,
    ratedSkillCount: 3,
  });
  expect(tx.match.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        status: "COMPLETED",
        participants: { some: { userId: "owner", teamId: { not: null } } },
      }),
    }),
  );
  expect(tx.playerInternalRating.aggregate).toHaveBeenCalledWith({
    where: {
      userId: "owner",
      skill: { active: true, sport: { slug: "beach-volleyball" } },
    },
    _avg: { currentRating: true },
    _count: true,
  });
});
