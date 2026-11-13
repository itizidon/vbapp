import { AnalyticsResolver } from "../src/analytics/analytics.resolver";
it("counts published submissions for the authenticated player and requested sport, independently of ratings", async () => {
  const db: any = { feedback: { count: jest.fn().mockResolvedValue(23) } };
  const resolver = new AnalyticsResolver(db);
  expect(
    await resolver.feedbackCount({ id: "me" } as any, "me", "beach"),
  ).toEqual({ count: 23 });
  expect(db.feedback.count).toHaveBeenCalledWith({
    where: { recipientId: "me", sportId: "beach", status: "PUBLISHED" },
  });
  expect(
    await resolver.feedbackCount({ id: "other" } as any, "me", "beach"),
  ).toEqual({ count: 0 });
  expect(db.feedback.count).toHaveBeenCalledTimes(1);
});
it("aggregates published active-skill ratings without loading or paginating individual reviews", async () => {
  const db: any = {
    feedbackRating: {
      groupBy: jest
        .fn()
        .mockResolvedValue([
          { skillId: "passing", _avg: { rating: 4 }, _count: 25 },
        ]),
    },
  };
  const resolver = new AnalyticsResolver(db);
  expect(
    await resolver.userSkillRatings({ id: "me" } as any, "me", "beach"),
  ).toEqual([{ skillId: "passing", average: 4, count: 25 }]);
  expect(db.feedbackRating.groupBy).toHaveBeenCalledWith({
    by: ["skillId"],
    where: {
      skill: { sportId: "beach", active: true },
      feedback: { recipientId: "me", status: "PUBLISHED", sportId: "beach" },
    },
    _avg: { rating: true },
    _count: true,
  });
  expect(
    await resolver.userSkillRatings({ id: "other" } as any, "me", "beach"),
  ).toEqual([]);
  expect(db.feedbackRating.groupBy).toHaveBeenCalledTimes(1);
});
