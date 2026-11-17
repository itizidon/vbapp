import { Injectable } from "@nestjs/common";
import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import { OpenAIEmbedder } from "../feedback-processing/providers";
import { CoachFailure, safeMessages } from "./contracts";
@Injectable()
export class CoachOpenAI {
  configured() {
    return !!process.env.OPENAI_API_KEY?.trim();
  }
  private client(signal: AbortSignal) {
    if (!this.configured())
      throw new CoachFailure("CONFIG", safeMessages.CONFIG);
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 60000,
      maxRetries: 0,
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([
            signal,
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    });
  }
  async respond(
    params: ResponseCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<Response> {
    return this.client(signal).responses.create(params, { signal });
  }
  async embedding(
    query: string,
    signal: AbortSignal,
    onUsage?: (tokens: number) => void,
  ) {
    const embedder = new OpenAIEmbedder(
      process.env,
      this.client(signal),
      onUsage,
    );
    return {
      vector: await embedder.embed(query),
      provider: embedder.provider,
      model: embedder.model,
      modelVersion: embedder.modelVersion,
      dimensions: embedder.dimensions,
    };
  }
}
