import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { TrainingAccess } from "../../src/training/access";
import { TrainingLibraryService } from "../../src/training/library.service";
import { TrainingRecommendations } from "../../src/training/recommendations.service";
import { TrainingVideoService } from "../../src/training/video.service";
import {
  TrainingVideoJobs,
  TrainingReferenceSelection,
} from "../../src/training/jobs.service";
import { TrainingCoachContext } from "../../src/training/context.service";
import { seedTraining } from "../../src/training/seed";
import { sweepTrainingVideos } from "../../src/training/maintenance";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "training catalog and private media PostgreSQL",
  () => {
    let db: PrismaClient,
      access: TrainingAccess,
      lib: TrainingLibraryService,
      rec: TrainingRecommendations,
      videos: TrainingVideoService,
      jobs: TrainingVideoJobs,
      editor: string,
      owner: string,
      other: string,
      categories: string[],
      node: string,
      drill: string;
    const objects = new Map<string, { bytes: number; mimeType: string }>();
    const deleted: string[] = [];
    const storage = {
      upload: jest.fn(async (key: string, mimeType: string, bytes: number) => ({
        url: `https://private.example.test/${key}?signed=1`,
        headers: {
          "content-type": mimeType,
          "content-length": String(bytes),
          "if-none-match": "*",
        },
        expiresAt: new Date(Date.now() + 180000),
      })),
      head: jest.fn(async (key: string) => {
        const v = objects.get(key);
        if (!v) throw Error("not uploaded");
        return v;
      }),
      playback: jest.fn(async (key: string) => ({
        url: `https://private.example.test/${key}?read=1`,
        expiresAt: new Date(Date.now() + 120000),
      })),
      delete: jest.fn(async (key: string) => {
        deleted.push(key);
        objects.delete(key);
      }),
    };
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      const sport = await db.sport.upsert({
        where: { slug: "beach-volleyball" },
        create: { slug: "beach-volleyball", name: "Beach Volleyball" },
        update: {},
      });
      categories = [];
      for (const slug of ["attack", "defense", "passing", "setting", "serving"])
        categories.push(
          (
            await db.skill.upsert({
              where: { sportId_slug: { sportId: sport.id, slug } },
              create: { sportId: sport.id, slug, name: slug },
              update: { active: true },
            })
          ).id,
        );
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        await db.user.create({
          data: {
            id,
            username: id,
            email: id + "@example.test",
            passwordHash: "fixture",
            age: 25,
            heightCm: 180,
          },
        });
        ids.push(id);
      }
      [editor, owner, other] = ids;
      process.env.TRAINING_EDITOR_IDS = editor;
      access = new TrainingAccess(db as never);
      lib = new TrainingLibraryService(db as never, access);
      rec = new TrainingRecommendations(db as never, access, lib);
      videos = new TrainingVideoService(
        db as never,
        access,
        lib,
        storage as never,
      );
      jobs = new TrainingVideoJobs(db as never, storage as never);
    });
    afterAll(async () => {
      delete process.env.TRAINING_EDITOR_IDS;
      await db.$disconnect();
    });
    async function createNode(
      categoryId = categories[0],
      status: "PUBLISHED" | "DRAFT" = "PUBLISHED",
    ) {
      return lib.createNode(editor, {
        slug: randomUUID(),
        categoryId,
        name: "Approach",
        description: "Develop controlled movement.",
        learningObjective: "Maintain a balanced approach.",
        whyItMatters: "Repeatable technique supports adaptable play.",
        status,
      });
    }
    beforeEach(async () => {
      node = (await createNode()).id;
      drill = (
        await lib.createDrill(editor, {
          slug: randomUUID(),
          name: "Controlled approach",
          description: "Practice controlled movement.",
          objective: "Repeat a balanced approach.",
          setup: "Use a clear sand area.",
        })
      ).id;
      await lib.setSteps(editor, drill, [
        { instruction: "Clear the landing zone." },
        { instruction: "Rehearse controlled footwork." },
      ]);
      await lib.setSkills(editor, drill, [
        { skillTreeNodeId: node, role: "PRIMARY" },
      ]);
      await lib.updateDrill(editor, drill, { status: "PUBLISHED" });
    });
    const input = () => ({
      drillId: drill,
      mimeType: "video/mp4",
      fileSizeBytes: 128,
      cameraAngle: "SIDE",
    });
    async function upload() {
      const u = await videos.requestUpload(owner, input());
      const row = await db.drillVideoSubmission.findUniqueOrThrow({
        where: { id: u.id },
      });
      objects.set(row.storageKey, { bytes: 128, mimeType: "video/mp4" });
      await videos.finalize(owner, u.id);
      return u;
    }
    async function reference(variantId?: string, replacesReferenceId?: string) {
      const u = await videos.requestReference(editor, {
        ...input(),
        techniqueVariantId: variantId,
        title: "Coach demonstration",
        originalFilename: "practice.mp4",
        replacesReferenceId,
      });
      const row = await db.drillReferenceVideo.findUniqueOrThrow({
        where: { id: u.id },
      });
      objects.set(row.storageKey, { bytes: 128, mimeType: "video/mp4" });
      await videos.finalize(editor, u.id, true);
      return u;
    }
    async function validate(id: string, reference = false) {
      const j = await db.videoProcessingJob.findFirstOrThrow({
        where: reference
          ? { referenceVideoId: id, type: "VALIDATE_VIDEO" }
          : { submissionId: id, type: "VALIDATE_VIDEO" },
      });
      const token = randomUUID();
      await db.videoProcessingJob.update({
        where: { id: j.id },
        data: {
          status: "PROCESSING",
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 60000),
        },
      });
      await jobs.completeValidation(j.id, token, {
        durationMs: 10000,
        width: 1280,
        height: 720,
        frameRate: 30,
        mimeType: "video/mp4",
        bytes: 128,
        cameraAngle: "SIDE",
      });
    }
    it("atomically creates instructions, a primary skill link and a published drill", async () => {
      const made = await lib.createDrillWithContent(editor, {
        drill: {
          slug: randomUUID(),
          name: "Form drill",
          description: "Coach-created drill",
          objective: "Control the platform",
          setup: "Clear sand",
          status: "PUBLISHED",
        },
        steps: [
          { instruction: "Pass and reset" },
          { instruction: "Repeat deliberately" },
        ],
        primarySkillId: node,
      });
      expect(made.status).toBe("PUBLISHED");
      expect(made.steps.map((s) => s.instruction)).toEqual([
        "Pass and reset",
        "Repeat deliberately",
      ]);
      expect(made.skills).toEqual([
        expect.objectContaining({ skillTreeNodeId: node, role: "PRIMARY" }),
      ]);
      expect((await lib.drill(made.id)).id).toBe(made.id);
    });
    it("creates a new published primary skill for an unseeded library and enforces editor access", async () => {
      const input = {
        drill: {
          slug: randomUUID(),
          name: "New skill drill",
          description: "A complete drill",
          objective: "Control",
          setup: "Clear sand",
          status: "PUBLISHED" as const,
        },
        steps: [{ instruction: "Pass to the target" }],
        newPrimarySkill: {
          slug: randomUUID(),
          name: "New passing skill",
          description: "Platform control",
          categoryId: categories[2],
          learningObjective: "Direct the ball",
          whyItMatters: "Control builds useful passes",
          status: "PUBLISHED" as const,
        },
      };
      await expect(lib.createDrillWithContent(other, input)).rejects.toThrow(
        /editor/,
      );
      const made = await lib.createDrillWithContent(editor, input);
      expect(made.skills).toHaveLength(1);
      expect(
        (
          await db.skillTreeNode.findUniqueOrThrow({
            where: { slug: input.newPrimarySkill.slug },
          })
        ).status,
      ).toBe("PUBLISHED");
    });
    it("rolls back partial content and skills when publication or uniqueness fails", async () => {
      const draft = await createNode(categories[0], "DRAFT"),
        slug = randomUUID();
      await expect(
        lib.createDrillWithContent(editor, {
          drill: {
            slug,
            name: "Invalid publish",
            description: "Description",
            objective: "Objective",
            setup: "Setup",
            status: "PUBLISHED",
          },
          steps: [{ instruction: "One step" }],
          primarySkillId: draft.id,
        }),
      ).rejects.toThrow(/published linked skills/);
      expect(await db.drill.findUnique({ where: { slug } })).toBeNull();
      const existing = await db.drill.findUniqueOrThrow({
          where: { id: drill },
        }),
        skillSlug = randomUUID();
      await expect(
        lib.createDrillWithContent(editor, {
          drill: {
            slug: existing.slug,
            name: "Duplicate",
            description: "Description",
            objective: "Objective",
            setup: "Setup",
            status: "PUBLISHED",
          },
          steps: [{ instruction: "One step" }],
          newPrimarySkill: {
            slug: skillSlug,
            categoryId: categories[0],
            name: "Rollback skill",
            description: "Description",
            learningObjective: "Objective",
            whyItMatters: "Useful",
            status: "PUBLISHED",
          },
        }),
      ).rejects.toThrow();
      expect(
        await db.skillTreeNode.findUnique({ where: { slug: skillSlug } }),
      ).toBeNull();
    });
    it("keeps drafts private and rejects duplicate node slugs", async () => {
      const draft = await createNode(categories[0], "DRAFT");
      await expect(lib.node(draft.id)).rejects.toThrow();
      expect((await lib.skillTree()).nodes.some((n) => n.id === draft.id)).toBe(
        false,
      );
      expect((await lib.node(draft.id, editor)).id).toBe(draft.id);
      await expect(
        lib.updateNode(editor, draft.id, { slug: randomUUID() }),
      ).rejects.toThrow(/stable/);
      await expect(
        lib.createNode(editor, {
          slug: draft.slug,
          categoryId: categories[0],
          name: "Duplicate",
          description: "Duplicate slug.",
          learningObjective: "Test uniqueness.",
          whyItMatters: "Identifiers stay stable.",
        }),
      ).rejects.toThrow(/already exists/);
    });
    it("supports multiple and cross-category optional prerequisites, rejecting cycles atomically", async () => {
      const a = await createNode(categories[1]),
        b = await createNode(categories[2]);
      await lib.setPrerequisites(editor, node, [
        { prerequisiteId: a.id, required: true },
        { prerequisiteId: b.id, required: false },
      ]);
      expect((await lib.prerequisites(node)).prerequisites).toHaveLength(2);
      expect((await lib.prerequisites(a.id)).dependents).toHaveLength(1);
      await expect(
        lib.setPrerequisites(editor, a.id, [
          { prerequisiteId: node, required: false },
        ]),
      ).rejects.toThrow();
      expect((await lib.prerequisites(a.id)).prerequisites).toHaveLength(0);
      await expect(
        lib.setPrerequisites(editor, node, [
          { prerequisiteId: node, required: true },
        ]),
      ).rejects.toThrow();
    });
    it("serializes concurrent opposite prerequisite edges", async () => {
      const a = await createNode(),
        b = await createNode();
      const results = await Promise.allSettled([
        lib.setPrerequisites(editor, a.id, [
          { prerequisiteId: b.id, required: true },
        ]),
        lib.setPrerequisites(editor, b.id, [
          { prerequisiteId: a.id, required: true },
        ]),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    it("preserves ordered steps and independent drill editing", async () => {
      await lib.setSteps(editor, drill, [
        { instruction: "First new instruction." },
        { instruction: "Second new instruction." },
      ]);
      expect((await lib.drill(drill)).steps.map((s) => s.sortOrder)).toEqual([
        0, 1,
      ]);
      await lib.updateDrill(editor, drill, { name: "Updated official drill" });
      expect((await lib.drill(drill)).name).toBe("Updated official drill");
    });
    it("enforces one primary skill in published drills and allows secondary skills", async () => {
      const s = await createNode(categories[2]);
      await lib.setSkills(editor, drill, [
        { skillTreeNodeId: node, role: "PRIMARY" },
        { skillTreeNodeId: s.id, role: "SECONDARY" },
      ]);
      expect((await lib.drill(drill)).skills).toHaveLength(2);
      await expect(
        lib.setSkills(editor, drill, [
          { skillTreeNodeId: s.id, role: "SECONDARY" },
        ]),
      ).rejects.toThrow();
      await expect(lib.setSteps(editor, drill, [])).rejects.toThrow();
      expect(
        (await lib.drill(drill)).skills.filter((s) => s.role === "PRIMARY"),
      ).toHaveLength(1);
    });
    it("enforces publication invariants for direct database writes too", async () => {
      await expect(
        db.$transaction((tx) =>
          tx.drillSkill.deleteMany({ where: { drillId: drill } }),
        ),
      ).rejects.toThrow();
      expect((await lib.drill(drill)).skills).toHaveLength(1);
    });
    it("excludes archived drills from public reads and recommendations", async () => {
      await lib.updateDrill(editor, drill, { status: "ARCHIVED" });
      await expect(lib.drill(drill)).rejects.toThrow();
      expect(
        (await rec.getRecommendedDrillsForUser(owner, owner, node)).find(
          (r) => r.drill.id === drill,
        ),
      ).toBeUndefined();
    });
    it("requires editor authorization in services", async () => {
      await expect(
        lib.updateDrill(owner, drill, { name: "Unauthorized" }),
      ).rejects.toThrow();
      await expect(
        videos.requestReference(owner, {
          ...input(),
          title: "Unapproved",
          originalFilename: "x.mp4",
        }),
      ).rejects.toThrow();
      await expect(
        rec.saveRule(owner, {
          drillId: drill,
          name: "Unauthorized",
          rationale: "Invalid authority",
          effect: "BOOST",
          conditions: {
            version: 1,
            root: { fact: "availablePartners", op: "eq", value: 0 },
          },
        }),
      ).rejects.toThrow();
    });
    it("returns UNKNOWN, multiple matches, boosts and exclusions without treating height as ability", async () => {
      await rec.saveRule(editor, {
        drillId: drill,
        name: "Solo suitability",
        rationale: "Explicit partner availability.",
        effect: "BOOST",
        priority: 8,
        conditions: {
          version: 1,
          root: { fact: "availablePartners", op: "eq", value: 0 },
        },
      });
      await rec.saveRule(editor, {
        drillId: drill,
        name: "Reach evidence",
        rationale: "Needs an actual reported reach.",
        effect: "BOOST",
        priority: 4,
        conditions: {
          version: 1,
          root: { fact: "attackReachCm", op: "lt", value: 250 },
        },
      });
      let item = (await rec.getRecommendedDrillsForUser(owner, owner, node))[0];
      expect(item.score).toBe(0);
      expect(item.evaluation.every((r: any) => r.state === "UNKNOWN")).toBe(
        true,
      );
      await rec.updateProfile(owner, { availablePartners: 0, equipment: [] });
      await rec.saveRule(editor, {
        drillId: drill,
        name: "Required equipment",
        rationale: "The player reports no ball available.",
        effect: "EXCLUDE",
        conditions: {
          version: 1,
          root: { fact: "equipment", op: "contains", value: "net" },
        },
      });
      item = (await rec.getRecommendedDrillsForUser(owner, owner, node))[0];
      expect(item.score).toBe(8);
      expect(item.excluded).toBe(false);
      await rec.updateProfile(owner, {
        availablePartners: 0,
        equipment: ["net"],
      });
      item = (await rec.getRecommendedDrillsForUser(owner, owner, node))[0];
      expect(item.excluded).toBe(true);
      await expect(
        rec.getRecommendedDrillsForUser(other, owner, node),
      ).rejects.toThrow();
    });
    it("preserves trust groups from authorized SQL profiles without changing internal ratings", async () => {
      const sport = await db.sport.findUniqueOrThrow({
        where: { slug: "beach-volleyball" },
      });
      await db.playerFeedbackAnalysisProfile.upsert({
        where: { userId_sportId: { userId: owner, sportId: sport.id } },
        create: { userId: owner, sportId: sport.id },
        update: {},
      });
      await db.playerFeedbackAnalysisProfile.update({
        where: { userId_sportId: { userId: owner, sportId: sport.id } },
        data: {
          stale: false,
          algorithmVersion: 3,
          builtRevision: 1,
          revision: 1,
          expiresAt: new Date(Date.now() + 60000),
          data: {
            state: "COMPLETE",
            themes: [
              {
                themeId: "platform_control",
                trustBreakdown: [
                  {
                    classification: "UNVERIFIED_GUEST",
                    negativeFeedbackCount: 4,
                  },
                ],
              },
            ],
          },
        },
      });
      await rec.saveRule(editor, {
        drillId: drill,
        name: "Guest context",
        rationale: "Context is explicitly unverified.",
        effect: "BOOST",
        priority: 10,
        conditions: {
          version: 1,
          root: {
            fact: "feedbackThemeCount",
            key: "platform_control",
            trust: "UNVERIFIED_GUEST",
            op: "gte",
            value: 3,
          },
        },
      });
      const before = await db.playerInternalRatingEvent.count({
        where: { userId: owner },
      });
      const out = (
        await rec.getRecommendedDrillsForUser(owner, owner, node)
      )[0];
      expect(out.score).toBe(3.5);
      expect(out.evaluation[0].evidence[0].trust).toBe("UNVERIFIED_GUEST");
      expect(
        await db.playerInternalRatingEvent.count({ where: { userId: owner } }),
      ).toBe(before);
    });
    it("creates server-generated private keys, verifies HEAD, and leaves content validation pending", async () => {
      const u = await upload();
      expect(u.url).toContain("/training/players/" + owner + "/");
      expect((await videos.submission(owner, u.id)).status).toBe(
        "VALIDATION_PENDING",
      );
      expect(
        await db.videoProcessingJob.count({
          where: {
            submissionId: u.id,
            type: "VALIDATE_VIDEO",
            status: "UNAVAILABLE",
          },
        }),
      ).toBe(1);
      await videos.finalize(owner, u.id);
      expect(
        await db.videoProcessingJob.count({
          where: { submissionId: u.id, type: "VALIDATE_VIDEO" },
        }),
      ).toBe(1);
      await expect(videos.playback(owner, u.id)).rejects.toThrow();
      await validate(u.id);
      expect((await videos.playback(owner, u.id)).url).toContain("?read=1");
    });
    it("rejects object size/type mismatches and unsupported formats", async () => {
      await expect(
        videos.requestUpload(owner, { ...input(), mimeType: "text/html" }),
      ).rejects.toThrow();
      const u = await videos.requestUpload(owner, input());
      const row = await videos.submission(owner, u.id);
      objects.set(row.storageKey, { bytes: 999, mimeType: "video/mp4" });
      await expect(videos.finalize(owner, u.id)).rejects.toThrow(/metadata/);
      expect((await videos.submission(owner, u.id)).status).toBe("FAILED");
      await videos.deleteSubmission(owner, u.id);
    });
    it("enforces private ownership on reads, finalization, analysis, playback and deletion", async () => {
      const u = await upload();
      for (const action of [
        () => videos.submission(other, u.id),
        () => videos.finalize(other, u.id),
        () => videos.playback(other, u.id),
        () => videos.requestAnalysis(other, u.id, randomUUID()),
        () => videos.deleteSubmission(other, u.id),
      ])
        await expect(action()).rejects.toThrow();
      expect(await videos.submissions(other)).toHaveLength(0);
    });
    it("returns explicit analysis unavailability without fabricated results or duplicate jobs", async () => {
      const u = await upload(),
        requestId = randomUUID();
      const [a, b] = await Promise.all([
        videos.requestAnalysis(owner, u.id, requestId),
        videos.requestAnalysis(owner, u.id, requestId),
      ]);
      expect(a.id).toBe(b.id);
      expect(a.status).toBe("ANALYSIS_UNAVAILABLE");
      expect(a.result).toBeNull();
      expect(a.confidence).toBeNull();
      expect(
        await db.videoProcessingJob.count({ where: { analysisId: a.id } }),
      ).toBe(1);
      expect((await videos.requestAnalysis(owner, u.id, randomUUID())).id).toBe(
        a.id,
      );
      await expect(videos.analysis(other, a.id)).rejects.toThrow();
    });
    it("supports several variants/references and preserves exact historical reference versions on replacement", async () => {
      const v = await lib.variant(editor, {
        drillId: drill,
        slug: "right",
        name: "Right-handed",
        description: "Accepted technique",
        isDefault: true,
        status: "PUBLISHED",
      });
      const a = await reference(v.id),
        b = await reference(v.id);
      await validate(a.id, true);
      await validate(b.id, true);
      // Permission/provenance fixture only. Real MediaPipe extraction is covered by video-worker/smoke.ts.
      for (const id of [a.id, b.id])
        await db.drillReferenceVideo.update({
          where: { id },
          data: {
            poseArtifactKey: `fixture/${id}`,
            qualityAcknowledgedAt: new Date(),
            checkpointIds: [randomUUID()],
          },
        });
      await videos.updateReference(editor, a.id, {
        status: "PUBLISHED",
        isPrimary: true,
      });
      await videos.updateReference(editor, b.id, { status: "PUBLISHED" });
      expect(await videos.references(drill, v.id)).toHaveLength(2);
      await expect(
        lib.variant(editor, { status: "DRAFT" }, v.id),
      ).rejects.toThrow(/Unpublish/);
      expect((await videos.references(drill, v.id))[0]).not.toHaveProperty(
        "storageKey",
      );
      await expect(
        videos.updateReference(editor, b.id, { isPrimary: true }),
      ).rejects.toThrow();
      const selected = await new TrainingReferenceSelection(db as never).select(
        { drillId: drill, variantId: v.id, cameraAngle: "SIDE" },
      );
      expect(selected).toHaveLength(2);
      const u = await videos.requestUpload(owner, {
        ...input(),
        techniqueVariantId: v.id,
        referenceVideoId: a.id,
      });
      const row = await videos.submission(owner, u.id);
      objects.set(row.storageKey, { bytes: 128, mimeType: "video/mp4" });
      await videos.finalize(owner, u.id);
      const analysis = await videos.requestAnalysis(owner, u.id, randomUUID());
      await jobs.attachReferences(analysis.id, selected);
      await videos.updateReference(editor, a.id, { status: "ARCHIVED" });
      expect(
        (await videos.historicalReferencePlayback(owner, analysis.id, a.id))
          .url,
      ).toContain("?read=1");
      await expect(
        videos.historicalReferencePlayback(other, analysis.id, a.id),
      ).rejects.toThrow();
      const replacement = await reference(v.id, a.id);
      expect(
        (
          await db.drillReferenceVideo.findUniqueOrThrow({
            where: { id: replacement.id },
          })
        ).referenceVersion,
      ).toBe(2);
      expect(
        (await videos.analysis(owner, analysis.id)).references.find(
          (r) => r.referenceVideoId === a.id,
        )?.referenceVersion,
      ).toBe(1);
      await expect(
        db.drillReferenceVideo.update({
          where: { id: a.id },
          data: { storageKey: "changed" },
        }),
      ).rejects.toThrow();
      expect(
        await new TrainingReferenceSelection(db as never).select({
          drillId: drill,
          variantId: v.id,
          cameraAngle: "UNKNOWN",
        }),
      ).toHaveLength(0);
    });
    it("rejects cross-drill variants and publishing unvalidated references", async () => {
      const u = await reference();
      await expect(
        videos.updateReference(editor, u.id, { status: "PUBLISHED" }),
      ).rejects.toThrow();
      const second = (
        await lib.createDrill(editor, {
          slug: randomUUID(),
          name: "Other",
          description: "Another drill",
          objective: "Control",
          setup: "Clear space",
        })
      ).id;
      const variant = await lib.variant(editor, {
        drillId: second,
        slug: "other",
        name: "Other",
        description: "Different drill",
        status: "PUBLISHED",
      });
      await expect(
        videos.requestUpload(owner, {
          ...input(),
          techniqueVariantId: variant.id,
        }),
      ).rejects.toThrow();
    });
    it("deletes private results immediately and cleans originals/artifacts after upload authorization expires", async () => {
      const u = await upload();
      const a = await videos.requestAnalysis(owner, u.id, randomUUID());
      const artifact = await jobs.allocateArtifactKey(a.id);
      objects.set(artifact, { bytes: 10, mimeType: "application/json" });
      const poseKey = `training/players/${owner}/${u.id}/poses/${randomUUID()}.json`;
      const pose = await db.videoPoseArtifact.create({
        data: {
          submissionId: u.id,
          fingerprint: randomUUID(),
          storageKey: poseKey,
          sourceHash: "test-fixture-hash",
          modelVersion: "fixture-model",
          extractionVersion: "fixture-extraction",
          featureVersion: "fixture-features",
          samplingFps: 10,
          quality: { validRatio: 1 },
          metadata: { durationMs: 10000 },
          status: "READY",
        },
      });
      objects.set(poseKey, { bytes: 10, mimeType: "application/json" });
      await videos.deleteSubmission(owner, u.id);
      await videos.deleteSubmission(owner, u.id);
      await expect(videos.submission(owner, u.id)).rejects.toThrow();
      expect(
        (await db.videoAnalysis.findUniqueOrThrow({ where: { id: a.id } }))
          .result,
      ).toBeNull();
      await db.videoProcessingJob.updateMany({
        where: { submissionId: u.id, type: "CLEANUP_MEDIA" },
        data: { runAfter: new Date(0) },
      });
      await jobs.cleanupBatch(100);
      expect(deleted).toContain(artifact);
      expect(deleted).toContain(poseKey);
      expect(
        (
          await db.videoPoseArtifact.findUniqueOrThrow({
            where: { id: pose.id },
          })
        ).status,
      ).toBe("DELETED");
      expect(
        await db.videoProcessingJob.count({
          where: {
            submissionId: u.id,
            type: "CLEANUP_MEDIA",
            status: "COMPLETED",
          },
        }),
      ).toBe(1);
    });
    it("sweeps expired uploads and enforces job leases", async () => {
      const u = await videos.requestUpload(owner, input());
      await db.drillVideoSubmission.update({
        where: { id: u.id },
        data: { uploadExpiresAt: new Date(Date.now() - 120000) },
      });
      await sweepTrainingVideos(db as never, videos, jobs, 100);
      expect(
        (
          await db.drillVideoSubmission.findUniqueOrThrow({
            where: { id: u.id },
          })
        ).status,
      ).toBe("DELETED");
      const x = await upload();
      const job = await db.videoProcessingJob.findFirstOrThrow({
        where: { submissionId: x.id, type: "VALIDATE_VIDEO" },
      });
      await expect(
        jobs.completeValidation(job.id, randomUUID(), {
          durationMs: 1,
          width: 100,
          height: 100,
          frameRate: 30,
          bytes: 128,
          mimeType: "video/mp4",
          cameraAngle: "SIDE",
        }),
      ).rejects.toThrow(/lease/);
    });
    it("provides scoped training context and seeds examples without overwriting real content", async () => {
      const ctx = new TrainingCoachContext(db as never, lib, videos, rec);
      await rec.progress(owner, node, "PRACTICING");
      expect(
        (await ctx.getSkillLearningPath(owner, owner, node)).progress[0].state,
      ).toBe("PRACTICING");
      await expect(
        ctx.getSkillLearningPath(other, owner, node),
      ).rejects.toThrow();
      const first = await seedTraining(db as never, editor);
      const count = await db.drill.count();
      expect(await seedTraining(db as never, editor)).toEqual(first);
      expect(await db.drill.count()).toBe(count);
      expect(
        await db.drillReferenceVideo.count({
          where: { drill: { slug: "three-step-approach" } },
        }),
      ).toBe(0);
    });
    it("finalizes concurrent retries once without duplicate validation jobs", async () => {
      const u = await videos.requestUpload(owner, input());
      const row = await videos.submission(owner, u.id);
      objects.set(row.storageKey, { bytes: 128, mimeType: "video/mp4" });
      const results = await Promise.all([
        videos.finalize(owner, u.id),
        videos.finalize(owner, u.id),
      ]);
      expect(results.map((r) => r.status)).toEqual([
        "VALIDATION_PENDING",
        "VALIDATION_PENDING",
      ]);
      expect(
        await db.videoProcessingJob.count({
          where: { submissionId: u.id, type: "VALIDATE_VIDEO" },
        }),
      ).toBe(1);
    });
    it("blocks external analysis and exposes retry exhaustion without invoking a provider", async () => {
      const u = await upload();
      const process = jest.fn();
      const external = new TrainingVideoService(
        db as never,
        access,
        lib,
        storage as never,
        {
          orchestrator: {
            processingLocation: "EXTERNAL",
            providerName: "unconfigured-external",
            analysisVersion: "external-fixture",
            process,
          },
        },
      );
      expect(
        (await external.requestAnalysis(owner, u.id, randomUUID())).errorCode,
      ).toBe("EXTERNAL_VIDEO_PROCESSING_NOT_AUTHORIZED");
      expect(process).not.toHaveBeenCalled();
      const job = await db.videoProcessingJob.findFirstOrThrow({
        where: { submissionId: u.id, type: "COMPARE_TECHNIQUE" },
      });
      await db.videoProcessingJob.update({
        where: { id: job.id },
        data: { status: "PENDING", attempts: 5 },
      });
      await jobs.claim("COMPARE_TECHNIQUE");
      expect(
        (
          await db.videoProcessingJob.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).status,
      ).toBe("FAILED");
      expect(
        (
          await db.videoAnalysis.findUniqueOrThrow({
            where: { id: job.analysisId! },
          })
        ).status,
      ).toBe("FAILED");
    });
    it("enforces GraphQL guards and typed upload responses without exposing storage keys", async () => {
      const savedDb = process.env.DATABASE_URL,
        savedSecret = process.env.JWT_SECRET,
        savedEnv = process.env.NODE_ENV;
      process.env.DATABASE_URL = url;
      process.env.JWT_SECRET = "training-graphql-fixture-secret-long-enough";
      process.env.NODE_ENV = "test";
      const { Test } = await import("@nestjs/testing");
      const { AppModule } = await import("../../src/app.module");
      const { PrismaService } = await import("../../src/prisma/prisma.service");
      const { S3VideoStorage } = await import("../../src/training/storage");
      const { GraphQLSchemaHost } = await import("@nestjs/graphql");
      const { graphql } = await import("graphql");
      const { JwtService } = await import("@nestjs/jwt");
      const { ValidationPipe } = await import("@nestjs/common");
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(db)
        .overrideProvider(S3VideoStorage)
        .useValue(storage)
        .compile();
      const app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      try {
        await app.init();
        const schema = app.get(GraphQLSchemaHost).schema,
          jwt = app.get(JwtService);
        const run = async (
          source: string,
          actor?: string,
          variableValues?: Record<string, unknown>,
        ) =>
          graphql({
            schema,
            source,
            variableValues,
            contextValue: {
              req: {
                ip: "127.0.0.1",
                headers: actor
                  ? {
                      authorization:
                        "Bearer " +
                        (await jwt.signAsync({
                          id: actor,
                          sub: actor,
                          username: "fixture",
                        })),
                    }
                  : {},
              },
              res: {},
            },
          });
        expect(
          (
            await run("query($id:ID!){drill(id:$id){id name}}", undefined, {
              id: drill,
            })
          ).errors,
        ).toBeUndefined();
        expect(
          (await run("query{canManageTraining}", owner)).data
            ?.canManageTraining,
        ).toBe(false);
        expect(
          (await run("query{canManageTraining}", editor)).data
            ?.canManageTraining,
        ).toBe(true);
        const contentMutation =
          "mutation($input:CreateDrillWithContentInput!){createDrillWithContent(input:$input){id status}}";
        const formSkill = (await createNode()).id;
        const content = {
          drill: {
            slug: randomUUID(),
            name: "Published form drill",
            description: "Typed complete content",
            objective: "Useful practice",
            setup: "Clear space",
            status: "PUBLISHED",
          },
          steps: [{ instruction: "Pass and reset" }],
          primarySkillId: formSkill,
        };
        expect(
          (await run(contentMutation, undefined, { input: content })).errors,
        ).toBeDefined();
        expect(
          (await run(contentMutation, owner, { input: content })).errors,
        ).toBeDefined();
        const published = await run(contentMutation, editor, {
          input: content,
        });
        expect(published.errors).toBeUndefined();
        expect((published.data as any).createDrillWithContent).toMatchObject({
          status: "PUBLISHED",
        });
        const mutation =
          "mutation($input:CreateDrillInput!){createDrill(input:$input){id name status}}";
        const input = {
          slug: randomUUID(),
          name: "GraphQL draft",
          description: "Typed content",
          objective: "Useful practice",
          setup: "Clear space",
        };
        expect(
          (await run(mutation, undefined, { input })).errors,
        ).toBeDefined();
        expect((await run(mutation, owner, { input })).errors).toBeDefined();
        const created = await run(mutation, editor, { input });
        expect(created.errors).toBeUndefined();
        const id = (created.data as any).createDrill.id;
        expect(
          (await run("query($id:ID!){drill(id:$id){id}}", undefined, { id }))
            .errors,
        ).toBeDefined();
        await rec.saveRule(editor, {
          drillId: drill,
          name: "GraphQL evidence",
          rationale: "Structured output supports optional evidence metadata.",
          effect: "BOOST",
          conditions: {
            version: 1,
            root: { fact: "availablePartners", op: "gte", value: 1 },
          },
        });
        const evaluated = await run(
          "query($id:ID!){evaluateDrillRecommendations(skillId:$id){drill{id} score excluded evaluation}}",
          owner,
          { id: node },
        );
        expect(evaluated.errors).toBeUndefined();
        expect(
          (evaluated.data as any).evaluateDrillRecommendations,
        ).toHaveLength(1);
        const upload = await run(
          "mutation($input:TrainingVideoUploadInput!){requestDrillVideoUpload(input:$input){id url headers}}",
          owner,
          { input: inputVideo() },
        );
        expect(upload.errors).toBeUndefined();
        expect(
          (upload.data as any).requestDrillVideoUpload.headers["if-none-match"],
        ).toBe("*");
        expect(
          (
            await run(
              "query($id:ID!){drillVideoSubmission(id:$id){id storageKey}}",
              owner,
              { id: (upload.data as any).requestDrillVideoUpload.id },
            )
          ).errors,
        ).toBeDefined();
      } finally {
        await app.close();
        process.env.DATABASE_URL = savedDb;
        process.env.JWT_SECRET = savedSecret;
        process.env.NODE_ENV = savedEnv;
      }
      function inputVideo() {
        return {
          drillId: drill,
          mimeType: "video/mp4",
          fileSizeBytes: 128,
          cameraAngle: "SIDE",
        };
      }
    });
  },
);
