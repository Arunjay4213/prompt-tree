// Demo provider: no network, no key, no cost. Only offered in demo mode (`--demo` or DEMO_MODE=1).
// It replays answers from the recorded sample conversation (server/demo/sample.json) where a request
// matches it, and otherwise streams a short sample answer that has options, so every feature can be tried.

import type { Conversation } from "../../shared/api";
import { SAMPLE } from "../demo/sample";
import type { AnswerEnd, OnText, Provider, ProviderRequest } from "./common";

// These two must match the start of COMBINE_SYSTEM in src/store.ts and REWRITE_SYSTEM in src/text.ts,
// and the messages parsed below must match combineMessage in src/store.ts and rewriteMessage in src/text.ts.
const COMBINE_START = "You combine pieces";
const PIECES_HEADER = "The selected pieces, in order:\n\n";
const PIECE_HEADING = /^### Piece \d+ \((?:whole answer|excerpt), from the branch "(.*)"\)\n\n/gm;
const INSTRUCTION_HEADER = "\n\n---\n\nHow to combine them: ";
const NO_INSTRUCTION = "\n\n---\n\nNo extra instruction was given.";
const REWRITE_START = "You rewrite one follow-up question";
const OPTIONS_HEADER = "The options, in order:\n";
const QUESTION_HEADER = "\n\n---\n\nThe follow-up question:\n";

const GENERIC_ANSWER = [
  "Demo mode does not call a model, so this is a sample answer. It has the shape of a real one, so every feature can be tried on it.",
  'Its headings become options to branch from when your question asks for options (for example "what are my options?"), and typing "each" in a follow-up brings up Ask each.',
  "### Branch per option\n\nOpen any option below as its own card. Each card only sees its own path back to the first question.",
  "### Ask each\n\nType one question and press Ask each. It becomes one card per option, and all of them are answered at once.",
  "### Combine\n\nAdd the answers you like to the output, then combine them into one document in the Output tab.",
  "- The suggested question on the start screen replays answers recorded from a real model.\n- Any other question gets this sample answer.",
  "For real answers, put an API key in `.env` and start the app with:\n\n```sh\npnpm dev\n```",
].join("\n\n");

