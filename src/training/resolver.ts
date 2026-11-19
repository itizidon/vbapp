import { MotionAdmin } from "./motion-admin";
import { Resolver, Query, Mutation, Args, ID, Int } from "@nestjs/graphql";
import { UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { GqlAuthGuard } from "../common/gql-auth.guard";
import { OptionalGqlAuthGuard } from "../common/optional-gql-auth.guard";
import { CurrentUser, AuthUser } from "../common/current-user.decorator";
import { TrainingLibraryService } from "./library.service";
import { TrainingRecommendations } from "./recommendations.service";
import { TrainingVideoService, publicMedia } from "./video.service";
import { TrainingCoachContext } from "./context.service";
import * as D from "./dto";
@Resolver()
export class TrainingResolver {
  constructor(
    private motion: MotionAdmin,
    private library: TrainingLibraryService,
    private recommendations: TrainingRecommendations,
    private videos: TrainingVideoService,
    private context: TrainingCoachContext,
  ) {}
  @UseGuards(GqlAuthGuard)
  @Query(() => Boolean)
  async canManageTraining(@CurrentUser() user: AuthUser) {
    await this.library.access.user(user.id);
    return this.library.access.isEditor(user.id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillModel)
  createDrillWithContent(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.CreateDrillWithContentInput,
  ) {
    return this.library.createDrillWithContent(user.id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => D.TrainingJSON)
  trainingVideoWorkspace(
    @CurrentUser() user: AuthUser,
    @Args("drillId", { type: () => ID }, new ParseUUIDPipe()) id: string,
  ) {
    return this.motion.workspace(user.id, id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  configureDrillMotion(
    @CurrentUser() user: AuthUser,
    @Args("drillId", { type: () => ID }, new ParseUUIDPipe()) id: string,
    @Args("config", { type: () => D.TrainingJSON }) config: unknown,
  ) {
    return this.motion.configure(user.id, id, config);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  configureReferenceCoverage(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe()) id: string,
    @Args("config", { type: () => D.TrainingJSON }) config: unknown,
  ) {
    return this.motion.configureReference(user.id, id, config);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  retryTrainingVideo(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe()) id: string,
    @Args("reference") reference: boolean,
  ) {
    return this.motion.retry(user.id, id, reference);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  deleteReferenceVideo(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe()) id: string,
  ) {
    return this.motion.removeReference(user.id, id);
  }
  @UseGuards(OptionalGqlAuthGuard) @Query(() => D.TrainingGraph) skillTree(
    @CurrentUser() user: AuthUser,
    @Args(
      "categoryId",
      { type: () => ID, nullable: true },
      new ParseUUIDPipe({ optional: true }),
    )
    categoryId?: string,
  ) {
    return this.library.skillTree(user?.id, categoryId);
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => D.SkillTreeNodeModel)
  skillTreeNode(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library.node(id, user?.id);
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [D.SkillPrerequisiteModel])
  skillPrerequisites(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library
      .prerequisites(id, user?.id)
      .then((r) => r.prerequisites);
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [D.SkillPrerequisiteModel])
  skillDependents(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library.prerequisites(id, user?.id).then((r) => r.dependents);
  }
  @UseGuards(OptionalGqlAuthGuard) @Query(() => [D.DrillModel]) drills(
    @CurrentUser() user: AuthUser,
    @Args(
      "skillId",
      { type: () => ID, nullable: true },
      new ParseUUIDPipe({ optional: true }),
    )
    skillId?: string,
    @Args(
      "after",
      { type: () => ID, nullable: true },
      new ParseUUIDPipe({ optional: true }),
    )
    after?: string,
    @Args("limit", { type: () => Int, defaultValue: 30 }) limit?: number,
  ) {
    return this.library.drills(user?.id, skillId, after, limit);
  }
  @UseGuards(OptionalGqlAuthGuard) @Query(() => D.DrillModel) drill(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library.drill(id, user?.id);
  }
  @UseGuards(OptionalGqlAuthGuard) @Query(() => [D.DrillModel]) drillsForSkill(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library.drills(user?.id, id);
  }
  @UseGuards(OptionalGqlAuthGuard) @Query(() => [D.DrillStepModel]) drillSteps(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library.drill(id, user?.id).then((d) => d.steps);
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [D.DrillSkillModel])
  drillSkills(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library.drill(id, user?.id).then((d) => d.skills);
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [D.DrillReferenceVideoModel])
  referenceVideosForDrill(
    @CurrentUser() user: AuthUser,
    @Args("drillId", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    drillId: string,
    @Args(
      "variantId",
      { type: () => ID, nullable: true },
      new ParseUUIDPipe({ optional: true }),
    )
    variantId?: string,
  ) {
    return this.videos.references(drillId, variantId, user?.id);
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => D.TrainingPlayback)
  referenceVideoPlayback(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.playback(user?.id, id, true);
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => D.TrainingJSON)
  drillTrainingContext(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.context.getDrillTrainingContext(id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.SkillTreeNodeModel)
  createSkillTreeNode(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.CreateSkillTreeNodeInput,
  ) {
    return this.library.createNode(user.id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.SkillTreeNodeModel)
  updateSkillTreeNode(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("input") input: D.UpdateSkillTreeNodeInput,
  ) {
    return this.library.updateNode(user.id, id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.SkillTreeNodeModel)
  archiveSkillTreeNode(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library.updateNode(user.id, id, { status: "ARCHIVED" });
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => [D.SkillPrerequisiteModel])
  setSkillPrerequisites(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("prerequisites", { type: () => [D.PrerequisiteInput] })
    prerequisites: D.PrerequisiteInput[],
  ) {
    return this.library.setPrerequisites(user.id, id, prerequisites);
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => D.DrillModel) createDrill(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.CreateDrillInput,
  ) {
    return this.library.createDrill(user.id, input);
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => D.DrillModel) updateDrill(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("input") input: D.UpdateDrillInput,
  ) {
    return this.library.updateDrill(user.id, id, input);
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => D.DrillModel) archiveDrill(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.library.updateDrill(user.id, id, { status: "ARCHIVED" });
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => [D.DrillStepModel]) setDrillSteps(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("steps", { type: () => [D.TrainingStepInput] })
    steps: D.TrainingStepInput[],
  ) {
    return this.library.setSteps(user.id, id, steps);
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => [D.DrillSkillModel]) setDrillSkills(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("skills", { type: () => [D.TrainingSkillLinkInput] })
    skills: D.TrainingSkillLinkInput[],
  ) {
    return this.library.setSkills(user.id, id, skills);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.CoachingSituationModel)
  createCoachingSituation(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.CreateCoachingSituationInput,
  ) {
    return this.library.situation(user.id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.CoachingSituationModel)
  updateCoachingSituation(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("input") input: D.UpdateCoachingSituationInput,
  ) {
    return this.library.situation(user.id, input, id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillRecommendationRuleModel)
  createDrillRecommendationRule(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.CreateDrillRecommendationRuleInput,
  ) {
    return this.recommendations.saveRule(user.id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillRecommendationRuleModel)
  updateDrillRecommendationRule(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("input") input: D.UpdateDrillRecommendationRuleInput,
  ) {
    return this.recommendations.saveRule(user.id, input, id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  deleteDrillRecommendationRule(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.recommendations.deleteRule(user.id, id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillTechniqueVariantModel)
  createTechniqueVariant(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.CreateDrillTechniqueVariantInput,
  ) {
    return this.library.variant(user.id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillTechniqueVariantModel)
  updateTechniqueVariant(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("input") input: D.UpdateDrillTechniqueVariantInput,
  ) {
    return this.library.variant(user.id, input, id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.TechniqueCheckpointModel)
  createTechniqueCheckpoint(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.CreateTechniqueCheckpointInput,
  ) {
    return this.library.checkpoint(user.id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.TechniqueCheckpointModel)
  updateTechniqueCheckpoint(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("input") input: D.UpdateTechniqueCheckpointInput,
  ) {
    return this.library.checkpoint(user.id, input, id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.TrainingUpload)
  createReferenceVideoUpload(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.ReferenceVideoUploadInput,
  ) {
    return this.videos.requestReference(user.id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillReferenceVideoModel)
  finalizeReferenceVideoUpload(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.finalize(user.id, id, true);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillReferenceVideoModel)
  updateReferenceVideo(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args("input") input: D.UpdateReferenceVideoInput,
  ) {
    return this.videos.updateReference(user.id, id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillReferenceVideoModel)
  archiveReferenceVideo(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.updateReference(user.id, id, { status: "ARCHIVED" });
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.TrainingUpload)
  requestDrillVideoUpload(
    @CurrentUser() user: AuthUser,
    @Args("input") input: D.TrainingVideoUploadInput,
  ) {
    return this.videos.requestUpload(user.id, input);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.DrillVideoSubmissionModel)
  finalizeDrillVideoUpload(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.finalize(user.id, id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.VideoAnalysisModel)
  requestDrillVideoAnalysis(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
    @Args(
      "requestId",
      { type: () => ID },
      new ParseUUIDPipe({ optional: true }),
    )
    requestId: string,
  ) {
    return this.videos.requestAnalysis(user.id, id, requestId);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  deleteMyDrillVideoSubmission(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.deleteSubmission(user.id, id);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.TrainingJSON)
  updateMyTrainingProfile(
    @CurrentUser() user: AuthUser,
    @Args("data", { type: () => D.TrainingJSON }) data: unknown,
  ) {
    return this.recommendations
      .updateProfile(user.id, data)
      .then((p) => p.data);
  }
  @UseGuards(GqlAuthGuard)
  @Mutation(() => D.TrainingJSON)
  updateMySkillProgress(
    @CurrentUser() user: AuthUser,
    @Args("skillId", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    skillId: string,
    @Args("state") state: string,
  ) {
    return this.recommendations
      .progress(user.id, skillId, state)
      .then((p) => ({ skillTreeNodeId: p.skillTreeNodeId, state: p.state }));
  }
  @UseGuards(GqlAuthGuard) @Mutation(() => Boolean) recordDrillCompletion(
    @CurrentUser() user: AuthUser,
    @Args("drillId", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    drillId: string,
  ) {
    return this.recommendations
      .completeDrill(user.id, drillId)
      .then(() => true);
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => [D.TrainingRecommendation])
  evaluateDrillRecommendations(
    @CurrentUser() user: AuthUser,
    @Args(
      "skillId",
      { type: () => ID, nullable: true },
      new ParseUUIDPipe({ optional: true }),
    )
    skillId?: string,
  ) {
    return this.recommendations.getRecommendedDrillsForUser(
      user.id,
      user.id,
      skillId,
    );
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => [D.DrillVideoSubmissionModel])
  myDrillVideoSubmissions(
    @CurrentUser() user: AuthUser,
    @Args(
      "after",
      { type: () => ID, nullable: true },
      new ParseUUIDPipe({ optional: true }),
    )
    after?: string,
    @Args("limit", { type: () => Int, defaultValue: 20 }) limit?: number,
  ) {
    return this.videos.submissions(user.id, after, limit);
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => D.DrillVideoSubmissionModel)
  drillVideoSubmission(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.submission(user.id, id).then(publicMedia);
  }
  @UseGuards(GqlAuthGuard) @Query(() => D.VideoAnalysisModel) videoAnalysis(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.analysis(user.id, id);
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => D.TrainingPlayback)
  myDrillVideoPlayback(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.playback(user.id, id);
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => [D.VideoAnalysisReferenceModel])
  videoAnalysisReferences(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.videos.analysis(user.id, id).then((a) => a.references);
  }
  @UseGuards(GqlAuthGuard) @Query(() => D.TrainingJSON) mySkillLearningPath(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe({ optional: true }))
    id: string,
  ) {
    return this.context.getSkillLearningPath(user.id, user.id, id);
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => [D.VideoProcessingJobModel])
  async drillVideoJobs(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe()) id: string,
  ) {
    await this.videos.submission(user.id, id);
    return this.videos.db.videoProcessingJob.findMany({
      where: { submissionId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => [D.VideoProcessingJobModel])
  async referenceVideoJobs(
    @CurrentUser() user: AuthUser,
    @Args("id", { type: () => ID }, new ParseUUIDPipe()) id: string,
  ) {
    await this.library.access.editor(user.id);
    return this.videos.db.videoProcessingJob.findMany({
      where: { referenceVideoId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [D.DrillTechniqueVariantModel])
  async techniqueVariants(
    @CurrentUser() user: AuthUser,
    @Args("drillId", { type: () => ID }, new ParseUUIDPipe()) drillId: string,
  ) {
    await this.library.drill(drillId, user?.id);
    return this.library.db.drillTechniqueVariant.findMany({
      where: {
        drillId,
        ...(!this.library.access.isEditor(user?.id)
          ? { status: "PUBLISHED" as const }
          : {}),
      },
      orderBy: { id: "asc" },
      take: 100,
    });
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [D.TechniqueCheckpointModel])
  async techniqueCheckpoints(
    @CurrentUser() user: AuthUser,
    @Args("drillId", { type: () => ID }, new ParseUUIDPipe()) drillId: string,
  ) {
    await this.library.drill(drillId, user?.id);
    return this.library.db.techniqueCheckpoint.findMany({
      where: {
        drillId,
        ...(!this.library.access.isEditor(user?.id)
          ? { status: "PUBLISHED" as const }
          : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 100,
    });
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [D.CoachingSituationModel])
  coachingSituations(@CurrentUser() user: AuthUser) {
    return this.library.db.coachingSituation.findMany({
      where: !this.library.access.isEditor(user?.id)
        ? { status: "PUBLISHED" }
        : {},
      orderBy: { id: "asc" },
      take: 100,
    });
  }
  @UseGuards(OptionalGqlAuthGuard)
  @Query(() => [D.DrillRecommendationRuleModel])
  async drillRecommendationRules(
    @CurrentUser() user: AuthUser,
    @Args("drillId", { type: () => ID }, new ParseUUIDPipe()) drillId: string,
  ) {
    await this.library.drill(drillId, user?.id);
    return this.library.db.drillRecommendationRule.findMany({
      where: {
        drillId,
        ...(!this.library.access.isEditor(user?.id)
          ? {
              enabled: true,
              OR: [
                { situationId: null },
                { situation: { status: "PUBLISHED" as const } },
              ],
            }
          : {}),
      },
      orderBy: { id: "asc" },
      take: 100,
    });
  }
  @UseGuards(GqlAuthGuard)
  @Query(() => D.TrainingPlayback)
  analysisReferencePlayback(
    @CurrentUser() user: AuthUser,
    @Args("analysisId", { type: () => ID }, new ParseUUIDPipe())
    analysisId: string,
    @Args("referenceVideoId", { type: () => ID }, new ParseUUIDPipe())
    referenceVideoId: string,
  ) {
    return this.videos.historicalReferencePlayback(
      user.id,
      analysisId,
      referenceVideoId,
    );
  }
}
