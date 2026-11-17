import OpenAI from "openai";
import {
  OpenAIExtractor,
  OpenAIEmbedder,
} from "../src/feedback-processing/providers";
import { ExtractionInput } from "../src/feedback-processing/contracts";

const env = {
  OPENAI_API_KEY: "test-key-not-real",
  FEEDBACK_EXTRACTION_MODEL: "gpt-4.1-mini",
  FEEDBACK_EMBEDDING_MODEL: "text-embedding-3-small",
  FEEDBACK_EMBEDDING_VERSION: "text-embedding-3-small-v1",
  FEEDBACK_EMBEDDING_DIMENSIONS: "3",
};
const input: ExtractionInput = {
  sources: [{ key: "overall", text: "Steady passing platform" }],
  skillSlugs: ["passing"],
  themes: [
    {
      id: "platform_control",
      name: "Platform control",
      skillSlugs: ["passing"],
    },
  ],
};
const output = {
  moderation: "ALLOW",
  observations: [
    {
      sourceKey: "overall",
      skill: "passing",
      theme: "platform_control",
      sentiment: "positive",
      evidence: "Steady passing platform",
    },
  ],
};
function responseBody(text = JSON.stringify(output), status = "completed") {
  return {
    id: "resp_test",
    object: "response",
    status,
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 },
  };
}
function fixture(body: unknown, status = 200) {
  const fetcher = jest.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    maxRetries: 0,
    fetch: fetcher,
  });
  return { fetcher, client };
}
describe("OpenAI feedback providers", () => {
  it("sends a strict structured Responses request without server-side response storage", async () => {
    const { client, fetcher } = fixture(responseBody());
    const result = await new OpenAIExtractor(env, client).extract(input);
    expect(result).toEqual({
      value: output,
      inputTokens: 12,
      outputTokens: 34,
    });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.openai.com/v1/responses",
    );
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request).toMatchObject({
      model: env.FEEDBACK_EXTRACTION_MODEL,
      store: false,
      text: {
        format: {
          type: "json_schema",
          strict: true,
          name: "feedback_observations",
        },
      },
    });
    expect(JSON.parse(request.input[0].content)).toEqual(input);
    expect(request.instructions).toContain("untrusted data");
  });
  it("treats refusals as non-retryable and incomplete output as retryable", async () => {
    const refusal = responseBody();
    refusal.output[0].content = [
      { type: "refusal", refusal: "Cannot process" },
    ] as any;
    await expect(
      new OpenAIExtractor(env, fixture(refusal).client).extract(input),
    ).rejects.toMatchObject({ code: "EXTRACTION_REFUSED", retryable: false });
    await expect(
      new OpenAIExtractor(
        env,
        fixture(responseBody("", "incomplete")).client,
      ).extract(input),
    ).rejects.toMatchObject({ code: "INCOMPLETE_EXTRACTION", retryable: true });
  });
  it("rejects malformed JSON so the durable worker can retry once", async () => {
    await expect(
      new OpenAIExtractor(
        env,
        fixture(responseBody("not JSON")).client,
      ).extract(input),
    ).rejects.toMatchObject({ code: "INVALID_EXTRACTION" });
  });
  it.each([429, 401, 500])(
    "sanitizes HTTP %i errors without SDK automatic retries",
    async (status) => {
      const { client, fetcher } = fixture(
        { error: { message: "private-provider-detail", type: "api_error" } },
        status,
      );
      await expect(
        new OpenAIExtractor(env, client).extract(input),
      ).rejects.toMatchObject({
        code: `PROVIDER_HTTP_${status}`,
        message: `PROVIDER_HTTP_${status}`,
        retryable: status !== 401,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("requests float embeddings with explicit dimensions and OpenAI provenance", async () => {
    const { client, fetcher } = fixture({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
    });
    const provider = new OpenAIEmbedder(env, client);
    expect(provider.provider).toBe("openai");
    expect(await provider.embed("Skill: passing\nSteady platform")).toEqual([
      0.1, 0.2, 0.3,
    ]);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.openai.com/v1/embeddings",
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      model: env.FEEDBACK_EMBEDDING_MODEL,
      dimensions: 3,
      encoding_format: "float",
    });
  });
  it.each([
    [0, 0, 0],
    [0.1, 0.2],
  ])("rejects unusable embedding vector %j", async (...vector) => {
    const { client } = fixture({ data: [{ index: 0, embedding: vector }] });
    await expect(
      new OpenAIEmbedder(env, client).embed("comment"),
    ).rejects.toMatchObject({ code: "INVALID_EMBEDDING" });
  });
  it("requires an OpenAI key rather than accepting credentials for another provider", () => {
    expect(
      () =>
        new OpenAIExtractor({
          FEEDBACK_EXTRACTION_MODEL: "gpt-4.1-mini",
          ANTHROPIC_API_KEY: "unused",
        }),
    ).toThrow("OPENAI_API_KEY is required");
  });
});
