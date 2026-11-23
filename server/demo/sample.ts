// The recorded sample conversation that demo mode ships with (sample.json), plus the one fact a
// conversation does not store: the question that was asked with Ask each (script.json).
// Read once at startup, only in demo mode. Read with fs relative to this file, so it works the same
// under `tsx` in dev and in `pnpm start`.

import { readFileSync } from "node:fs";
import { CONVERSATION_ID_PATTERN } from "../../shared/api";
import type { Conversation } from "../../shared/api";
import { DEMO } from "../env";

export type Sample = { conversation: Conversation; askEachQuestion: string | null };

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
}

function loadSample(): Sample | null {
  let conversation: Conversation;
  try {
    conversation = readJson("./sample.json") as Conversation;
    const first = conversation.threads?.[0]?.turns?.[0];
    if (!CONVERSATION_ID_PATTERN.test(conversation.id) || typeof first?.prompt !== "string" || typeof conversation.output?.text !== "string") {
      throw new Error("it is not a conversation with a first turn and an output");
    }
  } catch (err) {
    console.warn(`Demo mode runs without the sample conversation: server/demo/sample.json could not be read (${(err as Error).message}).`);
    return null;
  }
  let askEachQuestion: string | null = null;
  try {
    const question = (readJson("./script.json") as { askEach?: { question?: unknown } }).askEach?.question;
    if (typeof question === "string") askEachQuestion = question;
  } catch {
    // Without script.json, Ask each in demo mode always builds its prompts from the question.
  }
  return { conversation, askEachQuestion };
}

export const SAMPLE: Sample | null = DEMO ? loadSample() : null;
