import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dateRangeBounds } from '../common/date-range';
import { DailyAnalyticsPoint } from './dashboard.models';
type ScoredMatch = { playedAt: Date | null; teams: { id: string; score: number | null }[]; participants: { teamId: string | null }[] };
export type RatingDay = { date: string; skillId: string; average: number; count: bigint | number };
export function summarizeDays(matches: ScoredMatch[], ratings: RatingDay[], timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const points = new Map<string, DailyAnalyticsPoint>();
  function point(date: string) {
    let value = points.get(date);
    if (!value) { value = { date, wins: 0, losses: 0, winRate: null, ratings: [] }; points.set(date, value); }
    return value;
  }
  for (const match of matches) {
    const team = match.teams.find(item => item.id === match.participants[0]?.teamId);
    if (!match.playedAt || !team || match.teams.length < 2 || match.teams.some(item => item.score == null)) continue;
    const highest = Math.max(...match.teams.map(item => item.score!));
    if (match.teams.filter(item => item.score === highest).length !== 1) continue;
    const parts = formatter.formatToParts(match.playedAt);
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    const day = point(`${part('year')}-${part('month')}-${part('day')}`);
    if (team.score === highest) day.wins++; else day.losses++;
    day.winRate = day.wins / (day.wins + day.losses) * 100;
  }
  let ratingCount = 0;
  for (const rating of ratings) {
    const count = Number(rating.count);
    point(rating.date).ratings.push({ skillId: rating.skillId, average: Number(rating.average), count });
    ratingCount += count;
  }
  const rows = [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { points: rows, wins: rows.reduce((sum, day) => sum + day.wins, 0), losses: rows.reduce((sum, day) => sum + day.losses, 0), ratingCount };
}
@Injectable()
export class DashboardService {
  constructor(private db: PrismaService) {}
  async categoryFeedback(actor: string, skillId: string, from?: Date, before?: Date) {
    if (!isUUID(skillId)) throw new BadRequestException('Invalid category ID');
    const now = new Date();
    const end = before && before < now ? before : now;
    dateRangeBounds(from, before);
    dateRangeBounds(from, end);
    const rows = await this.db.feedbackRating.findMany({
      where: {
        skillId, skill: { active: true, sport: { slug: 'beach-volleyball' } },
        feedback: { recipientId: actor, status: 'PUBLISHED', sport: { slug: 'beach-volleyball' }, createdAt: { ...(from ? { gte: from } : {}), lt: end } },
      },
      select: { rating: true, feedback: { select: { id: true, createdAt: true } } },
      orderBy: [{ feedback: { createdAt: 'asc' } }, { feedbackId: 'asc' }],
    });
    return rows.map(row => ({ id: row.feedback.id, submittedAt: row.feedback.createdAt, rating: row.rating }));
  }
  async dashboard(actor: string, from?: Date, before?: Date, timeZone = 'UTC') {
    try { if (timeZone.length > 80) throw new Error(); new Intl.DateTimeFormat('en', { timeZone }).format(); }
    catch { throw new BadRequestException('Invalid time zone'); }
    const now = new Date();
    const end = before && before < now ? before : now;
    dateRangeBounds(from, before); // Validate before clamping future timestamps.
    dateRangeBounds(from, end);
    const [categories, matches, ratings] = await Promise.all([
      this.db.skill.findMany({ where: { sport: { slug: 'beach-volleyball' }, active: true }, orderBy: { name: 'asc' } }),
      this.db.match.findMany({
        where: { sport: { slug: 'beach-volleyball' }, playedAt: { ...(from ? { gte: from } : {}), lt: end }, status: { notIn: ['CANCELLED', 'IN_PROGRESS'] }, participants: { some: { userId: actor, teamId: { not: null } } } },
        select: { playedAt: true, teams: { select: { id: true, score: true } }, participants: { where: { userId: actor }, select: { teamId: true } } },
      }),
      this.db.$queryRaw<RatingDay[]>(Prisma.sql`
        SELECT to_char(timezone(${timeZone}, f."createdAt"), 'YYYY-MM-DD') AS date,
          r."skillId", avg(r.rating)::float8 AS average, count(*) AS count
        FROM "FeedbackRating" r JOIN "Feedback" f ON f.id = r."feedbackId"
        JOIN "Skill" s ON s.id = r."skillId" JOIN "Sport" sport ON sport.id = s."sportId"
        WHERE f."recipientId" = ${actor}::uuid AND f.status = 'PUBLISHED' AND sport.slug = 'beach-volleyball' AND s.active = true
          AND f."sportId" = s."sportId" AND f."createdAt" < ${end}
          ${from ? Prisma.sql`AND f."createdAt" >= ${from}` : Prisma.empty}
        GROUP BY 1, r."skillId" ORDER BY 1, r."skillId"
      `),
    ]);
    return { categories, ...summarizeDays(matches, ratings, timeZone), from: from ?? null, before: end, timeZone };
  }
}
