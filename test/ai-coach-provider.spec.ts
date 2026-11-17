import { CoachOpenAI } from "../src/ai-coach/provider";
import { coachConfig } from "../src/ai-coach/config";
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});
describe("coach OpenAI configuration", () => {
  it("requires a backend key and validates hard resource ceilings", async () => {
    delete process.env.OPENAI_API_KEY;
    const api = new CoachOpenAI();
    expect(api.configured()).toBe(false);
    await expect(
      api.respond(
        { model: "gpt-6.1-sol", input: "Volleyball", store: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "CONFIG" });
    expect(() => coachConfig({ AI_CHAT_MAX_TOOL_EXECUTIONS: "999" })).toThrow();
    expect(() => coachConfig({ AI_CHAT_DAILY_TOKENS: "4000" })).toThrow();
  });
  it("uses Responses POST, disables provider storage, and reuses the configured Step 1 embedding space", async () => {
    process.env.OPENAI_API_KEY = "unit-test-not-a-key";
    process.env.FEEDBACK_EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.FEEDBACK_EMBEDDING_VERSION = "unit-v1";
    process.env.FEEDBACK_EMBEDDING_DIMENSIONS = "3";
    const fetcher = jest
      .spyOn(global, "fetch")
      .mockImplementation(
        async (url) =>
          new Response(
            JSON.stringify(
              String(url).endsWith("/embeddings")
                ? { data: [{ index: 0, embedding: [1, 0, 0] }] }
                : {
                    id: "resp_test",
                    object: "response",
                    status: "completed",
                    model: "gpt-6.1-sol",
                    output: [],
                    usage: {
                      input_tokens: 1,
                      output_tokens: 1,
                      total_tokens: 2,
                    },
                  },
            ),
            { headers: { "Content-Type": "application/json" } },
          ),
      );
    const api = new CoachOpenAI(),
      signal = new AbortController().signal;
    await api.respond(
      { model: "gpt-6.1-sol", input: "Volleyball", store: false },
      signal,
    );
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      model: "gpt-6.1-sol",
      store: false,
    });
    const e = await api.embedding("passing platform", signal);
    expect(e).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-small",
      modelVersion: "unit-v1",
      dimensions: 3,
      vector: [1, 0, 0],
    });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      dimensions: 3,
      encoding_format: "float",
    });
  });
});
