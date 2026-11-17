import { Prisma } from "@prisma/client";
import { ANALYSIS_CONFIG as C, DAY_MS, PRIMARY_SKILL_SLUGS } from "./config";
type Db = Pick<Prisma.TransactionClient, "$queryRaw">;
export type SummaryRow = {
  feedback: number;
  written: number;
  verified: number;
  guests: number;
  latest: Date | null;
  awaiting: number;
  failed: number;
  moderated: number;
};
export type SkillRow = {
  skillId: string;
  name: string;
  slug: string;
  count: number;
  average: number | null;
  latest: Date | null;
  recent5Count: number;
  recent5Average: number | null;
  previous5Count: number;
  previous5Average: number | null;
  recent30Count: number;
  recent30Average: number | null;
  recent90Count: number;
  recent90Average: number | null;
  previous90Count: number;
  previous90Average: number | null;
  selfRating: number | null;
  internalRating: number | null;
};
export type ThemeRow = {
  themeId: string;
  name: string;
  skillIds: string[];
  raw: number;
  feedback: number;
  positive: number;
  negative: number;
  neutral: number;
  verified: number;
  negativeVerified: number;
  guests: number;
  coverage: number;
  verifiedCoverage: number;
  first: Date | null;
  last: Date | null;
  lastNegative: Date | null;
  denominatorKind: string;
  recentFeedback: number;
  recentCoverage: number;
  recentPositive: number;
  recentNegative: number;
  recentNeutral: number;
  recentVerified: number;
  recentNegativeVerified: number;
  previousFeedback: number;
  previousCoverage: number;
  previousPositive: number;
  previousNegative: number;
  previousNeutral: number;
  previousVerified: number;
  previousNegativeVerified: number;
};
const dateBefore = (asOf: Date, days: number) =>
  new Date(asOf.getTime() - days * DAY_MS);
