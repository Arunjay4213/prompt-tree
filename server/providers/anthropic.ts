// Anthropic provider: Claude through the official SDK, streaming the Messages API.
// Active when ANTHROPIC_API_KEY is set. Models: ANTHROPIC_MODELS (comma separated).
// No thinking or sampling settings are sent: current models think adaptively by default and
// reject several of those fields.

import Anthropic, { APIConnectionError, APIError, AuthenticationError, RateLimitError } from "@anthropic-ai/sdk";
import { nameList, type AnswerEnd, type OnText, type Provider, type ProviderRequest } from "./common";

const MAX_TOKENS = 64000;

// Models that support server-side refusal fallback. A refused answer is continued by a fallback
// model inside the same call. Every other model uses the plain messages stream.
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

// The SDK reads ANTHROPIC_API_KEY from the environment. Created on first use.
let client: Anthropic | undefined;

async function sendText(
  events: AsyncIterable<Anthropic.MessageStreamEvent | Anthropic.Beta.BetaRawMessageStreamEvent>,
  onText: OnText,
): Promise<void> {
  for await (const event of events) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") await onText(event.delta.text);
  }
}

// Streams one answer and returns the final message (its stop reason decides how the answer ended).
async function streamAnswer(client: Anthropic, modelName: string, request: ProviderRequest, onText: OnText, signal: AbortSignal) {
  const body = {
    model: modelName,
    max_tokens: MAX_TOKENS,
    system: request.system,
    messages: request.messages,
    cache_control: { type: "ephemeral" as const }, // history shared between branches is a cacheable prefix
  };
  if (FALLBACK_MODELS.has(modelName)) {
    const stream = client.beta.messages.stream(
      { ...body, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
      { signal },
    );
    await sendText(stream, onText);
    return stream.finalMessage();
  }
  const stream = client.messages.stream(body, { signal });
  await sendText(stream, onText);
  return stream.finalMessage();
}

async function complete(modelName: string, request: ProviderRequest, onText: OnText, signal: AbortSignal): Promise<AnswerEnd> {
  client ??= new Anthropic();
  try {
    const message = await streamAnswer(client, modelName, request, onText, signal);
    switch (message.stop_reason) {
      case "end_turn":
      case "stop_sequence":
        return { type: "done", outcome: "complete" };
      case "max_tokens":
        return { type: "done", outcome: "cut_off" };
      case "refusal": {
        const explanation = message.stop_details?.explanation;
        return { type: "error", message: `The model declined to answer.${explanation ? ` ${explanation}` : ""}` };
      }
      default:
        return { type: "error", message: `The answer stopped early (reason: ${message.stop_reason ?? "unknown"}).` };
    }
  } catch (err) {
    if (signal.aborted) return { type: "disconnected" };
    if (err instanceof AuthenticationError) {
      return { type: "error", message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the .env file and restart the server." };
    }
    if (err instanceof RateLimitError) {
      return { type: "error", message: "Anthropic rate limit reached. Wait a moment and retry, or check the account's limits." };
    }
    if (err instanceof APIConnectionError) {
      return { type: "error", message: "Could not reach the Anthropic API. Check the internet connection and retry." };
    }
    if (err instanceof APIError) {
      return { type: "error", message: `The Anthropic API returned an error: ${err.message}` };
    }
    console.error("Unexpected error during an Anthropic call:", err);
    return { type: "error", message: "Unexpected server error during the model call. See the server log." };
  }
}

export const anthropic: Provider = {
  id: "anthropic",
  label: "Anthropic",
  modelNames: process.env.ANTHROPIC_API_KEY
    ? nameList(process.env.ANTHROPIC_MODELS ?? "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5")
    : [],
  complete,
};
