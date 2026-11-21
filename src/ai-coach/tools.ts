import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FeedbackAnalysisProfile } from "../feedback-analysis/models";
import { TEMPLATE_VERSION } from "../feedback-processing/contracts";
import { CoachOpenAI } from "./provider";
import { CoachObservation, CoachFact } from "./facts";
import { CoachConfig } from "./config";
import { SearchArgs } from "./contracts";

interface ObservationRow {
  trustClassification: string;
  observationId: string;
  feedbackId: string;
  submittedAt: Date;
  themeId: string;
  themeName: string;
  skillId: string | null;
  sentiment: string;
  evidence: string;
}
const mapRow = (r: ObservationRow): CoachObservation => {
  const { evidence, ...fields } = r;
  return {
    ...fields,
    submittedAt: r.submittedAt.toISOString(),
    untrustedSourceText: evidence,
  };
};
@Injectable()
export class CoachTools {
  constructor(
    private readonly db: PrismaService,
    private readonly api: CoachOpenAI,
  ) {}
  private query<T>(sql: Prisma.Sql): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('statement_timeout','5000',true)`;
        return tx.$queryRaw<T>(sql);
      },
      { timeout: 7000, maxWait: 2000 },
    );
  }
  profile(
    profile: FeedbackAnalysisProfile,
    facts: Map<string, CoachFact>,
    question: string,
    maxBytes: number,
  ) {
    const words = question
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    const ordered = [...facts.values()].sort((a, b) => {
      const score = (f: CoachFact) =>
        (f.factId.startsWith("weakness.") ? 20 : 0) +
        words.filter((w) => f.claim.toLowerCase().includes(w)).length * 10 +
        (f.factId === "profile.total" ? 100 : 0);
      return score(b) - score(a) || a.factId.localeCompare(b.factId);
    });
    const result = {
      status: profile.state,
      asOf: profile.asOf,
      evidenceStatus: profile.evidenceStatus,
      eligibleReviewCount: profile.totalEligibleFeedbackCount,
      trustBreakdown: profile.trustBreakdown,
      evidencePolicy:
        "Verified approved evidence is preferred; guest names do not establish independent reviewers. Pending evidence requires explicit recipient-AI disclosure. Weighted scores are not review counts.",
      reviewerDiversity: {
        verified: profile.distinctVerifiedReviewers,
        guestFeedback: profile.guestFeedbackCount,
      },
      skills: profile.skills.map((s) => ({
        skillId: s.skillId,
        name: s.name,
        peer: s.peer,
        verifiedPeer: s.verifiedPeer,
        unverifiedPeer: s.unverifiedPeer,
        trustBreakdown: s.trustBreakdown,
        verifiedNinetyDayComparison: s.verifiedNinetyDayComparison,
        ninetyDayComparison: {
          recent: s.ninetyDayComparison.recent,
          previous: s.ninetyDayComparison.previous,
          delta: s.ninetyDayComparison.delta,
          trend: s.ninetyDayComparison.trend,
        },
        selfAssessment: s.selfAssessment,
        internalRating: s.internalRating,
      })),
      weaknesses: profile.weaknesses.slice(0, 3),
      themes: profile.themes
        .filter((t) => t.feedbackCount)
        .sort((a, b) => b.feedbackCount - a.feedbackCount)
        .slice(0, 8)
        .map((t) => ({
          themeId: t.themeId,
          feedbackCount: t.feedbackCount,
          trustBreakdown: t.trustBreakdown,
          positive: t.positiveFeedbackCount,
          negative: t.negativeFeedbackCount,
          denominator: t.relevantFeedbackCount,
          verifiedReviewers: t.distinctVerifiedReviewers,
          improvement: t.improvement,
          evidenceStatus: t.evidenceStatus,
        })),
      facts: ordered,
      truncated: false,
    };
    while (
      Buffer.byteLength(JSON.stringify(result)) > maxBytes &&
      result.facts.length
    ) {
      result.facts.pop();
      result.truncated = true;
    }
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes)
      throw Error("Profile tool output too large");
    return result;
  }
  async search(
    actorId: string,
    sportId: string,
    args: SearchArgs,
    config: CoachConfig,
    signal: AbortSignal,
    onUsage?: (tokens: number) => void,
  ) {
    if (
      args.from &&
      args.before &&
      Date.parse(args.from) >= Date.parse(args.before)
    )
      throw Error("Invalid date range");
    const limit = Math.min(
      args.limit ?? config.maxFeedbackSearchResults,
      config.maxFeedbackSearchResults,
    );
    const query = args.query?.trim() || null;
    const filters = Prisma.sql`f."recipientId"=${actorId}::text AND f."sportId"=${sportId}::uuid AND f."createdAt"<=CURRENT_TIMESTAMP
   ${args.skill ? Prisma.sql`AND s.slug=${args.skill}` : Prisma.empty}
   ${args.theme ? Prisma.sql`AND o."themeId"=${args.theme}` : Prisma.empty}
   ${args.from ? Prisma.sql`AND f."createdAt">=${new Date(args.from)}` : Prisma.empty}
   ${args.before ? Prisma.sql`AND f."createdAt"<${new Date(args.before)}` : Prisma.empty}`;
    const base = Prisma.sql`FROM "EligibleFeedbackObservation" o JOIN "Feedback" f ON f.id=o."feedbackId" JOIN "AnalysisEligibleFeedback" a ON a.id=f.id
   JOIN "FeedbackTheme" t ON t.id=o."themeId" LEFT JOIN "Skill" s ON s.id=o."skillId"`;
    const fields = Prisma.sql`feedback_trust_classification(f) AS "trustClassification",o.id AS "observationId",f.id AS "feedbackId",f."createdAt" AS "submittedAt",o."themeId",t.name AS "themeName",o."skillId",o.sentiment,o.evidence`;
    let rows: ObservationRow[] = [];
    let mode = "EXACT_FILTER";
    if (query) {
      const embedding = await this.api.embedding(query, signal, onUsage);
      const vector = JSON.stringify(embedding.vector);
      rows = await this.query<
        ObservationRow[]
      >(Prisma.sql`WITH candidates AS MATERIALIZED (
    SELECT ${fields},e.vector <=> ${vector}::vector AS distance
    ${base} JOIN "FeedbackObservationEmbedding" e ON e."observationId"=o.id
    JOIN "FeedbackEmbeddingJob" ej ON ej."observationId"=e."observationId" AND ej.provider=e.provider AND ej.model=e.model
      AND ej."modelVersion"=e."modelVersion" AND ej.dimensions=e.dimensions AND ej."templateVersion"=e."templateVersion"
      AND ej.status='COMPLETED' AND ej."sourceHash"=e."sourceHash"
    WHERE ${filters} AND e.provider=${embedding.provider} AND e.model=${embedding.model} AND e."modelVersion"=${embedding.modelVersion}
     AND e.dimensions=${embedding.dimensions} AND e."templateVersion"=${TEMPLATE_VERSION}),
    distinct_hits AS (SELECT DISTINCT ON ("feedbackId","themeId",sentiment) * FROM candidates ORDER BY "feedbackId","themeId",sentiment,distance,"observationId")
    SELECT "trustClassification","observationId","feedbackId","submittedAt","themeId","themeName","skillId",sentiment,evidence FROM distinct_hits ORDER BY distance,"submittedAt" DESC,"observationId" LIMIT ${limit}`);
      mode = "SEMANTIC";
    }
    if (!rows.length) {
      rows = await this.query<
        ObservationRow[]
      >(Prisma.sql`WITH distinct_hits AS (
    SELECT DISTINCT ON (f.id,o."themeId",o.sentiment) ${fields} ${base} WHERE ${filters}
     ${query ? Prisma.sql`AND to_tsvector('english',o.evidence||' '||t.name) @@ websearch_to_tsquery('english',${query})` : Prisma.empty}
    ORDER BY f.id,o."themeId",o.sentiment,o.id)
    SELECT * FROM distinct_hits ORDER BY "submittedAt" DESC,"observationId" LIMIT ${limit}`);
      if (query) mode = "KEYWORD_FALLBACK";
    }
    return {
      mode,
      observations: rows.map(mapRow),
      coverage:
        "A bounded retrieval sample, not a frequency statistic. Keyword fallback can indicate missing compatible embeddings.",
    };
  }
  async observationsByIds(
    actorId: string,
    sportId: string,
    ids: string[],
  ): Promise<CoachObservation[]> {
    if (!ids.length) return [];
    const rows = await this.query<
      ObservationRow[]
    >(Prisma.sql`SELECT feedback_trust_classification(f) AS "trustClassification",o.id AS "observationId",f.id AS "feedbackId",f."createdAt" AS "submittedAt",o."themeId",t.name AS "themeName",o."skillId",o.sentiment,o.evidence
   FROM "EligibleFeedbackObservation" o JOIN "Feedback" f ON f.id=o."feedbackId" JOIN "AnalysisEligibleFeedback" a ON a.id=f.id JOIN "FeedbackTheme" t ON t.id=o."themeId"
   WHERE f."recipientId"=${actorId}::text AND f."sportId"=${sportId}::uuid AND o.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
    return rows.map(mapRow);
  }
}
