import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TrainingLibraryService } from "./library.service";
import { TrainingVideoService } from "./video.service";
import { TrainingRecommendations } from "./recommendations.service";
@Injectable()
export class TrainingCoachContext {
  constructor(
    private db: PrismaService,
    private library: TrainingLibraryService,
    private videos: TrainingVideoService,
    private recommendations: TrainingRecommendations,
  ) {}
  getRecommendedDrillsForUser(actor: string, userId: string, skillId?: string) {
    return this.recommendations.getRecommendedDrillsForUser(
      actor,
      userId,
      skillId,
    );
  }
  async getDrillTrainingContext(drillId: string) {
    const drill = await this.library.drill(drillId);
    const { createdById, ...content } = drill;
    return {
      ...content,
      rules: await this.db.drillRecommendationRule.findMany({
        where: {
          drillId,
          enabled: true,
          OR: [{ situationId: null }, { situation: { status: "PUBLISHED" } }],
        },
      }),
      checkpoints: await this.db.techniqueCheckpoint.findMany({
        where: { drillId, status: "PUBLISHED" },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      references: await this.videos.references(drillId),
    };
  }
  async getSkillLearningPath(actor: string, userId: string, skillId: string) {
    await this.library.access.owner(actor, userId);
    await this.library.node(skillId);
    const graph = await this.library.skillTree();
    const selected = new Set([skillId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of graph.edges)
        if (selected.has(e.skillId) && !selected.has(e.prerequisiteId)) {
          selected.add(e.prerequisiteId);
          changed = true;
        }
    }
    return {
      nodes: graph.nodes.filter((n) => selected.has(n.id)),
      prerequisites: graph.edges.filter((e) => selected.has(e.skillId)),
      progress: await this.db.playerSkillProgress.findMany({
        where: { userId, skillTreeNodeId: { in: [...selected] } },
        select: { skillTreeNodeId: true, state: true },
      }),
      policy:
        "Prerequisites guide learning; they do not hard-lock content. Progress is self-reported.",
    };
  }
  getAvailableReferenceVideos(drillId: string, variantId?: string) {
    return this.videos.references(drillId, variantId);
  }
  async getVideoAnalysisContext(actor: string, analysisId: string) {
    const row = await this.videos.analysis(actor, analysisId);
    return {
      id: row.id,
      status: row.status,
      analysisVersion: row.analysisVersion,
      result: row.status === "COMPLETED" ? row.result : null,
      references: row.references.map((r) => ({
        referenceVideoId: r.referenceVideoId,
        referenceVersion: r.referenceVersion,
        selectionReason: r.selectionReason,
      })),
      errorCode: row.errorCode,
    };
  }
  async getPlayerDrillHistory(actor: string, userId: string) {
    await this.library.access.owner(actor, userId);
    return this.db.drillCompletion.findMany({
      where: { userId },
      orderBy: { completedAt: "desc" },
      take: 100,
      select: { drillId: true, completedAt: true },
    });
  }
}
