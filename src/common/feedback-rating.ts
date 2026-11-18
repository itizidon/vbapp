import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ValidateBy } from "class-validator";
// Compare canonical decimal digits, not floating-point remainders or rounded values.
// JSON 4.2 is canonical '4.2'; 3.55 and arithmetic artifacts are rejected, not rounded.
export function isFeedbackRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 5 &&
    /^[1-5](?:\.[0-9])?$/.test(String(value))
  );
}
export const IsFeedbackRating = () =>
  ValidateBy({
    name: "isFeedbackRating",
    validator: {
      validate: isFeedbackRating,
      defaultMessage: () =>
        "Rating must be from 1.0 to 5.0 in increments of 0.1",
    },
  });
export function feedbackNumber(value: number | Prisma.Decimal): number {
  return typeof value === "number" ? value : value.toNumber();
}

// A newer API must never let PostgreSQL coerce fractional inputs into old INTEGER columns.
export async function ensureDecimalFeedbackStorage(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  ratings: { rating: number }[],
) {
  if (!ratings.length) return;
  const [row] = await db.$queryRaw<
    { ready: boolean }[]
  >`SELECT count(*)=3 AS ready FROM pg_attribute a
  WHERE NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)='numeric(3,1)' AND
   ((a.attrelid='"FeedbackRating"'::regclass AND a.attname='rating') OR
    (a.attrelid='"InternalRatingContribution"'::regclass AND a.attname='submittedRating') OR
    (a.attrelid='"PlayerInternalRatingEvent"'::regclass AND a.attname='submittedRating'))`;
  if (!row?.ready)
    throw new ServiceUnavailableException(
      "Apply the decimal feedback migration before submitting feedback ratings",
    );
}
