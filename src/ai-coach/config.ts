export interface CoachConfig {
  model: string;
  fallbackModel: string;
  maxToolRounds: number;
  maxToolExecutions: number;
  maxFeedbackSearchResults: number;
  maxQuestionLength: number;
  maxToolOutputBytes: number;
  timeoutMs: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxInputBytes: number;
  requestsPerMinute: number;
  dailyRequests: number;
  dailyTokens: number;
  retentionDays: number;
}
function number(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const n = env[name] ? Number(env[name]) : fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error("Invalid coach limit");
  return n;
}
export function coachConfig(env: NodeJS.ProcessEnv = process.env): CoachConfig {
  const config = {
    model: env.OPENAI_CHAT_MODEL?.trim() ?? "",
    fallbackModel: env.OPENAI_CHAT_FALLBACK_MODEL?.trim() ?? "",
    maxToolRounds: number(env, "AI_CHAT_MAX_TOOL_ROUNDS", 4, 1, 4),
    maxToolExecutions: number(env, "AI_CHAT_MAX_TOOL_EXECUTIONS", 6, 1, 6),
    maxFeedbackSearchResults: number(
      env,
      "AI_CHAT_MAX_SEARCH_RESULTS",
      10,
      1,
      10,
    ),
    maxQuestionLength: number(
      env,
      "AI_CHAT_MAX_QUESTION_LENGTH",
      2000,
      1,
      2000,
    ),
    maxToolOutputBytes: number(
      env,
      "AI_CHAT_MAX_TOOL_OUTPUT_BYTES",
      16000,
      1000,
      24000,
    ),
    timeoutMs: number(env, "AI_CHAT_TIMEOUT_MS", 60000, 1000, 60000),
    maxOutputTokens: number(env, "AI_CHAT_MAX_OUTPUT_TOKENS", 3000, 256, 6000),
    maxTotalTokens: number(env, "AI_CHAT_MAX_TOTAL_TOKENS", 64000, 4000, 64000),
    maxInputBytes: number(env, "AI_CHAT_MAX_INPUT_BYTES", 36000, 4000, 64000),
    requestsPerMinute: number(env, "AI_CHAT_REQUESTS_PER_MINUTE", 5, 1, 20),
    dailyRequests: number(env, "AI_CHAT_DAILY_REQUESTS", 30, 1, 100),
    dailyTokens: number(env, "AI_CHAT_DAILY_TOKENS", 200000, 4000, 2000000),
    retentionDays: number(env, "AI_CHAT_RETENTION_DAYS", 90, 1, 365),
  };
  if (
    config.maxOutputTokens >= config.maxTotalTokens ||
    config.dailyTokens < config.maxTotalTokens
  )
    throw new Error("Invalid coach token budget");
  return config;
}
