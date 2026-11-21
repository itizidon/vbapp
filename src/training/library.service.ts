import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TrainingContentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TrainingAccess } from "./access";
import * as D from "./dto";
import {
  checkedInput,
  contentJson,
  measurementSchema,
  parse,
} from "./validation";
const detail = {
  steps: { orderBy: { sortOrder: "asc" as const } },
  skills: true,
  variants: { where: { status: TrainingContentStatus.PUBLISHED } },
};
export function jsonData(input: object): any {
  const out: any = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (
      [
        "technique",
        "successCriteria",
        "metricConfig",
        "measurementConfig",
        "metadata",
        "conditions",
      ].includes(k) ||
      (k === "commonMistakes" && !Array.isArray(v))
    ) {
      out[k] = v === null ? Prisma.DbNull : contentJson(v);
    } else if (
      v === null &&
      ![
        "aiDescription",
        "safetyNotes",
        "bestForSummary",
        "notIdealWhen",
        "description",
        "techniqueVariantId",
        "categoryId",
        "situationId",
      ].includes(k)
    )
      throw new BadRequestException("Null is not permitted for " + k);
    else out[k] = v;
  }
  return out;
}
@Injectable()
export class TrainingLibraryService {
  constructor(
    readonly db: PrismaService,
    readonly access: TrainingAccess,
  ) {}
  async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(73012200)`;
          return fn(tx);
        },
        { timeout: 15000 },
      );
    } catch (e: any) {
      if (e?.code === "P2002")
        throw new ConflictException(
          "Training identifier or ordering already exists",
        );
      if (["P2003", "P2004", "P2010"].includes(e?.code))
        throw new BadRequestException(
          "Training relationship or content constraint failed",
        );
      throw e;
    }
  }
  async category(id: string, db: Prisma.TransactionClient = this.db) {
    const row = await db.skill.findFirst({
      where: {
        id,
        active: true,
        slug: { in: ["attack", "defense", "passing", "setting", "serving"] },
        sport: { slug: "beach-volleyball" },
      },
    });
    if (!row)
      throw new BadRequestException(
        "Use an existing beach volleyball category",
      );
    return row;
  }
  async node(
    id: string,
    actor?: string,
    db: Prisma.TransactionClient = this.db,
  ) {
    const node = await db.skillTreeNode.findFirst({
      where: {
        id,
        ...(!(await this.access.isEditor(actor))
          ? { status: "PUBLISHED" as const }
          : {}),
      },
    });
    if (!node) throw new NotFoundException("Training skill not found");
    return node;
  }
  async drill(
    id: string,
    actor?: string,
    db: Prisma.TransactionClient = this.db,
  ) {
    const drill = await db.drill.findFirst({
      where: {
        id,
        ...(!(await this.access.isEditor(actor))
          ? {
              status: "PUBLISHED" as const,
              skills: {
                some: {
                  role: "PRIMARY" as const,
                  skillTreeNode: { status: "PUBLISHED" as const },
                },
              },
            }
          : {}),
      },
      include: detail,
    });
    if (!drill) throw new NotFoundException("Drill not found");
    return drill;
  }
  async skillTree(actor?: string, categoryId?: string) {
    const nodes = await this.db.skillTreeNode.findMany({
      where: {
        ...(categoryId ? { categoryId } : {}),
        ...(!(await this.access.isEditor(actor))
          ? { status: "PUBLISHED" as const }
          : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 1001,
    });
    if (nodes.length > 1000)
      throw new BadRequestException("Skill graph exceeds supported size");
    const ids = nodes.map((n) => n.id);
    return {
      nodes,
      edges: await this.db.skillPrerequisite.findMany({
        where: { skillId: { in: ids }, prerequisiteId: { in: ids } },
        orderBy: [{ skillId: "asc" }, { prerequisiteId: "asc" }],
      }),
    };
  }
  async prerequisites(id: string, actor?: string) {
    await this.node(id, actor);
    const all = await this.skillTree(actor);
    return {
      prerequisites: all.edges.filter((e) => e.skillId === id),
      dependents: all.edges.filter((e) => e.prerequisiteId === id),
    };
  }
  async createNode(actor: string, input: D.CreateSkillTreeNodeInput) {
    await this.access.editor(actor);
    input = checkedInput(D.CreateSkillTreeNodeInput, input);
    return this.write(async (tx) => {
      await this.category(input.categoryId, tx);
      if ((await tx.skillTreeNode.count()) >= 1000)
        throw new BadRequestException("Skill catalog limit reached");
      return tx.skillTreeNode.create({ data: jsonData(input) });
    });
  }
  async updateNode(
    actor: string,
    id: string,
    input: D.UpdateSkillTreeNodeInput,
  ) {
    await this.access.editor(actor);
    input = checkedInput(D.UpdateSkillTreeNodeInput, input);
    return this.write(async (tx) => {
      const existing = await this.node(id, actor, tx);
      if (input.slug && input.slug !== existing.slug)
        throw new BadRequestException(
          "Skill slugs are stable; edit the learning content instead",
        );
      if (input.categoryId) await this.category(input.categoryId, tx);
      if (
        input.status &&
        input.status !== "PUBLISHED" &&
        ((await tx.drillSkill.count({
          where: { skillTreeNodeId: id, drill: { status: "PUBLISHED" } },
        })) ||
          (await tx.skillPrerequisite.count({
            where: { prerequisiteId: id, skill: { status: "PUBLISHED" } },
          })))
      )
        throw new BadRequestException(
          "Published content still depends on this skill",
        );
      if (
        input.status === "PUBLISHED" &&
        (await tx.skillPrerequisite.count({
          where: {
            skillId: id,
            prerequisite: { status: { not: "PUBLISHED" } },
          },
        }))
      )
        throw new BadRequestException("Publish prerequisites first");
      return tx.skillTreeNode.update({ where: { id }, data: jsonData(input) });
    });
  }
  async setPrerequisites(
    actor: string,
    id: string,
    edges: D.PrerequisiteInput[],
  ) {
    await this.access.editor(actor);
    edges = edges.map((e) => checkedInput(D.PrerequisiteInput, e));
    if (
      edges.length > 50 ||
      new Set(edges.map((e) => e.prerequisiteId)).size !== edges.length
    )
      throw new BadRequestException("Invalid prerequisites");
    return this.write(async (tx) => {
      const node = await this.node(id, actor, tx);
      for (const e of edges) {
        const p = await this.node(e.prerequisiteId, actor, tx);
        if (
          e.prerequisiteId === id ||
          (node.status === "PUBLISHED" && p.status !== "PUBLISHED")
        )
          throw new BadRequestException("Invalid prerequisite");
      }
      await tx.skillPrerequisite.deleteMany({ where: { skillId: id } });
      await tx.skillPrerequisite.createMany({
        data: edges.map((e) => ({ ...e, skillId: id })),
      });
      return tx.skillPrerequisite.findMany({
        where: { skillId: id },
        orderBy: { prerequisiteId: "asc" },
      });
    });
  }
  async drills(actor?: string, skillId?: string, after?: string, limit = 30) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException("Limit must be 1–100");
    return this.db.drill.findMany({
      where: {
        ...(!(await this.access.isEditor(actor))
          ? {
              status: "PUBLISHED" as const,
              AND: [
                {
                  skills: {
                    some: {
                      role: "PRIMARY" as const,
                      skillTreeNode: { status: "PUBLISHED" as const },
                    },
                  },
                },
              ],
            }
          : {}),
        ...(skillId
          ? {
              skills: {
                some: {
                  skillTreeNodeId: skillId,
                  skillTreeNode: { status: "PUBLISHED" as const },
                },
              },
            }
          : {}),
      },
      orderBy: { id: "asc" },
      take: limit,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      include: detail,
    });
  }
  async createDrill(actor: string, input: D.CreateDrillInput) {
    await this.access.editor(actor);
    input = checkedInput(D.CreateDrillInput, input);
    if (input.status === "PUBLISHED")
      throw new BadRequestException(
        "Create a draft, attach instructions and one primary skill, then publish",
      );
    this.validateDrill(input);
    return this.write((tx) =>
      tx.drill.create({ data: { ...jsonData(input), createdById: actor } }),
    );
  }
  async createDrillWithContent(
    actor: string,
    raw: D.CreateDrillWithContentInput,
  ) {
    await this.access.editor(actor);
    const input = checkedInput(D.CreateDrillWithContentInput, raw);
    const drill = checkedInput(D.CreateDrillInput, input.drill);
    const steps = input.steps.map((step) =>
      checkedInput(D.TrainingStepInput, step),
    );
    const newSkill = input.newPrimarySkill
      ? checkedInput(D.CreateSkillTreeNodeInput, input.newPrimarySkill)
      : undefined;
    if (Boolean(input.primarySkillId) === Boolean(newSkill))
      throw new BadRequestException(
        "Choose one existing primary skill or create a new one",
      );
    if (!steps.length || steps.some((s) => !s.instruction.trim()))
      throw new BadRequestException("Add at least one instruction");
    if (drill.status && !["DRAFT", "PUBLISHED"].includes(drill.status))
      throw new BadRequestException("Create a draft or a published drill");
    this.validateDrill(drill);
    if ((drill.minPlayers ?? 1) > (drill.maxPlayers ?? 2))
      throw new BadRequestException("Invalid player range");
    for (const key of ["name", "description", "objective", "setup"] as const)
      if (!drill[key].trim())
        throw new BadRequestException("Complete the drill details");
    return this.write(async (tx) => {
      let skillId = input.primarySkillId;
      if (newSkill) {
        await this.category(newSkill.categoryId, tx);
        if ((await tx.skillTreeNode.count()) >= 1000)
          throw new BadRequestException("Skill catalog limit reached");
        const skill = await tx.skillTreeNode.create({
          data: jsonData(newSkill),
        });
        skillId = skill.id;
      } else await this.node(skillId!, actor, tx);
      // One transaction prevents partially created drills or skills if validation/publication fails.
      const created = await tx.drill.create({
        data: { ...jsonData(drill), status: "DRAFT", createdById: actor },
      });
      await tx.drillStep.createMany({
        data: steps.map((s, sortOrder) => ({
          drillId: created.id,
          sortOrder,
          instruction: s.instruction.trim(),
          ...(s.metadata
            ? { metadata: contentJson(s.metadata) as Prisma.InputJsonValue }
            : {}),
        })),
      });
      await tx.drillSkill.create({
        data: {
          drillId: created.id,
          skillTreeNodeId: skillId!,
          role: "PRIMARY",
        },
      });
      if (drill.status === "PUBLISHED") {
        await this.publishable(tx, created.id);
        await tx.drill.update({
          where: { id: created.id },
          data: { status: "PUBLISHED" },
        });
      }
      return this.drill(created.id, actor, tx);
    });
  }
  private validateDrill(input: D.UpdateDrillInput) {
    if (input.metricConfig) parse(measurementSchema, input.metricConfig);
    if (
      input.durationMinutes !== undefined &&
      (input.durationMinutes < 1 || input.durationMinutes > 240)
    )
      throw new BadRequestException("Duration must be 1–240 minutes");
    if (input.minPlayers !== undefined && input.minPlayers < 1)
      throw new BadRequestException("At least one player is required");
  }
  async updateDrill(actor: string, id: string, input: D.UpdateDrillInput) {
    await this.access.editor(actor);
    input = checkedInput(D.UpdateDrillInput, input);
    this.validateDrill(input);
    return this.write(async (tx) => {
      const old = await this.drill(id, actor, tx);
      const next = { ...old, ...input };
      if (next.minPlayers! > next.maxPlayers!)
        throw new BadRequestException("Invalid player range");
      if (input.status === "PUBLISHED") await this.publishable(tx, id);
      return tx.drill.update({ where: { id }, data: jsonData(input) });
    });
  }
  async publishable(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.drill.findUniqueOrThrow({
      where: { id },
      include: { steps: true, skills: { include: { skillTreeNode: true } } },
    });
    if (
      !row.steps.length ||
      row.skills.filter((s) => s.role === "PRIMARY").length !== 1 ||
      row.skills.some((s) => s.skillTreeNode.status !== "PUBLISHED")
    )
      throw new BadRequestException(
        "Published drills need instructions, exactly one primary skill, and published linked skills",
      );
  }
  async setSteps(actor: string, id: string, steps: D.TrainingStepInput[]) {
    await this.access.editor(actor);
    steps = steps.map((s) => checkedInput(D.TrainingStepInput, s));
    if (steps.length > 100 || steps.some((s) => !s.instruction.trim()))
      throw new BadRequestException("Invalid instructions");
    return this.write(async (tx) => {
      const old = await this.drill(id, actor, tx);
      if (old.status === "PUBLISHED" && !steps.length)
        throw new BadRequestException("Published drills need instructions");
      await tx.drillStep.deleteMany({ where: { drillId: id } });
      await tx.drillStep.createMany({
        data: steps.map((s, sortOrder) => ({
          drillId: id,
          sortOrder,
          ...jsonData(s),
        })),
      });
      return tx.drillStep.findMany({
        where: { drillId: id },
        orderBy: { sortOrder: "asc" },
      });
    });
  }
  async setSkills(
    actor: string,
    id: string,
    skills: D.TrainingSkillLinkInput[],
  ) {
    await this.access.editor(actor);
    skills = skills.map((s) => checkedInput(D.TrainingSkillLinkInput, s));
    if (
      skills.length > 30 ||
      new Set(skills.map((s) => s.skillTreeNodeId)).size !== skills.length ||
      skills.filter((s) => s.role === "PRIMARY").length > 1
    )
      throw new BadRequestException("Invalid drill skill links");
    return this.write(async (tx) => {
      const drill = await this.drill(id, actor, tx);
      for (const s of skills) await this.node(s.skillTreeNodeId, actor, tx);
      await tx.drillSkill.deleteMany({ where: { drillId: id } });
      await tx.drillSkill.createMany({
        data: skills.map((s) => ({ ...s, drillId: id })),
      });
      if (drill.status === "PUBLISHED") await this.publishable(tx, id);
      return tx.drillSkill.findMany({
        where: { drillId: id },
        orderBy: { skillTreeNodeId: "asc" },
      });
    });
  }
  async situation(
    actor: string,
    input: D.CreateCoachingSituationInput | D.UpdateCoachingSituationInput,
    id?: string,
  ) {
    await this.access.editor(actor);
    if (input.categoryId) await this.category(input.categoryId);
    return this.write((tx) =>
      id
        ? tx.coachingSituation.update({ where: { id }, data: jsonData(input) })
        : tx.coachingSituation.create({ data: jsonData(input) }),
    );
  }
  async variant(
    actor: string,
    input:
      D.CreateDrillTechniqueVariantInput | D.UpdateDrillTechniqueVariantInput,
    id?: string,
  ) {
    await this.access.editor(actor);
    const existing = id
      ? await this.db.drillTechniqueVariant.findUniqueOrThrow({ where: { id } })
      : null;
    if (!input.drillId && existing)
      input = { ...input, drillId: existing.drillId };
    if (!input.drillId) throw new BadRequestException("Drill is required");

    return this.write(async (tx) => {
      await this.drill(input.drillId!, actor, tx);
      if (id) {
        const old = await tx.drillTechniqueVariant.findUniqueOrThrow({
          where: { id },
        });
        if (old.drillId !== input.drillId)
          throw new BadRequestException("Cannot move a variant between drills");
      }
      if (
        id &&
        input.status &&
        input.status !== "PUBLISHED" &&
        ((await tx.drillReferenceVideo.count({
          where: { techniqueVariantId: id, status: "PUBLISHED" },
        })) ||
          (await tx.techniqueCheckpoint.count({
            where: { techniqueVariantId: id, status: "PUBLISHED" },
          })))
      )
        throw new BadRequestException(
          "Unpublish variant references and checkpoints first",
        );
      if (input.isDefault)
        await tx.drillTechniqueVariant.updateMany({
          where: { drillId: input.drillId, ...(id ? { id: { not: id } } : {}) },
          data: { isDefault: false },
        });
      return id
        ? tx.drillTechniqueVariant.update({
            where: { id },
            data: jsonData(input),
          })
        : tx.drillTechniqueVariant.create({ data: jsonData(input) });
    });
  }
  async checkpoint(
    actor: string,
    input: D.CreateTechniqueCheckpointInput | D.UpdateTechniqueCheckpointInput,
    id?: string,
  ) {
    await this.access.editor(actor);
    const existing = id
      ? await this.db.techniqueCheckpoint.findUniqueOrThrow({ where: { id } })
      : null;
    if (!input.drillId && existing)
      input = { ...input, drillId: existing.drillId };
    if (!input.drillId) throw new BadRequestException("Drill is required");

    if (input.measurementConfig)
      parse(measurementSchema, input.measurementConfig);
    return this.write(async (tx) => {
      await this.drill(input.drillId!, actor, tx);
      if (
        input.techniqueVariantId &&
        !(await tx.drillTechniqueVariant.findFirst({
          where: { id: input.techniqueVariantId, drillId: input.drillId },
        }))
      )
        throw new BadRequestException("Variant belongs to another drill");
      if (
        id &&
        (await tx.techniqueCheckpoint.findUniqueOrThrow({ where: { id } }))
          .drillId !== input.drillId
      )
        throw new BadRequestException("Cannot move a checkpoint");
      const variantId =
        input.techniqueVariantId === undefined
          ? existing?.techniqueVariantId
          : input.techniqueVariantId;
      if (
        (input.status ?? existing?.status) === "PUBLISHED" &&
        variantId &&
        !(await tx.drillTechniqueVariant.findFirst({
          where: { id: variantId, drillId: input.drillId, status: "PUBLISHED" },
        }))
      )
        throw new BadRequestException("Publish the technique variant first");
      return id
        ? tx.techniqueCheckpoint.update({
            where: { id },
            data: jsonData(input),
          })
        : tx.techniqueCheckpoint.create({
            data: { sortOrder: 0, ...jsonData(input) },
          });
    });
  }
}
