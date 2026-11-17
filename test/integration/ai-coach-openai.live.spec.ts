import OpenAI from "openai";
const enabled = process.env.RUN_OPENAI_COACH_LIVE === "true";
(enabled ? describe : describe.skip)(
  "explicit OpenAI coach connectivity",
  () => {
    it("authenticates and finds both configured models without generating or billing completions", async () => {
      if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_CHAT_MODEL)
        throw new Error("Configure backend OpenAI credentials and model first");
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 15000,
        maxRetries: 0,
      });
      try {
        const primary = await client.models.retrieve(
          process.env.OPENAI_CHAT_MODEL,
        );
        expect(primary.id).toBeTruthy();
        if (process.env.OPENAI_CHAT_FALLBACK_MODEL)
          expect(
            (
              await client.models.retrieve(
                process.env.OPENAI_CHAT_FALLBACK_MODEL,
              )
            ).id,
          ).toBeTruthy();
      } catch {
        throw new Error(
          "OpenAI model access check failed; verify backend credentials and model access",
        );
      }
    }, 30000);
  },
);