function eligible(userId: string, sportId: string, asOf: Date) {
  return Prisma.sql`
 eligible AS (SELECT * FROM "AnalysisEligibleFeedback" WHERE "recipientId"=${userId}::uuid AND "sportId"=${sportId}::uuid AND "createdAt"<=${asOf}),
 written AS (SELECT f.* FROM eligible f WHERE EXISTS (SELECT 1 FROM "Feedback" src WHERE src.id=f.id AND feedback_analysis_eligible(src)) AND (NULLIF(btrim(f."overallComment"),'') IS NOT NULL OR EXISTS
  (SELECT 1 FROM "FeedbackRating" r WHERE r."feedbackId"=f.id AND NULLIF(btrim(r.comment),'') IS NOT NULL)))`;
}
export async function summaryQuery(
  db: Db,
  userId: string,
  sportId: string,
  asOf: Date,
): Promise<SummaryRow> {
  const [row] = await db.$queryRaw<
    SummaryRow[]
  >(Prisma.sql`WITH ${eligible(userId, sportId, asOf)}
 SELECT count(*)::int AS feedback,(SELECT count(*)::int FROM written) AS written,
 count(DISTINCT f."reviewerId")::int AS verified,count(*) FILTER(WHERE f."reviewerId" IS NULL)::int AS guests,
 max(f."createdAt") AS latest,
 count(*) FILTER(WHERE f.id IN (SELECT id FROM written) AND (j.status IS NULL OR (j.status<>'FAILED' AND (j.status<>'COMPLETED' OR j.moderation<>'ALLOW'))))::int AS awaiting,
 count(*) FILTER(WHERE f.id IN (SELECT id FROM written) AND j.status='FAILED')::int AS failed,
 (SELECT count(*)::int FROM "Feedback" x JOIN "FeedbackAnalysisJob" xj ON xj."feedbackId"=x.id
  WHERE x."recipientId"=${userId}::uuid AND x."sportId"=${sportId}::uuid AND x."createdAt"<=${asOf}
   AND feedback_analysis_eligible(x) AND xj.moderation NOT IN ('ALLOW','UNASSESSED')) AS moderated
 FROM eligible f LEFT JOIN "FeedbackAnalysisJob" j ON j."feedbackId"=f.id`);
  return row;
}
export function skillQuery(
  db: Db,
  userId: string,
  sportId: string,
  asOf: Date,
): Promise<SkillRow[]> {
  return db.$queryRaw<
    SkillRow[]
  >(Prisma.sql`WITH ${eligible(userId, sportId, asOf)}, ranked AS
 (SELECT r.*,f."createdAt" AS submitted,row_number() OVER(PARTITION BY r."skillId" ORDER BY f."createdAt" DESC,f.id DESC) AS rank
  FROM eligible f JOIN "FeedbackRating" r ON r."feedbackId"=f.id)
 SELECT s.id AS "skillId",s.name,s.slug,count(r."feedbackId")::int AS count,avg(r.rating)::float AS average,max(r.submitted) AS latest,
 count(*) FILTER(WHERE r.rank<=${C.recentRatingWindow})::int AS "recent5Count",avg(r.rating) FILTER(WHERE r.rank<=${C.recentRatingWindow})::float AS "recent5Average",
 count(*) FILTER(WHERE r.rank>${C.recentRatingWindow} AND r.rank<=${C.recentRatingWindow * 2})::int AS "previous5Count",avg(r.rating) FILTER(WHERE r.rank>${C.recentRatingWindow} AND r.rank<=${C.recentRatingWindow * 2})::float AS "previous5Average",
 count(*) FILTER(WHERE r.submitted>=${dateBefore(asOf, C.recencyDays)})::int AS "recent30Count",avg(r.rating) FILTER(WHERE r.submitted>=${dateBefore(asOf, C.recencyDays)})::float AS "recent30Average",
 count(*) FILTER(WHERE r.submitted>=${dateBefore(asOf, C.recentDays)})::int AS "recent90Count",avg(r.rating) FILTER(WHERE r.submitted>=${dateBefore(asOf, C.recentDays)})::float AS "recent90Average",
 count(*) FILTER(WHERE r.submitted>=${dateBefore(asOf, C.recentDays + C.precedingDays)} AND r.submitted<${dateBefore(asOf, C.recentDays)})::int AS "previous90Count",
 avg(r.rating) FILTER(WHERE r.submitted>=${dateBefore(asOf, C.recentDays + C.precedingDays)} AND r.submitted<${dateBefore(asOf, C.recentDays)})::float AS "previous90Average",
 sr.rating AS "selfRating",ir."currentRating"::float AS "internalRating"
 FROM "Skill" s LEFT JOIN ranked r ON r."skillId"=s.id
 LEFT JOIN "SelfAssessment" a ON a."userId"=${userId}::uuid AND a."sportId"=s."sportId"
 LEFT JOIN "SelfAssessmentRating" sr ON sr."selfAssessmentId"=a.id AND sr."skillId"=s.id
 LEFT JOIN "PlayerInternalRating" ir ON ir."userId"=${userId}::uuid AND ir."skillId"=s.id
 WHERE s."sportId"=${sportId}::uuid AND s.active AND s.slug IN (${Prisma.join(PRIMARY_SKILL_SLUGS)})
 GROUP BY s.id,sr.rating,ir."currentRating" ORDER BY CASE s.slug WHEN 'attack' THEN 1 WHEN 'defense' THEN 2 WHEN 'passing' THEN 3 WHEN 'setting' THEN 4 ELSE 5 END`);
}
export function themeQuery(
  db: Db,
  userId: string,
  sportId: string,
  asOf: Date,
): Promise<ThemeRow[]> {
  const recent = dateBefore(asOf, C.recentDays),
    previous = dateBefore(asOf, C.recentDays + C.precedingDays);
  return db.$queryRaw<
    ThemeRow[]
  >(Prisma.sql`WITH ${eligible(userId, sportId, asOf)},
 active_themes AS (SELECT t.* FROM "FeedbackTheme" t WHERE t.active AND (cardinality(t."skillSlugs")=0 OR EXISTS
  (SELECT 1 FROM "Skill" s WHERE s."sportId"=${sportId}::uuid AND s.active AND s.slug=ANY(t."skillSlugs")))),
 obs AS (SELECT o.*,f."createdAt" AS submitted,f."reviewerId" FROM "EligibleFeedbackObservation" o JOIN eligible f ON f.id=o."feedbackId"),
 mentions AS (SELECT "themeId","feedbackId",min(submitted) AS submitted,min("reviewerId"::text)::uuid AS reviewer,
  count(*)::int AS raw,bool_or(sentiment='positive') AS positive,bool_or(sentiment='negative') AS negative,bool_or(sentiment='neutral') AS neutral
  FROM obs GROUP BY "themeId","feedbackId"),
 theme_skills AS (SELECT t.id AS theme,s.id AS skill FROM active_themes t JOIN "Skill" s ON s.slug=ANY(t."skillSlugs") AND s."sportId"=${sportId}::uuid AND s.active
  UNION SELECT o."themeId",o."skillId" FROM obs o JOIN "Skill" s ON s.id=o."skillId" AND s.active),
 skill_coverage AS (SELECT r."skillId" AS skill,r."feedbackId" AS feedback,f."createdAt" AS submitted,f."reviewerId" AS reviewer
  FROM "FeedbackRating" r JOIN eligible f ON f.id=r."feedbackId" WHERE NULLIF(btrim(r.comment),'') IS NOT NULL
  UNION SELECT "skillId","feedbackId",submitted,"reviewerId" FROM obs WHERE "skillId" IS NOT NULL),
 coverage AS (SELECT ts.theme,c.feedback,c.submitted,c.reviewer FROM theme_skills ts JOIN skill_coverage c ON c.skill=ts.skill
  UNION SELECT "themeId","feedbackId",submitted,reviewer FROM mentions
  UNION SELECT t.id,w.id,w."createdAt",w."reviewerId" FROM active_themes t CROSS JOIN written w WHERE cardinality(t."skillSlugs")=0),
 coverage_stats AS (SELECT c.theme,count(*)::int AS count,count(DISTINCT c.reviewer)::int AS verified,
  count(*) FILTER(WHERE c.submitted>=${recent})::int AS recent,
  count(*) FILTER(WHERE c.submitted>=${previous} AND c.submitted<${recent})::int AS previous
  FROM coverage c GROUP BY c.theme)
 SELECT t.id AS "themeId",t.name,ARRAY(SELECT ts.skill::text FROM theme_skills ts WHERE ts.theme=t.id ORDER BY ts.skill) AS "skillIds",
 coalesce(sum(m.raw),0)::int AS raw,count(m."feedbackId")::int AS feedback,
 count(*) FILTER(WHERE m.positive)::int AS positive,count(*) FILTER(WHERE m.negative)::int AS negative,count(*) FILTER(WHERE m.neutral)::int AS neutral,
 count(DISTINCT m.reviewer)::int AS verified,count(DISTINCT m.reviewer) FILTER(WHERE m.negative)::int AS "negativeVerified",
 count(*) FILTER(WHERE m."feedbackId" IS NOT NULL AND m.reviewer IS NULL)::int AS guests,
 coalesce(cs.count,0) AS coverage,coalesce(cs.verified,0) AS "verifiedCoverage",
 min(m.submitted) AS first,max(m.submitted) AS last,max(m.submitted) FILTER(WHERE m.negative) AS "lastNegative",
 CASE WHEN cardinality(t."skillSlugs")=0 THEN 'ELIGIBLE_WRITTEN_REVIEWS' ELSE 'SKILL_WRITTEN_REVIEWS' END AS "denominatorKind",
 count(*) FILTER(WHERE m.submitted>=${recent})::int AS "recentFeedback",coalesce(cs.recent,0) AS "recentCoverage",
 count(*) FILTER(WHERE m.submitted>=${recent} AND m.positive)::int AS "recentPositive",
 count(*) FILTER(WHERE m.submitted>=${recent} AND m.negative)::int AS "recentNegative",
 count(*) FILTER(WHERE m.submitted>=${recent} AND m.neutral)::int AS "recentNeutral",
 count(DISTINCT m.reviewer) FILTER(WHERE m.submitted>=${recent})::int AS "recentVerified",
 count(DISTINCT m.reviewer) FILTER(WHERE m.submitted>=${recent} AND m.negative)::int AS "recentNegativeVerified",
 count(*) FILTER(WHERE m.submitted>=${previous} AND m.submitted<${recent})::int AS "previousFeedback",coalesce(cs.previous,0) AS "previousCoverage",
 count(*) FILTER(WHERE m.submitted>=${previous} AND m.submitted<${recent} AND m.positive)::int AS "previousPositive",
 count(*) FILTER(WHERE m.submitted>=${previous} AND m.submitted<${recent} AND m.negative)::int AS "previousNegative",
 count(*) FILTER(WHERE m.submitted>=${previous} AND m.submitted<${recent} AND m.neutral)::int AS "previousNeutral",
 count(DISTINCT m.reviewer) FILTER(WHERE m.submitted>=${previous} AND m.submitted<${recent})::int AS "previousVerified",
 count(DISTINCT m.reviewer) FILTER(WHERE m.submitted>=${previous} AND m.submitted<${recent} AND m.negative)::int AS "previousNegativeVerified"
 FROM active_themes t LEFT JOIN mentions m ON m."themeId"=t.id LEFT JOIN coverage_stats cs ON cs.theme=t.id
 GROUP BY t.id,t.name,t."skillSlugs",cs.count,cs.verified,cs.recent,cs.previous ORDER BY t.id`);
}
