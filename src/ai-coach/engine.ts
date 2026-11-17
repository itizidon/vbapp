import { Injectable } from "@nestjs/common";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  ResponseInputItem,
  Response,
} from "openai/resources/responses/responses";
import { FeedbackAnalysisProfile } from "../feedback-analysis/models";
import { CoachOpenAI } from "./provider";
import { CoachTools } from "./tools";
import { CoachConfig } from "./config";
import {
  COACH_TOOLS,
  CoachDraft,
  CoachFailure,
  CoachUsage,
  coachDraftSchema,
  profileArgs,
  searchArgs,
  safeMessages,
} from "./contracts";
import {
  CoachAnswer,
  observationFact,
  profileFacts,
  renderDraft,
  validateDraft,
} from "./facts";
import { COACH_SYSTEM_PROMPT } from "./prompts/bvbtips-coach-v1";
export interface CoachRun {
  draft: CoachDraft;
  answer: CoachAnswer;
  model: string;
  inputTokens: number;
  outputTokens: number;
  trace: { name: string; status: string; round: number; durationMs: number }[];
  chargeFullBudget: boolean;
}
@Injectable()
export class CoachEngine {
  constructor(
    private readonly api: CoachOpenAI,
    private readonly tools: CoachTools,
  ) {}
  async run(
    actorId: string,
    sportId: string,
    question: string,
    profile: FeedbackAnalysisProfile,
    history: { question: string; message: string }[],
    config: CoachConfig,
    signal: AbortSignal,
    onUsage: (usage: CoachUsage) => void = () => {},
    beforeCall: () => Promise<void> = async () => {},
  ): Promise<CoachRun> {
    const facts = profileFacts(profile),
      input: ResponseInputItem[] = [];
    for (const turn of history.slice(-4)) {
      input.push(
        { role: "user", content: turn.question.slice(0, 1000) },
        { role: "assistant", content: turn.message.slice(0, 1600) },
      );
    }
    input.push({ role: "user", content: question });
    let unknownTokens = 0;
    let inputTokens = 0,
      outputTokens = 0,
      executions = 0,
      model = config.model,
      actualModel = model,
      fallbackUsed = false,
      toolFailed = false;
    const trace: CoachRun["trace"] = [],
      memo = new Map<string, unknown>(),
      callIds = new Set<string>();
    const instructions =
      COACH_SYSTEM_PROMPT + "\nCurrent UTC time: " + new Date().toISOString();
    try {
      for (let round = 0; round <= config.maxToolRounds; round++) {
        if (signal.aborted)
          throw new CoachFailure("TIMEOUT", safeMessages.TIMEOUT);
        await beforeCall();
        const bytes = Buffer.byteLength(
          JSON.stringify({ input, instructions, tools: COACH_TOOLS }),
        );
        // One UTF-8 byte per token is a conservative input reservation bound.
        const remaining =
          config.maxTotalTokens - inputTokens - outputTokens - unknownTokens;
        if (
          bytes > config.maxInputBytes ||
          bytes + config.maxOutputTokens > remaining
        )
          throw new CoachFailure("LIMIT_REACHED", safeMessages.LIMIT_REACHED);
        let response: Response;
        try {
          response = await this.api.respond(
            {
              model,
              instructions,
              input,
              store: false,
              include: ["reasoning.encrypted_content"],
              max_output_tokens: Math.min(
                config.maxOutputTokens,
                remaining - bytes,
              ),
              reasoning: { effort: "low" },
              tools: COACH_TOOLS,
              parallel_tool_calls: false,
              tool_choice:
                round === config.maxToolRounds
                  ? "none"
                  : round === 0
                    ? "required"
                    : "auto",
              text: {
                format: zodTextFormat(coachDraftSchema, "bvbtips_coach_answer"),
              },
            },
            signal,
          );
        } catch (error) {
          const e = error as { status?: number; code?: string };
          if (
            !signal.aborted &&
            !fallbackUsed &&
            config.fallbackModel &&
            config.fallbackModel !== model &&
            (e.status === 404 ||
              e.status === 503 ||
              (e.status === 429 && e.code !== "insufficient_quota") ||
              e.code === "unsupported_model")
          ) {
            if (e.status === 503)
              unknownTokens += bytes + config.maxOutputTokens;
            onUsage({
              inputTokens,
              outputTokens,
              model: actualModel,
              trace,
              chargeFullBudget: unknownTokens > 0,
            });
            model = config.fallbackModel;
            fallbackUsed = true;
            round--;
            continue;
          }
          if (
            e.status === 400 ||
            e.status === 401 ||
            e.status === 403 ||
            e.code === "insufficient_quota"
          )
            throw new CoachFailure("CONFIG", safeMessages.CONFIG);
          throw new CoachFailure(
            signal.aborted ? "TIMEOUT" : "UNAVAILABLE",
            signal.aborted ? safeMessages.TIMEOUT : safeMessages.UNAVAILABLE,
          );
        }
        inputTokens += response.usage?.input_tokens ?? 0;
        outputTokens += response.usage?.output_tokens ?? 0;
        actualModel = response.model ?? model;
        onUsage({
          inputTokens,
          outputTokens,
          model: actualModel,
          trace,
          chargeFullBudget: unknownTokens > 0,
        });
        if (inputTokens + outputTokens > config.maxTotalTokens)
          throw new CoachFailure("LIMIT_REACHED", safeMessages.LIMIT_REACHED);
        if (
          response.status !== "completed" ||
          response.output.some(
            (o) =>
              o.type === "message" &&
              o.content.some((c) => c.type === "refusal"),
          )
        )
          throw new CoachFailure(
            "INVALID_RESPONSE",
            safeMessages.INVALID_RESPONSE,
          );
        const calls = response.output.filter((o) => o.type === "function_call");
        if (!calls.length) {
          let value: unknown;
          try {
            value = JSON.parse(response.output_text);
          } catch {
            throw new CoachFailure(
              "INVALID_RESPONSE",
              safeMessages.INVALID_RESPONSE,
            );
          }
          let draft = validateDraft(value, facts);
          if (
            /\b(weakness|weaknesses|focus|work on|priorities|prioritize)\b/i.test(
              question,
            ) &&
            profile.weaknesses.length
          ) {
            const priority = [...facts.values()]
              .filter((f) => f.factId.startsWith("weakness."))
              .slice(0, 3);
            const selected = [
              ...priority.map((f) => ({
                factId: f.factId,
                supportingReviewCount: f.supportingReviewCount,
                feedbackIds: f.feedbackIds,
              })),
              ...draft.evidence.filter(
                (e) => !priority.some((f) => f.factId === e.factId),
              ),
            ].slice(0, 6);
            const allowed = new Set(selected.map((e) => e.factId));
            draft = {
              ...draft,
              evidence: selected,
              generalSuggestions: draft.generalSuggestions.filter(
                (s) => !s.relatedFactId || allowed.has(s.relatedFactId),
              ),
            };
          }
          const answer = renderDraft(draft, facts, profile);
          if (toolFailed) {
            answer.insufficientEvidence = true;
            answer.message +=
              "\n\nSome requested feedback could not be retrieved, so this answer may be incomplete.";
          }
          return {
            draft,
            answer,
            model: actualModel,
            inputTokens,
            outputTokens,
            trace,
            chargeFullBudget: unknownTokens > 0,
          };
        }
        if (
          round === config.maxToolRounds ||
          executions + calls.length > config.maxToolExecutions
        )
          throw new CoachFailure("LIMIT_REACHED", safeMessages.LIMIT_REACHED);
        for (const item of response.output) {
          if (
            item.type === "function_call" ||
            item.type === "reasoning" ||
            item.type === "message"
          )
            input.push(item);
          else
            throw new CoachFailure(
              "INVALID_RESPONSE",
              safeMessages.INVALID_RESPONSE,
            );
        }
        for (const call of calls) {
          if (
            typeof call.arguments !== "string" ||
            call.arguments.length > 4000 ||
            !call.call_id ||
            callIds.has(call.call_id)
          )
            throw new CoachFailure(
              "INVALID_RESPONSE",
              safeMessages.INVALID_RESPONSE,
            );
          callIds.add(call.call_id);
          executions++;
          const started = Date.now();
          const name = ["get_player_profile", "search_feedback"].includes(
            call.name,
          )
            ? call.name
            : "unknown";
          let result: unknown;
          let queryBudget = 0;
          let status = "OK";
          try {
            const raw = JSON.parse(call.arguments);
            const parsed =
              name === "get_player_profile"
                ? profileArgs.parse(raw)
                : name === "search_feedback"
                  ? searchArgs.parse(raw)
                  : null;
            if (!parsed) throw Error("Unknown tool");
            const key = name + JSON.stringify(parsed);
            if (memo.has(key)) result = memo.get(key);
            else if (name === "get_player_profile") {
              result = this.tools.profile(
                profile,
                facts,
                question,
                config.maxToolOutputBytes,
              );
              memo.set(key, result);
            } else {
              const searchInput = searchArgs.parse(parsed);
              queryBudget = searchInput.query
                ? Buffer.byteLength(searchInput.query)
                : 0;
              if (
                inputTokens + outputTokens + unknownTokens + queryBudget >
                config.maxTotalTokens
              )
                throw new CoachFailure(
                  "LIMIT_REACHED",
                  safeMessages.LIMIT_REACHED,
                );
              const found = await this.tools.search(
                actorId,
                sportId,
                searchInput,
                config,
                signal,
                (tokens) => {
                  inputTokens += tokens;
                  onUsage({
                    inputTokens,
                    outputTokens,
                    model: actualModel,
                    trace,
                    chargeFullBudget: unknownTokens > 0,
                  });
                },
              );
              for (const observation of found.observations) {
                const fact = observationFact(observation);
                facts.set(fact.factId, fact);
              }
              result = {
                status: "OK",
                ...found,
                facts: found.observations.map((o) =>
                  facts.get(`observation.${o.observationId}`),
                ),
              };
              memo.set(key, result);
            }
            if (
              Buffer.byteLength(JSON.stringify(result)) >
              config.maxToolOutputBytes
            )
              throw Error("Tool output limit");
          } catch {
            if (queryBudget) {
              unknownTokens += queryBudget;
              onUsage({
                inputTokens,
                outputTokens,
                model: actualModel,
                trace,
                chargeFullBudget: true,
              });
            }
            toolFailed = true;
            status = "FAILED";
            result = {
              status: "UNAVAILABLE",
              message:
                "This tool could not return verified evidence. Do not infer missing information.",
            };
          }
          trace.push({ name, status, round, durationMs: Date.now() - started });
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        }
      }
      throw new CoachFailure("LIMIT_REACHED", safeMessages.LIMIT_REACHED);
    } catch (error) {
      const failure =
        error instanceof CoachFailure
          ? error
          : new CoachFailure("UNAVAILABLE", safeMessages.UNAVAILABLE);
      failure.usage = {
        inputTokens,
        outputTokens,
        model: actualModel,
        trace,
        chargeFullBudget:
          unknownTokens > 0 ||
          ["TIMEOUT", "UNAVAILABLE"].includes(failure.code),
      };
      onUsage(failure.usage);
      throw failure;
    }
  }
}
