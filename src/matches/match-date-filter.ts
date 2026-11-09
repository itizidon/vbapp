import { Prisma } from '@prisma/client';
import { dateRangeBounds } from '../common/date-range';
export function matchDateFilter(playedFrom?: Date, playedBefore?: Date): Prisma.MatchWhereInput {
  const bounds = dateRangeBounds(playedFrom, playedBefore);
  return bounds ? { playedAt: bounds } : {};
}
