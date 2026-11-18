import { validateSync } from "class-validator";
import { Prisma } from "@prisma/client";
import {
  isFeedbackRating,
  feedbackNumber,
  ensureDecimalFeedbackStorage,
} from "../src/common/feedback-rating";
import { RatingInput, AssessmentRatingInput } from "../src/common/inputs";
import { RatingAlgorithm, decimal } from "../src/internal-ratings/algorithm";
import {
  FeedbackRatingResolver,
  ApprovalRatingResolver,
} from "../src/feedback/rating.resolver";
describe("peer rating decimal tenths", () => {
  it.each([1, 1.1, 2.5, 3.5, 4.2, 4.7, 5])("accepts %s exactly", (rating) => {
    expect(isFeedbackRating(rating)).toBe(true);
    const input = Object.assign(new RatingInput(), {
      skillId: "11111111-1111-4111-8111-111111111111",
      rating,
    });
    expect(validateSync(input)).toEqual([]);
  });
  it.each([
    0,
    5.5,
    3.55,
    4.199999999999999,
    NaN,
    Infinity,
    -Infinity,
    null,
    undefined,
    "4.2",
  ])("rejects invalid rating %s instead of rounding", (rating) => {
    expect(isFeedbackRating(rating)).toBe(false);
    expect(
      validateSync(
        Object.assign(new RatingInput(), {
          skillId: "11111111-1111-4111-8111-111111111111",
          rating,
        }),
      ),
    ).not.toHaveLength(0);
  });
  it("keeps self-assessment validation integer-only", () => {
    expect(
      validateSync(
        Object.assign(new AssessmentRatingInput(), {
          skillId: "11111111-1111-4111-8111-111111111111",
          rating: 3.5,
        }),
      ),
    ).not.toHaveLength(0);
  });
  it("serializes Prisma Decimal as a GraphQL Float for feedback and approval ratings", () => {
    const row = { rating: new Prisma.Decimal("4.7") };
    expect(feedbackNumber(row.rating)).toBe(4.7);
    expect(new FeedbackRatingResolver().rating(row)).toBe(4.7);
    expect(new ApprovalRatingResolver().rating(row)).toBe(4.7);
  });
  it.each([
    [3.5, "3.05"],
    [4.2, "3.12"],
    [4.7, "3.17"],
  ])(
    "applies %s without changing the existing calculation",
    (submitted, expected) => {
      const a = new RatingAlgorithm(),
        previous = decimal(3),
        rate = decimal("0.1");
      expect(a.apply(previous, Number(submitted), rate).next.toString()).toBe(
        expected,
      );
      expect(a.apply(previous, decimal(submitted), rate).next.toString()).toBe(
        expected,
      );
      const influence = a.influence(decimal(3.5), 0.35),
        result = a.apply(previous, Number(submitted), influence.finalRate);
      expect(
        result.next.equals(
          previous
            .plus(influence.finalRate.mul(decimal(submitted).minus(previous)))
            .toDecimalPlaces(8),
        ),
      ).toBe(true);
    },
  );
  it("blocks fractional writes against an unmigrated database", async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([{ ready: false }]) };
    await expect(
      ensureDecimalFeedbackStorage(db, [{ rating: 4.7 }]),
    ).rejects.toThrow("migration");
    db.$queryRaw.mockResolvedValue([{ ready: true }]);
    await expect(
      ensureDecimalFeedbackStorage(db, [{ rating: 4.7 }]),
    ).resolves.toBeUndefined();
  });
});
