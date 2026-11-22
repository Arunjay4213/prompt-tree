// The shape every provider file exports, and the small pieces they share.

import type { ChatMessage, StreamEvent } from "../../shared/api";

export type TerminalEvent = Extract<StreamEvent, { type: "done" | "error" }>;

// How an answer ends: one terminal event for the browser, or "disconnected" when the browser went away
// and there is nobody left to send it to.
export type AnswerEnd = TerminalEvent | { type: "disconnected" };

export type OnText = (text: string) => Promise<void>;

export type ProviderRequest = { system?: string; messages: ChatMessage[] };

// One model provider. `modelNames` is empty when the provider is not configured in the environment.
// `complete` streams text through `onText` and returns how the answer ended, exactly once.
export type Provider = {
  id: "openai" | "anthropic" | "compatible" | "opencode" | "demo";
  label: string;
  modelNames: string[];
  complete: (modelName: string, request: ProviderRequest, onText: OnText, signal: AbortSignal) => Promise<AnswerEnd>;
};

// Reads a comma separated list of model names, for example "gpt-6-luna, gpt-6".
export function nameList(value: string): string[] {
  return value.split(",").map((name) => name.trim()).filter((name) => name !== "");
}
