import { Prisma } from "@prisma/client";
const D = Prisma.Decimal;
export const ALGORITHM_VERSION = 1;
export const decimal = (value: Prisma.Decimal.Value) => new D(value);
export const roundRating = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(8, D.ROUND_HALF_UP);
export interface RatingParameters {
  baseRate: number;
  normalization: number;
  guestConfidence: number;
  thresholds: [number, number, number];
  confidence: [number, number, number, number];
}
export const DEFAULT_PARAMETERS: RatingParameters = {
  baseRate: 0.2,
  normalization: 20,
  guestConfidence: 0.05,
  thresholds: [1, 5, 10],
  confidence: [0.1, 0.35, 0.75, 1],
};
export class RatingAlgorithm {
  readonly parameters: RatingParameters;
  constructor(parameters: Partial<RatingParameters> = {}) {
    this.parameters = { ...DEFAULT_PARAMETERS, ...parameters };
    const p = this.parameters;
    if (
      !(p.baseRate > 0 && p.baseRate <= 1) ||
      !(Number.isFinite(p.normalization) && p.normalization > 0) ||
      !(p.guestConfidence >= 0 && p.guestConfidence <= p.confidence[0]) ||
      p.thresholds.some(
        (v, i) =>
          !Number.isInteger(v) || v < 1 || (i > 0 && v <= p.thresholds[i - 1]),
      ) ||
      p.confidence.some(
        (v, i) =>
          !Number.isFinite(v) ||
          v < 0 ||
          v > 1 ||
          (i > 0 && v < p.confidence[i - 1]),
      )
    ) {
      throw new Error("Invalid internal rating parameters");
    }
  }
  confidence(distinctReviewers: number) {
    const p = this.parameters;
    return p.confidence[
      p.thresholds.filter((t) => distinctReviewers >= t).length
    ];
  }
  influence(reviewerRating: Prisma.Decimal | null, confidence: number) {
    const rating =
      reviewerRating === null ? decimal(1) : D.max(1, D.min(5, reviewerRating));
    const rawWeight = decimal(10)
      .pow(rating.minus(1).div(2))
      .toDecimalPlaces(12, D.ROUND_HALF_UP);
    const effectiveRate = decimal(this.parameters.baseRate)
      .mul(rawWeight)
      .div(rawWeight.plus(this.parameters.normalization))
      .toDecimalPlaces(12, D.ROUND_HALF_UP);
    return {
      rawWeight,
      effectiveRate,
      finalRate: effectiveRate
        .mul(confidence)
        .toDecimalPlaces(12, D.ROUND_HALF_UP),
    };
  }
  apply(
    previous: Prisma.Decimal,
    submitted: number,
    finalRate: Prisma.Decimal,
  ) {
    if (!Number.isInteger(submitted) || submitted < 1 || submitted > 5)
      throw new Error("Rating must be an integer from 1 to 5");
    const next = roundRating(
      D.max(
        1,
        D.min(
          5,
          previous.plus(finalRate.mul(decimal(submitted).minus(previous))),
        ),
      ),
    );
    return { next, delta: next.minus(previous) };
  }
}
export function algorithmFromEnvironment() {
  const get = (key: string, fallback: number) =>
    process.env[key] === undefined ? fallback : Number(process.env[key]);
  return new RatingAlgorithm({
    baseRate: get("RATING_BASE_RATE", 0.2),
    normalization: get("RATING_NORMALIZATION", 20),
    guestConfidence: get("RATING_GUEST_CONFIDENCE", 0.05),
    thresholds: [
      get("RATING_SOME_THRESHOLD", 1),
      get("RATING_ESTABLISHED_THRESHOLD", 5),
      get("RATING_STRONG_THRESHOLD", 10),
    ],
    confidence: [
      get("RATING_NEW_CONFIDENCE", 0.1),
      get("RATING_SOME_CONFIDENCE", 0.35),
      get("RATING_ESTABLISHED_CONFIDENCE", 0.75),
      get("RATING_STRONG_CONFIDENCE", 1),
    ],
  });
}
