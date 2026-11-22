// Produces one answer for /api/complete in the current server mode.
// completeAnswer streams text through `onText` and returns how the answer ended (AnswerEnd),
// so the route can send exactly one "done" or "error" event at the end.

import OpenAI, { APIConnectionError, APIError, AuthenticationError, RateLimitError } from "openai";
import type { CompleteRequest, ServerMode, StreamEvent } from "../shared/api";

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-6-luna";

export type TerminalEvent = Extract<StreamEvent, { type: "done" | "error" }>;
type OnText = (text: string) => Promise<void>;

// How an answer ends: one terminal event for the browser, or "disconnected" when the browser went away
// and there is nobody left to send it to.
export type AnswerEnd = TerminalEvent | { type: "disconnected" };

export function completeAnswer(
  mode: ServerMode,
  request: CompleteRequest,
  onText: OnText,
  signal: AbortSignal,
): Promise<AnswerEnd> {
  switch (mode) {
    case "demo":
      return completeDemo(request, onText, signal);
    case "no_key":
      return Promise.resolve({
        type: "error",
        message: "No OpenAI API key is configured. Put OPENAI_API_KEY in the .env file and restart the server, or run `pnpm dev:demo` for placeholder answers.",
      });
    case "live":
      return completeLive(request, onText, signal);
  }
}

async function completeDemo(request: CompleteRequest, onText: OnText, signal: AbortSignal): Promise<AnswerEnd> {
  const prompt = request.messages.at(-1)?.content ?? "";
  const quoted = prompt.trim().split("\n").map((line) => `> ${line}`).join("\n");
  const intro = request.system === undefined
    ? "This is a placeholder answer from demo mode. No model was called and no money was spent."
    : "This is a placeholder for the combined document. In live mode the model would merge the clips into one final document.";
  const text = [
    `**Demo answer** (turn ${Math.ceil(request.messages.length / 2)}) to:`,
    quoted,
    intro + " The text streams in small pieces so the interface behaves like it does with a real model.",
    "- Each branch only sees its own path back to the root.\n- Continue a card, or branch off to explore a side question.\n- Clip the parts you want for the final output.",
    "```ts\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n```",
    "End of the placeholder answer.",
  ].join("\n\n");

  // About 100 chunks at 20 ms each: roughly 2 seconds in total.
  const chunkSize = Math.max(4, Math.ceil(text.length / 100));
  for (let start = 0; start < text.length; start += chunkSize) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (signal.aborted) return { type: "disconnected" };
    await onText(text.slice(start, start + chunkSize));
  }
  return { type: "done", outcome: "complete" };
}

// The SDK reads OPENAI_API_KEY from the environment. Created on first use so other modes never need a key.
let client: OpenAI | undefined;

async function completeLive(request: CompleteRequest, onText: OnText, signal: AbortSignal): Promise<AnswerEnd> {
  client ??= new OpenAI();
  try {
    const stream = await client.responses.create(
      { model: MODEL, instructions: request.system, input: request.messages, stream: true },
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
    console.error("Unexpected error during model call:", err);
    return { type: "error", message: "Unexpected server error during the model call. See the server log." };
  }
}
