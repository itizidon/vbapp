import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AiCoachService } from "../../src/ai-coach/service";
import { CoachEngine } from "../../src/ai-coach/engine";
import { CoachTools } from "../../src/ai-coach/tools";
import { CoachOpenAI } from "../../src/ai-coach/provider";
import { FeedbackAnalysisService } from "../../src/feedback-analysis/service";
import { rebuildOneProfile } from "../../src/feedback-processing/profiles";
import { coachConfig } from "../../src/ai-coach/config";
import { TEMPLATE_VERSION } from "../../src/feedback-processing/contracts";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "authenticated AI coach PostgreSQL workflow",
  () => {
    let db: PrismaClient,
      api: { configured: jest.Mock; respond: jest.Mock; embedding: jest.Mock },
      tools: CoachTools,
      service: AiCoachService;
    let sportId: string,
      skillId: string,
      actor: string,
      other: string,
      reviewers: string[],
      users: string[];
    let observations: { id: string; feedbackId: string; owner: string }[];
    const env = { ...process.env };
    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url } } });
      const sport = await db.sport.upsert({
        where: { slug: "beach-volleyball" },
        create: { name: "Beach Volleyball", slug: "beach-volleyball" },
        update: {},
      });
      sportId = sport.id;
      const skill = await db.skill.upsert({
        where: { sportId_slug: { sportId, slug: "passing" } },
        create: { sportId, name: "Passing", slug: "passing" },
        update: { active: true },
      });
      skillId = skill.id;
    });
    const makeUser = async () => {
      const id = randomUUID();
      users.push(id);
      await db.user.create({
        data: {
          id,
          username: id,
          email: id + "@example.test",
          passwordHash: "test-only",
          age: 24,
          heightCm: 180,
        },
      });
      return id;
    };
    async function add(
      owner: string,
      comment = "Private platform evidence",
      opts: {
        rating?: number;
        status?: "PUBLISHED" | "HIDDEN";
        guest?: boolean;
      } = {},
    ) {
      const f = await db.feedback.create({
        data: {
          recipientId: owner,
          sportId,
          reviewerId: opts.guest ? null : reviewers[observations.length % 2],
          guestName: opts.guest ? "Same name" : null,
          status: opts.status ?? "PUBLISHED",
          privateAnalyticsAllowed: true, privateCoachingAllowed: true, privacyNoticeVersion: "feedback-privacy-v1", privateAnalyticsConsentAt: new Date(), privateCoachingConsentAt: new Date(),
      analyticsAllowed: true,
          evidenceAllowed: true,
          overallComment: comment,
          createdAt: new Date(Date.now() - 1000),
          ratings: { create: { skillId, rating: opts.rating ?? 3, comment } },
        },
      });
      if (f.status === "PUBLISHED") {
        const job = await db.feedbackAnalysisJob.findUniqueOrThrow({
          where: { feedbackId: f.id },
        });
        const o = await db.feedbackObservation.create({
          data: {
            feedbackId: f.id,
            generation: job.generation,
            sourceKey: "overall",
            skillId,
            themeId: "platform_control",
            sentiment: "negative",
            evidence: comment,
            sourceHash: "coach-fixture",
            fingerprint: randomUUID(),
            provider: "fixture",
            modelVersion: "fixture",
            promptVersion: "fixture",
            feedbackCreatedAt: f.createdAt,
          },
        });
        await db.feedbackAnalysisJob.update({
          where: { feedbackId: f.id },
          data: {
            status: "COMPLETED",
            moderation: "ALLOW",
            sourceHash: "coach-fixture",
          },
        });
        observations.push({ id: o.id, feedbackId: f.id, owner });
      }
      return f;
    }
    const draft = (
      factId = `skill.${skillId}.peer`,
      count = 6,
      ids: string[] = [],
    ) => ({
      intro: "DETAIL",
      evidence: [{ factId, supportingReviewCount: count, feedbackIds: ids }],
      generalSuggestions: [
        {
          text: "Keep a steady platform and aim at a target.",
          relatedFactId: factId,
        },
      ],
      recommendedDrillIds: [],
      insufficientEvidence: false,
    });
    const final = (value: unknown) => ({
      status: "completed",
      model: "gpt-6.1-sol",
      output: [],
      output_text: JSON.stringify(value),
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const call = (name = "get_player_profile", args: unknown = {}) => ({
      status: "completed",
      model: "gpt-6.1-sol",
      output: [
        {
          type: "function_call",
          id: "fc_test",
          call_id: "call_test",
          name,
          arguments: JSON.stringify(args),
        },
      ],
      output_text: "",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const input = (
      question = "How is my passing?",
      conversationId?: string,
    ) => ({
      sportId,
      question,
      clientRequestId: randomUUID(),
      ...(conversationId ? { conversationId } : {}),
    });
    beforeEach(async () => {
      process.env = {
        ...env,
        OPENAI_CHAT_MODEL: "gpt-6.1-sol",
        OPENAI_CHAT_FALLBACK_MODEL: "gpt-6-luna",
        AI_CHAT_MAX_TOTAL_TOKENS: "64000",
        AI_CHAT_DAILY_TOKENS: "200000",
        AI_CHAT_DAILY_REQUESTS: "30",
      };
      users = [];
      observations = [];
      actor = await makeUser();
      other = await makeUser();
      reviewers = [await makeUser(), await makeUser()];
      for (const owner of [actor, other])
        for (let i = 0; i < 6; i++) await add(owner);
      await rebuildOneProfile(db, actor, sportId);
      await rebuildOneProfile(db, other, sportId);
      api = {
        configured: jest.fn(() => true),
        respond: jest
          .fn()
          .mockResolvedValueOnce(call())
          .mockImplementation(async () => final(draft())),
        embedding: jest.fn(async () => ({
          vector: [1, 0, 0],
          provider: "openai",
          model: "text-embedding-3-small",
          modelVersion: "coach-test-v1",
          dimensions: 3,
        })),
      };
      tools = new CoachTools(db as any, api as unknown as CoachOpenAI);
      service = new AiCoachService(
        db as any,
        new FeedbackAnalysisService(db as any),
        new CoachEngine(api as any, tools),
        api as any,
        tools,
      );
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      process.env = { ...env };
      await db.aiCoachConversation.deleteMany({
        where: { userId: { in: users } },
      });
      await db.feedback.deleteMany({ where: { recipientId: { in: users } } });
      await db.playerFeedbackAnalysisProfile.deleteMany({
        where: { userId: { in: users } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
    });
    afterAll(() => db?.$disconnect());
    it("stores a validated answer, known usage, prompt version and bounded tool metadata without raw retrieved comments", async () => {
      const result = await service.ask(actor, input());
      expect(result.response.status).toBe("ANSWERED");
      expect(result.response.evidence[0].supportingReviewCount).toBe(6);
      expect(result.response.recommendedDrillIds).toEqual([]);
      const row = await db.aiCoachTurn.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(row).toMatchObject({
        userId: actor,
        status: "COMPLETED",
        model: "gpt-6.1-sol",
        promptVersion: "bvbtips-coach-v1",
        inputTokens: 200,
        outputTokens: 100,
      });
      expect(JSON.stringify(row.response)).not.toContain(
        "Private platform evidence",
      );
      expect(JSON.stringify(row.toolTrace)).not.toContain("arguments");
      const history = await service.messages(actor, result.conversationId);
      expect(history.messages[0].response.status).toBe("ANSWERED");
      expect(history.messages[0].response.message).toBe(
        result.response.message,
      );
      const usage = await db.aiCoachUsage.findFirstOrThrow({
        where: { userId: actor },
      });
      expect(usage).toMatchObject({
        requests: 1,
        reservedTokens: 0,
        spentTokens: 300,
      });
    });
    it("replays the same request without another model call or charge and rejects changed payloads", async () => {
      const request = input();
      const a = await service.ask(actor, request),
        b = await service.ask(actor, request);
      expect(a.id).toBe(b.id);
      expect(api.respond).toHaveBeenCalledTimes(2);
      await expect(
        service.ask(actor, { ...request, question: "Different question" }),
      ).rejects.toThrow("already used");
      expect(await db.aiCoachTurn.count({ where: { userId: actor } })).toBe(1);
    });
    it("rejects another player’s conversation and message cursors", async () => {
      const a = await service.ask(actor, input());
      await expect(service.messages(other, a.conversationId)).rejects.toThrow(
        "not found",
      );
      await expect(
        service.ask(other, input("Passing?", a.conversationId)),
      ).rejects.toThrow("not found");
      expect(await service.conversations(other, sportId)).toEqual([]);
      expect(await db.aiCoachTurn.count({ where: { userId: other } })).toBe(0);
    });
    it("redacts historical facts after consent is withdrawn and never presents stale metrics", async () => {
      const a = await service.ask(actor, input());
      await db.feedback.update({
        where: { id: observations.find((o) => o.owner === actor)!.feedbackId },
        data: { privateAnalyticsAllowed: false },
      });
      const history = await service.messages(actor, a.conversationId);
      expect(history.messages[0].response).toMatchObject({
        status: "OUTDATED",
        evidence: [],
        insufficientEvidence: true,
      });
      const calls = api.respond.mock.calls.length;
      const pending = await service.ask(actor, input("How is my setting?"));
      expect(pending.response.status).toBe("PROFILE_PENDING");
      expect(api.respond).toHaveBeenCalledTimes(calls);
    });
    it("rejects forged evidence IDs and counts from the model", async () => {
      api.respond
        .mockReset()
        .mockResolvedValue(
          final(
            draft(
              `observation.${observations.find((o) => o.owner === other)!.id}`,
              1,
              [observations.find((o) => o.owner === other)!.feedbackId],
            ),
          ),
        );
      const a = await service.ask(actor, input());
      expect(a.response.status).toBe("INVALID_RESPONSE");
      expect(a.response.evidence).toEqual([]);
      expect(a.inputTokens).toBe(100);
      expect(
        (await db.aiCoachUsage.findFirstOrThrow({ where: { userId: actor } }))
          .spentTokens,
      ).toBe(150);
    });
    it("provides cautious low-sample answers and keeps empty data/configuration states useful", async () => {
      const id = await makeUser();
      await add(id);
      await rebuildOneProfile(db, id, sportId);
      api.respond
        .mockReset()
        .mockResolvedValue(final(draft(`skill.${skillId}.peer`, 1)));
      expect(
        (await service.ask(id, input())).response.insufficientEvidence,
      ).toBe(true);
      const empty = await makeUser();
      await rebuildOneProfile(db, empty, sportId);
      const before = api.respond.mock.calls.length;
      expect((await service.ask(empty, input())).response.status).toBe(
        "NO_FEEDBACK",
      );
      expect(api.respond).toHaveBeenCalledTimes(before);
      api.configured.mockReturnValue(false);
      expect((await service.ask(actor, input())).response.status).toBe(
        "CONFIG",
      );
    });
    it("enforces persistent per-user daily/minute budgets and single in-flight work", async () => {
      process.env.AI_CHAT_DAILY_REQUESTS = "1";
      await service.ask(actor, input());
      await expect(service.ask(actor, input("Next?"))).rejects.toThrow(
        "usage limit",
      );
      expect((await service.ask(other, input())).response.status).toBe(
        "ANSWERED",
      );
    });
    it("returns a transparent timeout while charging the conservative token reservation", async () => {
      process.env.AI_CHAT_TIMEOUT_MS = "1000";
      api.respond.mockReset().mockImplementation(() => new Promise(() => {}));
      const a = await service.ask(actor, input());
      expect(a.response.status).toBe("TIMEOUT");
      const usage = await db.aiCoachUsage.findFirstOrThrow({
        where: { userId: actor },
      });
      expect(usage.reservedTokens).toBe(0);
      expect(usage.spentTokens).toBe(64000);
    });
    it("rejects a successful model draft if source feedback changes in flight", async () => {
      api.respond.mockReset().mockImplementation(async () => {
        await db.feedback.update({
          where: {
            id: observations.find((o) => o.owner === actor)!.feedbackId,
          },
          data: { overallComment: "Changed during chat" },
        });
        return final(draft());
      });
      const a = await service.ask(actor, input());
      expect(a.response.status).toBe("OUTDATED");
      expect(a.response.evidence).toEqual([]);
    });
    async function vector(
      o: { id: string },
      values: number[],
      version = "coach-test-v1",
    ) {
      await db.feedbackEmbeddingJob.create({
        data: {
          observationId: o.id,
          provider: "openai",
          model: "text-embedding-3-small",
          modelVersion: version,
          dimensions: values.length,
          templateVersion: TEMPLATE_VERSION,
          sourceHash: "vector-fixture",
          status: "COMPLETED",
        },
      });
      await db.$executeRaw`INSERT INTO "FeedbackObservationEmbedding" ("observationId",provider,model,"modelVersion",dimensions,"templateVersion","sourceHash",vector)
   VALUES (${o.id}::uuid,'openai','text-embedding-3-small',${version},${values.length},${TEMPLATE_VERSION},'vector-fixture',${JSON.stringify(values)}::vector)`;
    }
    const args = () => ({
      query: "platform control",
      skill: "passing" as const,
      theme: "platform_control",
      from: null,
      before: null,
      limit: 2,
    });
    it("runs scoped semantic retrieval with compatible vectors, deduplication, filters and limits", async () => {
      const mine = observations.filter((o) => o.owner === actor),
        theirs = observations.filter((o) => o.owner === other);
      await vector(mine[0], [1, 0, 0]);
      await vector(mine[1], [0.9, 0.1, 0]);
      await vector(mine[2], [1, 0], "incompatible");
      await vector(theirs[0], [1, 0, 0]);
      const result = await tools.search(
        actor,
        sportId,
        args(),
        coachConfig(),
        new AbortController().signal,
      );
      expect(result.mode).toBe("SEMANTIC");
      expect(result.observations).toHaveLength(2);
      expect(result.observations.map((o) => o.feedbackId)).toEqual([
        mine[0].feedbackId,
        mine[1].feedbackId,
      ]);
      expect(JSON.stringify(result)).not.toContain(other);
      expect(
        (
          await tools.search(
            actor,
            sportId,
            { ...args(), from: new Date(Date.now() + 86400000).toISOString() },
            coachConfig(),
            new AbortController().signal,
          )
        ).observations,
      ).toEqual([]);
    });
    it("supports exact/keyword retrieval when embeddings are missing without counting the sample as statistics", async () => {
      const result = await tools.search(
        actor,
        sportId,
        args(),
        coachConfig(),
        new AbortController().signal,
      );
      expect(result.mode).toBe("KEYWORD_FALLBACK");
      expect(result.observations).toHaveLength(2);
      expect(result.coverage).toContain("not a frequency");
      const exact = await tools.search(
        actor,
        sportId,
        { ...args(), query: null },
        coachConfig(),
        new AbortController().signal,
      );
      expect(exact.mode).toBe("EXACT_FILTER");
      expect(exact.observations.every((o) => o.skillId === skillId)).toBe(true);
      await expect(
        tools.search(
          actor,
          sportId,
          {
            ...args(),
            from: "2026-11-16T00:00:00Z",
            before: "2026-11-15T00:00:00Z",
          },
          coachConfig(),
          new AbortController().signal,
        ),
      ).rejects.toThrow("date range");
    });
    it("never includes hidden/deleted/unconsented observations and safely hydrates cited chat history", async () => {
      const o = observations.find((o) => o.owner === actor)!;
      await vector(o, [1, 0, 0]);
      api.respond
        .mockReset()
        .mockResolvedValueOnce(call("search_feedback", args()))
        .mockResolvedValueOnce(
          final(draft(`observation.${o.id}`, 1, [o.feedbackId])),
        );
      const a = await service.ask(
        actor,
        input("What did reviewers say about platform control?"),
      );
      expect(a.response.evidence[0].feedbackIds).toEqual([o.feedbackId]);
      expect(a.response.insufficientEvidence).toBe(true);
      expect(
        (await service.messages(actor, a.conversationId)).messages[0].response
          .evidence[0].feedbackIds,
      ).toEqual([o.feedbackId]);
      await db.feedback.update({
        where: { id: o.feedbackId },
        data: { status: "HIDDEN" },
      });
      expect(
        (await service.messages(actor, a.conversationId)).messages[0].response
          .evidence,
      ).toEqual([]);
    });
    it("enforces GraphQL auth/ownership, validates questions, and suppresses internal error details", async () => {
      process.env.JWT_SECRET = "coach-integration-secret-longer-than-32";
      process.env.DATABASE_URL = url;
      process.env.NODE_ENV = "test";
      const { Test } = await import("@nestjs/testing");
      const { AppModule } = await import("../../src/app.module");
      const { PrismaService } = await import("../../src/prisma/prisma.service");
      const { GraphQLSchemaHost } = await import("@nestjs/graphql");
      const { JwtService } = await import("@nestjs/jwt");
      const { graphql } = await import("graphql");
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(db)
        .overrideProvider(CoachOpenAI)
        .useValue(api)
        .compile();
      const app = module.createNestApplication();
      await app.init();
      try {
        const schema = module.get(GraphQLSchemaHost).schema;
        const execute = async (
          source: string,
          variables: Record<string, unknown>,
          who?: string,
        ) =>
          graphql({
            schema,
            source,
            variableValues: variables,
            contextValue: {
              req: {
                headers: who
                  ? {
                      authorization:
                        "Bearer " +
                        (await module
                          .get(JwtService)
                          .signAsync({
                            id: who,
                            sub: who,
                            username: "fixture",
                          })),
                    }
                  : {},
                ip: "127.0.0.1",
              },
              res: { header: () => {}, setHeader: () => {} },
            },
          });
        const mutation =
          "mutation Ask($input:AskAiCoachInput!){askAiCoach(input:$input){id conversationId response {status message evidence {feedbackIds supportingReviewCount}}}}";
        const denied = await execute(mutation, { input: input() });
        expect(denied.errors?.[0].extensions.code).toBe("UNAUTHENTICATED");
        const accepted = await execute(mutation, { input: input() }, actor);
        expect(accepted.errors).toBeUndefined();
        const conv = (accepted.data!.askAiCoach as any).conversationId;
        const foreign = await execute(
          "query($id:ID!){myAiCoachMessages(conversationId:$id){messages{id}}}",
          { id: conv },
          other,
        );
        expect(foreign.errors?.[0].message).toBe("Conversation not found");
        const invalid = await execute(
          mutation,
          { input: { ...input(), question: "x".repeat(2001) } },
          actor,
        );
        expect(invalid.errors?.length).toBeGreaterThan(0);
        const leak = await execute(
          "query($id:ID!){myAiCoachMessages(conversationId:$id){messages{id}}}",
          { id: "bad" },
          actor,
        );
        expect(JSON.stringify(leak)).not.toContain("prisma");
        expect(JSON.stringify(leak.errors?.[0].extensions)).not.toContain(
          "stacktrace",
        );
      } finally {
        await app.close();
      }
    });
  },
);
