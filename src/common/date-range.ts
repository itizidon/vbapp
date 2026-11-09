import { BadRequestException } from '@nestjs/common';
export function dateRangeBounds(from?: Date, before?: Date) {
  if ([from, before].some(date => date && !Number.isFinite(date.getTime()))) throw new BadRequestException('Invalid date');
  if (from && before && from >= before) throw new BadRequestException('Start date must be before the end date');
  return from || before ? { ...(from ? { gte: from } : {}), ...(before ? { lt: before } : {}) } : undefined;
}
