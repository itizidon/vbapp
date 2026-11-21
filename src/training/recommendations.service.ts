import { privatePlayer } from "../auth/clerk/metadata";
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TrainingAccess } from "./access";
import { TrainingLibraryService, jsonData } from "./library.service";
import {
  CreateDrillRecommendationRuleInput,
  UpdateDrillRecommendationRuleInput,
} from "./dto";
import { validateConditions, evaluateRule, FactEvidence } from "./rules";
import { parse, trainingProfileSchema } from "./validation";
import { cachedProfileReady } from "../feedback-processing/profiles";
import { FeedbackAnalysisProfile } from "../feedback-analysis/models";
@Injectable()
export class TrainingRecommendations {
  constructor(
    private db: PrismaService,
    private access: TrainingAccess,
    private library: TrainingLibraryService,
  ) {}
  async saveRule(
    actor: string,
    input:
      CreateDrillRecommendationRuleInput | UpdateDrillRecommendationRuleInput,
    id?: string,
  ) {
    await this.access.editor(actor);
    return this.library.write(async (tx) => {
      const old = id
        ? await tx.drillRecommendationRule.findUniqueOrThrow({ where: { id } })
        : null;
      const data = { ...old, ...input };
      if (!data.drillId || !data.conditions || !data.effect)
        throw new BadRequestException("Rule fields are required");
      await this.library.drill(data.drillId, actor, tx);
      if (old && old.drillId !== data.drillId)
        throw new BadRequestException("Cannot move rules between drills");
      if (
        data.situationId &&
        !(await tx.coachingSituation.findUnique({
          where: { id: data.situationId },
        }))
      )
        throw new BadRequestException("Situation not found");
      const conditions = validateConditions(data.conditions, data.effect);
      return id
        ? tx.drillRecommendationRule.update({
            where: { id },
            data: {
              ...jsonData(input),
              conditions: conditions as any,
              version: { increment: 1 },
            },
          })
        : tx.drillRecommendationRule.create({
            data: { ...jsonData(input), conditions: conditions as any },
          });
    });
  }
  async deleteRule(actor: string, id: string) {
    await this.access.editor(actor);
    await this.db.drillRecommendationRule.delete({ where: { id } });
    return true;
  }
  async updateProfile(actor: string, data: unknown) {
    await this.access.user(actor);
    const parsed = parse(trainingProfileSchema, data);
    await this.access.users.updatePlayerMetadata(actor, {
      trainingPreferences: parsed,
    });
    return { userId: actor, data: parsed, updatedAt: new Date() };
  }
  async progress(actor: string, skillTreeNodeId: string, state: string) {
    await this.access.user(actor);
    if (!["NOT_STARTED", "PRACTICING", "CONFIDENT"].includes(state))
      throw new BadRequestException("Unknown progress state");
    await this.library.node(skillTreeNodeId);
    return this.db.playerSkillProgress.upsert({
      where: { userId_skillTreeNodeId: { userId: actor, skillTreeNodeId } },
      create: { userId: actor, skillTreeNodeId, state },
      update: { state },
    });
  }
  async completeDrill(actor: string, drillId: string) {
    await this.access.user(actor);
    await this.library.drill(drillId);
    return this.db.drillCompletion.create({ data: { userId: actor, drillId } });
  }
  async getRecommendedDrillsForUser(
    actor: string,
    userId: string,
    skillId?: string,
  ) {
    await this.access.owner(actor, userId);
    const sport = await this.db.sport.findUnique({
      where: { slug: "beach-volleyball" },
    });
    if (!sport)
      throw new NotFoundException("Beach volleyball catalog not initialized");
    const player = privatePlayer(
      await this.access.users.getUserById(userId, true),
    );
    const [training, assessment, progress, completed, cache, drills] =
      await Promise.all([
        Promise.resolve(
          player.trainingPreferences
            ? { data: player.trainingPreferences }
            : null,
        ),
        Promise.resolve(
          player.assessment?.sportId === sport.id
            ? {
                overallLevel: player.assessment.overallLevel,
                ratings: player.assessment.ratings,
              }
            : null,
        ),
        this.db.playerSkillProgress.findMany({ where: { userId } }),
        this.db.drillCompletion.findMany({
          where: { userId },
          select: { drillId: true },
          distinct: ["drillId"],
        }),
        this.db.playerFeedbackAnalysisProfile.findUnique({
          where: { userId_sportId: { userId, sportId: sport.id } },
        }),
        this.db.drill.findMany({
          where: {
            status: "PUBLISHED",
            skills: {
              some: {
                ...(skillId ? { skillTreeNodeId: skillId } : {}),
                skillTreeNode: { status: "PUBLISHED" },
              },
            },
          },
          include: {
            rules: {
              where: {
                enabled: true,
                OR: [
                  { situationId: null },
                  { situation: { status: "PUBLISHED" } },
                ],
              },
            },
          },
          orderBy: { id: "asc" },
          take: 501,
        }),
      ]);
    if (drills.length > 500)
      throw new BadRequestException("Narrow recommendation scope");
    const pref = training ? parse(trainingProfileSchema, training.data) : null;
    const profile =
      cache && cachedProfileReady(cache)
        ? (cache.data as unknown as FeedbackAnalysisProfile)
        : null;
    const lookup = (f: any): FactEvidence => {
      const unknown = { value: null, source: "UNKNOWN" };
      switch (f.fact) {
        case "overallLevel":
          return {
            value: assessment?.overallLevel ?? null,
            source: "SELF_ASSESSMENT",
          };
        case "selfAssessment":
          return {
            value:
              assessment?.ratings.find((r) => r.skillId === f.key)?.rating ??
              null,
            source: "SELF_ASSESSMENT",
          };
        case "skillProgress":
          return {
            value:
              progress.find((p) => p.skillTreeNodeId === f.key)?.state ?? null,
            source: "SELF_REPORTED_PROGRESS",
          };
        case "completedDrill":
          return {
            value: completed.some((c) => c.drillId === f.key),
            source: "RECORDED_COMPLETION",
          };
        case "feedbackThemeCount": {
          if (!profile || profile.state !== "COMPLETE") return unknown;
          const t = profile.themes.find((t) => t.themeId === f.key);
          if (!t) return unknown;
          const trust = f.trust ?? "VERIFIED_APPROVED";
          return {
            value:
              t.trustBreakdown?.find((g) => g.classification === trust)
                ?.negativeFeedbackCount ?? 0,
            source: "AUTHORIZED_SQL_FEEDBACK_PROFILE",
            trust,
          };
        }
        default: {
          const key =
            f.fact === "reportedDifficulty" ? "reportedDifficulties" : f.fact;
          return {
            value: (pref as any)?.[key] ?? null,
            source: pref ? "SELF_REPORTED_TRAINING_PROFILE" : "UNKNOWN",
          };
        }
      }
    };
    return drills
      .map((drill) => {
        const evaluation = drill.rules.map((rule) => {
          const result = evaluateRule(
            validateConditions(rule.conditions, rule.effect).root,
            (leaf) => {
              if (
                rule.effect === "EXCLUDE" &&
                leaf.fact === "feedbackThemeCount"
              ) {
                const t = profile?.themes.find((t) => t.themeId === leaf.key);
                if (!t || t.distinctNegativeReviewers < 2)
                  return {
                    value: null,
                    source: "INSUFFICIENT_VERIFIED_DIVERSITY",
                  };
              }
              return lookup(leaf);
            },
          );
          const unverified = result.evidence.some(
            (e) => e.trust && e.trust !== "VERIFIED_APPROVED",
          );
          return {
            ruleId: rule.id,
            name: rule.name,
            rationale: rule.rationale,
            effect: rule.effect,
            priority: rule.priority,
            version: rule.version,
            ...result,
            weightedBoost:
              result.state === "MATCH" && rule.effect === "BOOST"
                ? rule.priority * (unverified ? 0.35 : 1)
                : 0,
          };
        });
        return {
          drill,
          score: evaluation.reduce((n, r) => n + r.weightedBoost, 0),
          excluded: evaluation.some(
            (r) => r.effect === "EXCLUDE" && r.state === "MATCH",
          ),
          evaluation,
        };
      })
      .sort(
        (a, b) =>
          Number(a.excluded) - Number(b.excluded) ||
          b.score - a.score ||
          a.drill.id.localeCompare(b.drill.id),
      );
  }
}
