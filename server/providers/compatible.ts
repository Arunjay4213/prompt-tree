// Compatible provider: any OpenAI-compatible Chat Completions endpoint (OpenRouter, Ollama,
// LM Studio, Groq, ...), through the openai SDK with a custom base URL.
// Active when COMPATIBLE_BASE_URL and COMPATIBLE_MODELS are both set. COMPATIBLE_API_KEY is optional,
// COMPATIBLE_NAME is the label shown in the interface.

import OpenAI, { APIConnectionError, APIError, AuthenticationError, RateLimitError } from "openai";
import { nameList, type AnswerEnd, type OnText, type Provider, type ProviderRequest } from "./common";

const BASE_URL = process.env.COMPATIBLE_BASE_URL ?? "";
const LABEL = process.env.COMPATIBLE_NAME || "Compatible";

let client: OpenAI | undefined;

async function complete(modelName: string, request: ProviderRequest, onText: OnText, signal: AbortSignal): Promise<AnswerEnd> {
  // Local servers need no key, but the SDK requires a value, so a placeholder is sent.
  client ??= new OpenAI({ baseURL: BASE_URL, apiKey: process.env.COMPATIBLE_API_KEY || "no-key" });
  const system = request.system === undefined ? [] : [{ role: "system" as const, content: request.system }];
  try {
    const stream = await client.chat.completions.create(
      { model: modelName, messages: [...system, ...request.messages], stream: true },
      { signal },
    );
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice === undefined) continue;
      if (choice.delta.content) await onText(choice.delta.content);
      switch (choice.finish_reason) {
        case null:
          break;
        case "stop":
          return { type: "done", outcome: "complete" };
        case "length":
          return { type: "done", outcome: "cut_off" };
        case "content_filter":
          return { type: "error", message: `${LABEL} stopped the answer with its content filter.` };
        default:
          return { type: "error", message: `The answer stopped early (reason: ${choice.finish_reason}).` };
      }
    }
    if (signal.aborted) return { type: "disconnected" };
    return { type: "error", message: `The ${LABEL} stream ended early, without a finish reason.` };
  } catch (err) {
    if (signal.aborted) return { type: "disconnected" };
    if (err instanceof AuthenticationError) {
      return { type: "error", message: `${LABEL} rejected the API key. Check COMPATIBLE_API_KEY in the .env file and restart the server.` };
    }
    if (err instanceof RateLimitError) {
      return { type: "error", message: `${LABEL} rate limit or quota reached. Wait a moment and retry.` };
    }
    if (err instanceof APIConnectionError) {
      return { type: "error", message: `Could not reach ${LABEL} at ${BASE_URL}. Check that it is running and retry.` };
    }
    if (err instanceof APIError) {
      return { type: "error", message: `${LABEL} returned an error: ${err.message}` };
    }
    console.error(`Unexpected error during a ${LABEL} call:`, err);
    return { type: "error", message: "Unexpected server error during the model call. See the server log." };
  }
}

export const compatible: Provider = {
  id: "compatible",
  label: LABEL,
  modelNames: BASE_URL ? nameList(process.env.COMPATIBLE_MODELS ?? "") : [],
  complete,
};
