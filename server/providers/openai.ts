// OpenAI provider: the Responses API through the official SDK.
// Active when OPENAI_API_KEY is set. Models: OPENAI_MODELS (comma separated); the older single
// OPENAI_MODEL is still honoured when OPENAI_MODELS is not set.

import OpenAI, { APIConnectionError, APIError, AuthenticationError, RateLimitError } from "openai";
import { nameList, type AnswerEnd, type OnText, type Provider, type ProviderRequest } from "./common";

// The SDK reads OPENAI_API_KEY from the environment. Created on first use.
let client: OpenAI | undefined;

async function complete(modelName: string, request: ProviderRequest, onText: OnText, signal: AbortSignal): Promise<AnswerEnd> {
  client ??= new OpenAI();
  try {
    const stream = await client.responses.create(
      { model: modelName, instructions: request.system, input: request.messages, stream: true },
      { signal },
    );
    for await (const event of stream) {
      switch (event.type) {
        case "response.output_text.delta":
          await onText(event.delta);
          break;
        case "response.refusal.done":
          return { type: "error", message: `The model declined to answer: ${event.refusal}` };
        case "response.completed":
          return { type: "done", outcome: "complete" };
        case "response.incomplete": {
          const reason = event.response.incomplete_details?.reason ?? "unknown";
          if (reason === "max_output_tokens") return { type: "done", outcome: "cut_off" };
          return { type: "error", message: `The answer stopped early (reason: ${reason}).` };
        }
        case "response.failed":
          return { type: "error", message: `The model call failed: ${event.response.error?.message ?? "no reason given"}` };
        case "error":
          return { type: "error", message: `The model API reported an error: ${event.message}` };
      }
    }
    if (signal.aborted) return { type: "disconnected" };
    return { type: "error", message: "The model stream ended without a final event." };
  } catch (err) {
    if (signal.aborted) return { type: "disconnected" };
    if (err instanceof AuthenticationError) {
      return { type: "error", message: "The OpenAI API key was rejected. Check OPENAI_API_KEY in the .env file and restart the server." };
    }
    if (err instanceof RateLimitError) {
      return { type: "error", message: "OpenAI rate limit or quota reached. Wait a moment and retry, or check the account's billing." };
    }
    if (err instanceof APIConnectionError) {
      return { type: "error", message: "Could not reach the OpenAI API. Check the internet connection and retry." };
    }
    if (err instanceof APIError) {
      return { type: "error", message: `The OpenAI API returned an error: ${err.message}` };
    }
    console.error("Unexpected error during an OpenAI call:", err);
    return { type: "error", message: "Unexpected server error during the model call. See the server log." };
  }
}

export const openai: Provider = {
  id: "openai",
  label: "OpenAI",
  modelNames: process.env.OPENAI_API_KEY
    ? nameList(process.env.OPENAI_MODELS ?? process.env.OPENAI_MODEL ?? "gpt-6-luna")
    : [],
  complete,
};