// Trimmed, lower case, whitespace collapsed.
function normal(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// All whitespace removed, so an excerpt matches its answer however its lines were joined.
function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

// What the replay rules need from the sample. The options are the branches that leave from the
// root's first turn, in the order they were created, each with its title and first prompt and answer.
type Replay = {
  answersByPrompt: Map<string, string>;
  options: { title: string; prompt: string; answer: string }[];
  askEachQuestion: string | null;
  document: string;
  // Every recorded answer with all whitespace removed, to recognise collected pieces.
  answersSquashed: string[];
};

function replayFrom(conversation: Conversation, askEachQuestion: string | null): Replay {
  const answersByPrompt = new Map<string, string>();
  for (const thread of conversation.threads) {
    for (const turn of thread.turns) answersByPrompt.set(normal(turn.prompt), turn.answer);
  }
  const firstTurnId = conversation.threads[0]!.turns[0]!.id;
  const options = conversation.threads
    .filter((t) => t.parent?.turnId === firstTurnId && t.turns.length > 0)
    .map((t) => ({ title: t.title, prompt: t.turns[0]!.prompt, answer: t.turns[0]!.answer }));
  const answersSquashed = conversation.threads.flatMap((t) => t.turns.map((turn) => squash(turn.answer)));
  return { answersByPrompt, options, askEachQuestion, document: conversation.output.text, answersSquashed };
}

const REPLAY: Replay | null = SAMPLE ? replayFrom(SAMPLE.conversation, SAMPLE.askEachQuestion) : null;

// The collected pieces of a Combine request, in order, each with the title of its branch.
function piecesOf(message: string): { branch: string; text: string }[] {
  const start = message.indexOf(PIECES_HEADER) + PIECES_HEADER.length;
  const end = message.endsWith(NO_INSTRUCTION) ? message.length - NO_INSTRUCTION.length : message.lastIndexOf(INSTRUCTION_HEADER);
  const body = message.slice(start, end);
  const headings = [...body.matchAll(PIECE_HEADING)];
  return headings.map((heading, i) => ({
    branch: heading[1]!,
    text: body.slice(heading.index + heading[0].length, headings[i + 1]?.index ?? body.length).trim(),
  }));
}

// The sample's recorded document when every collected piece comes from the sample's answers,
// otherwise a document that joins the collected pieces in order.
function combineReply(message: string): string {
  const pieces = piecesOf(message);
  const fromSample = REPLAY !== null && pieces.length > 0
    && pieces.every((piece) => REPLAY.answersSquashed.some((answer) => answer.includes(squash(piece.text))));
  if (fromSample) return REPLAY.document;
  return [
    "# Combined document",
    "Demo mode does not call a model, so this document joins the collected items in order. With an API key, the model merges them into one document.",
    ...pieces.map((piece, i) => `## ${i + 1}. ${piece.branch}\n\n${piece.text}`),
  ].join("\n\n");
}

// The Ask each rewrite: one prompt per option, as a JSON array.
function rewriteReply(message: string): string {
  const optionsAt = message.lastIndexOf(OPTIONS_HEADER);
  const questionAt = message.lastIndexOf(QUESTION_HEADER);
  const titles = message
    .slice(optionsAt + OPTIONS_HEADER.length, questionAt)
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  const question = message.slice(questionAt + QUESTION_HEADER.length).trim();
  if (REPLAY && REPLAY.askEachQuestion !== null && normal(question) === normal(REPLAY.askEachQuestion) && REPLAY.options.length === titles.length) {
    return JSON.stringify(REPLAY.options.map((o) => o.prompt));
  }
  // "What does each cost?" about "Trains" becomes "What does Trains cost?".
  // "Which is cheapest?" becomes "For Trains, which is cheapest?".
  const each = /\beach( one| option| of them)?\b/i;
  const lowered = /^[A-Z][a-z]/.test(question) ? question[0]!.toLowerCase() + question.slice(1) : question;
  return JSON.stringify(titles.map((title) => (each.test(question) ? question.replace(each, title) : `For ${title}, ${lowered}`)));
}

function chatReply(prompt: string): string {
  if (REPLAY === null) return GENERIC_ANSWER;
  const recorded = REPLAY.answersByPrompt.get(normal(prompt));
  if (recorded !== undefined) return recorded;
  const lowered = prompt.toLowerCase();
  const option = REPLAY.options.find((o) => lowered.includes(o.title.toLowerCase()));
  return option?.answer ?? GENERIC_ANSWER;
}

// First match wins: Combine, then the Ask each rewrite, then a recorded prompt, then an option title,
// then the sample answer.
function replyFor(request: ProviderRequest): string {
  const prompt = request.messages.at(-1)?.content ?? "";
  if (request.system?.startsWith(COMBINE_START)) return combineReply(prompt);
  if (request.system?.startsWith(REWRITE_START)) return rewriteReply(prompt);
  return chatReply(prompt);
}

async function complete(_modelName: string, request: ProviderRequest, onText: OnText, signal: AbortSignal): Promise<AnswerEnd> {
  const text = replyFor(request);
  // About 100 chunks at 20 ms each: roughly 2 seconds in total.
  const chunkSize = Math.max(4, Math.ceil(text.length / 100));
  for (let start = 0; start < text.length; start += chunkSize) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (signal.aborted) return { type: "disconnected" };
    await onText(text.slice(start, start + chunkSize));
  }
  return { type: "done", outcome: "complete" };
}

export const demo: Provider = {
  id: "demo",
  label: "Demo",
  modelNames: ["demo-a", "demo-b"],
  complete,
};
