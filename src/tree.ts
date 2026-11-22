// All tree logic as pure functions over Conversation.
// No React and no fetch in this file.

import type { ChatMessage, Clip, Conversation, FinalOutput, Thread, TitleSource, Turn } from "../shared/api";
import { plainPreview } from "./text";

// Canvas geometry, shared by the layout and the card components.
export const CARD_WIDTH = 380;
export const COLUMN_GAP = 72;
export const ROW_GAP = 24;
export const HEADER_HEIGHT = 40;

export const UNTITLED_THREAD = "New branch";
export const UNTITLED_CONVERSATION = "New conversation";

// The answer of an allowed action, or the reason it is not allowed (shown in a tooltip).
export type Allowed = { ok: true } | { ok: false; reason: string };

// ---------- small helpers ----------

export function newId(): string {
  return crypto.randomUUID();
}

const TITLE_MAX = 60;

// A title of at most TITLE_MAX characters: a longer text is cut at the last space before the limit
// and ends in "...". Only a text without any space there is cut inside a word.
function cutTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= TITLE_MAX) return line;
  const room = line.slice(0, TITLE_MAX - 3);
  const space = room.lastIndexOf(" ");
  return `${(space > 0 ? room.slice(0, space) : room).trimEnd()}...`;
}

// The title cut from a prompt: its first line that is not a quote (the user's own words after a
// quoted selection), or else the quoted text without quote marks, list marks or other markdown.
function titleFromPrompt(prompt: string): string {
  const own = prompt.split("\n").find((line) => line.trim() !== "" && !/^\s*>/.test(line));
  if (own !== undefined) return cutTitle(plainPreview(own) || own);
  return cutTitle(plainPreview(prompt.replace(/^\s*>\s?/gm, "")));
}

// The model's reply to a title request, cut down to a title: its first non-empty line without a
// "Title:" label, markdown marks, surrounding quotes or trailing punctuation, cut like any title.
// "" when nothing usable is left.
export function titleFromModel(reply: string): string {
  const line = reply.split("\n").find((l) => l.trim() !== "") ?? "";
  const cleaned = plainPreview(line)
    .replace(/^\s*title\s*:\s*/i, "")
    .replace(/^[\s"'`“”‘’«»]+/, "")
    .replace(/[\s"'`“”‘’«».,;:!?…]+$/, "");
  return cutTitle(cleaned);
}

export function threadTitle(thread: Thread): string {
  return thread.title.trim() || UNTITLED_THREAD;
}

export function conversationTitle(conv: { title: string }): string {
  return conv.title.trim() || UNTITLED_CONVERSATION;
}

export function findThread(conv: Conversation, threadId: string): Thread | undefined {
  return conv.threads.find((t) => t.id === threadId);
}

export function findTurn(conv: Conversation, turnId: string): { thread: Thread; turn: Turn; index: number } | undefined {
  for (const thread of conv.threads) {
    const index = thread.turns.findIndex((t) => t.id === turnId);
    const turn = thread.turns[index];
    if (turn) return { thread, turn, index };
  }
  return undefined;
}

export function rootThread(conv: Conversation): Thread {
  const root = conv.threads[0];
  if (!root) throw new Error("Conversation has no root thread");
  return root;
}

// A conversation is blank while its root thread has no turns: the start box is shown.
export function isBlank(conv: Conversation): boolean {
  return rootThread(conv).turns.length === 0;
}

function replaceThread(conv: Conversation, thread: Thread): Conversation {
  return { ...conv, threads: conv.threads.map((t) => (t.id === thread.id ? thread : t)) };
}

// The branches of a thread in drawn order: by the index of the turn they leave from, then by creation time.
export function childThreads(conv: Conversation, threadId: string): Thread[] {
  const parent = findThread(conv, threadId);
  if (!parent) return [];
  const turnIndex = (turnId: string) => parent.turns.findIndex((t) => t.id === turnId);
  return conv.threads
    .filter((t) => t.parent?.threadId === threadId)
    .sort((a, b) => turnIndex(a.parent!.turnId) - turnIndex(b.parent!.turnId) || a.createdAt - b.createdAt);
}

export function childrenOfTurn(conv: Conversation, turnId: string): Thread[] {
  return conv.threads.filter((t) => t.parent?.turnId === turnId).sort((a, b) => a.createdAt - b.createdAt);
}

// Ids of a thread and every thread below it.
export function subtreeIds(conv: Conversation, threadId: string): Set<string> {
  const ids = new Set<string>([threadId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of conv.threads) {
      if (t.parent && ids.has(t.parent.threadId) && !ids.has(t.id)) {
        ids.add(t.id);
        grew = true;
      }
    }
  }
  return ids;
}

// Root first, then each ancestor down to (and including) the given thread.
export function ancestorPath(conv: Conversation, threadId: string): Thread[] {
  const path: Thread[] = [];
  let current = findThread(conv, threadId);
  while (current) {
    path.unshift(current);
    current = current.parent ? findThread(conv, current.parent.threadId) : undefined;
  }
  return path;
}

// Path numbers: the root is "ROOT", its branches "1", "2" in drawn order, their branches "1.1", "1.2".
export function pathNumbers(conv: Conversation): Record<string, string> {
  const numbers: Record<string, string> = {};
  const visit = (thread: Thread, number: string) => {
    numbers[thread.id] = number;
    childThreads(conv, thread.id).forEach((child, i) => {
      visit(child, thread.parent === null ? `${i + 1}` : `${number}.${i + 1}`);
    });
  };
  visit(rootThread(conv), "ROOT");
  return numbers;
}

export function isInFlight(turn: Turn): boolean {
  return turn.status === "waiting" || turn.status === "streaming";
}

export function threadInFlight(thread: Thread): boolean {
  return thread.turns.some(isInFlight);
}

// A conversation is live while any turn or the combined output is being written.
export function conversationInFlight(conv: Conversation): boolean {
  return conv.threads.some(threadInFlight) || conv.output.status === "waiting" || conv.output.status === "streaming";
}

export function turnCount(conv: Conversation): number {
  return conv.threads.reduce((n, t) => n + t.turns.length, 0);
}

// complete and truncated answers, and stopped answers that have text, can be branched from and are
// sent as context.
export function canBranchFrom(turn: Turn): boolean {
  return turn.status === "complete" || turn.status === "truncated" || (turn.status === "stopped" && turn.answer.trim() !== "");
}

// ---------- create ----------

export function emptyOutput(): FinalOutput {
  return { status: "empty", text: "", instruction: "", error: null, model: null };
}

// `model` is the id of the model that will answer (null when no model is available).
function createTurn(prompt: string, model: string | null, now: number): Turn {
  return { id: newId(), prompt, answer: "", status: "waiting", error: null, model, createdAt: now };
}

function createThread(parent: Thread["parent"], title: string, titleSource: TitleSource, turns: Turn[], now: number): Thread {
  return { id: newId(), parent, title, titleSource, cardView: "open", branchesView: "shown", turns, createdAt: now };
}

// A new conversation has a root thread with no turns. Its first prompt will title it.
export function createConversation(now: number): Conversation {
  return {
    id: newId(),
    title: "",
    titleSource: "prompt",
    createdAt: now,
    updatedAt: now,
    threads: [createThread(null, "", "prompt", [], now)],
    clips: [],
    output: emptyOutput(),
  };
}

// "Continue": append a new turn to the thread.
// The first prompt of an empty root thread re-titles the thread and the conversation.
// The first prompt of an untitled branch titles the branch.
export function appendTurn(
  conv: Conversation,
  threadId: string,
  prompt: string,
  model: string | null,
  now: number,
): { conv: Conversation; turnId: string } {
  const thread = findThread(conv, threadId);
  if (!thread) throw new Error("Thread not found");
  const turn = createTurn(prompt, model, now);
  const emptyRoot = thread.parent === null && thread.turns.length === 0;
  const untitled = thread.turns.length === 0 && thread.title.trim() === "";
  const retitle = emptyRoot || untitled;
  const titled: Thread = retitle ? { ...thread, title: titleFromPrompt(prompt), titleSource: "prompt" } : thread;
  const next = replaceThread(conv, { ...titled, turns: [...thread.turns, turn] });
  return { conv: emptyRoot ? { ...next, title: titleFromPrompt(prompt), titleSource: "prompt" } : next, turnId: turn.id };
}

// "Branch": an empty branch card right after the given turn. A given title (an option's) counts as
// the user's, so it is never replaced automatically.
export function createBranch(
  conv: Conversation,
  threadId: string,
  turnId: string,
  now: number,
  title = "",
): { conv: Conversation; threadId: string } {
  const thread = createThread({ threadId, turnId }, title, title === "" ? "prompt" : "user", [], now);
  return { conv: { ...conv, threads: [...conv.threads, thread] }, threadId: thread.id };
}

// "Another branch from the same message": an empty sibling of a branch, from the same turn.
export function createSiblingBranch(conv: Conversation, threadId: string, now: number): { conv: Conversation; threadId: string } | undefined {
  const parent = findThread(conv, threadId)?.parent;
  return parent ? createBranch(conv, parent.threadId, parent.turnId, now) : undefined;
}

// "Ask each": one branch per option after the given turn, each titled with its option (a user
// title) and holding its first turn, answered by `model`. Returns the new thread and turn ids in order.
export function createOptionBranches(
  conv: Conversation,
  threadId: string,
  turnId: string,
  options: { title: string; prompt: string }[],
  model: string | null,
  now: number,
): { conv: Conversation; threadIds: string[]; turnIds: string[] } {
  const threads = options.map((o, i) => createThread({ threadId, turnId }, o.title, "user", [createTurn(o.prompt, model, now + i)], now + i));
  return { conv: { ...conv, threads: [...conv.threads, ...threads] }, threadIds: threads.map((t) => t.id), turnIds: threads.map((t) => t.turns[0]!.id) };
}

// The branch of a turn made for an option: a child thread of that turn whose title is the option title.
export function optionBranch(conv: Conversation, turnId: string, title: string): Thread | undefined {
  return childrenOfTurn(conv, turnId).find((t) => t.title.trim() === title.trim());
}

// "Branch off": a new branch after the last turn of the thread, holding the new prompt.
export function branchOffWithPrompt(
  conv: Conversation,
  threadId: string,
  prompt: string,
  model: string | null,
  now: number,
): { conv: Conversation; threadId: string; turnId: string } {
  const thread = findThread(conv, threadId);
  const last = thread?.turns.at(-1);
  if (!thread || !last) throw new Error("Nothing to branch from");
  const turn = createTurn(prompt, model, now);
  const branch = createThread({ threadId, turnId: last.id }, titleFromPrompt(prompt), "prompt", [turn], now);
  return { conv: { ...conv, threads: [...conv.threads, branch] }, threadId: branch.id, turnId: turn.id };
}

// The conversation's title and its root thread's title are one title: these set both, with one source.
function setRootTitle(conv: Conversation, title: string, titleSource: TitleSource): Conversation {
  const root = rootThread(conv);
  if (conv.title === title && conv.titleSource === titleSource && root.title === title && root.titleSource === titleSource) return conv;
  return { ...replaceThread(conv, { ...root, title, titleSource }), title, titleSource };
}

// A rename by the user: the title then counts as typed by the user and is never replaced
// automatically. Renaming the root thread renames the conversation too. An empty title changes nothing.
export function renameThread(conv: Conversation, threadId: string, title: string): Conversation {
  const thread = findThread(conv, threadId);
  const trimmed = title.trim();
  if (!thread || trimmed === "") return conv;
  if (thread.parent === null) return setRootTitle(conv, trimmed, "user");
  if (thread.title === trimmed && thread.titleSource === "user") return conv;
  return replaceThread(conv, { ...thread, title: trimmed, titleSource: "user" });
}

// A rename by the user (the top bar). It renames the root thread too. An empty title changes nothing.
export function renameConversation(conv: Conversation, title: string): Conversation {
  const trimmed = title.trim();
  return trimmed === "" ? conv : setRootTitle(conv, trimmed, "user");
}

// ---------- model titles ----------

// The first turn of a thread just finished. It is worth a model title when it finished as complete
// or truncated and the thread's title is still the one cut from the prompt. Returns the thread and the turn.
export function threadToTitle(conv: Conversation, turnId: string): { thread: Thread; turn: Turn } | undefined {
  const found = findTurn(conv, turnId);
  if (!found || found.index !== 0 || found.thread.titleSource !== "prompt") return undefined;
  return found.turn.status === "complete" || found.turn.status === "truncated" ? found : undefined;
}

// prompt -> model. Applied only while the thread exists and its title is still the prompt title:
// the user may have renamed it, or it may have been merged or deleted, while the title was written.
// For the root thread, the conversation takes the same title.
// An empty title changes nothing.
export function applyModelTitle(conv: Conversation, threadId: string, title: string): Conversation {
  const thread = findThread(conv, threadId);
  if (!thread || thread.titleSource !== "prompt" || title === "") return conv;
  if (thread.parent === null) return setRootTitle(conv, title, "model");
  return replaceThread(conv, { ...thread, title, titleSource: "model" });
}

// The setters return the same conversation when nothing changes, so no save is made for it.
export function setCardView(conv: Conversation, threadId: string, cardView: Thread["cardView"]): Conversation {
  const thread = findThread(conv, threadId);
  return thread && thread.cardView !== cardView ? replaceThread(conv, { ...thread, cardView }) : conv;
}

export function setAllCardViews(conv: Conversation, cardView: Thread["cardView"]): Conversation {
  if (conv.threads.every((t) => t.cardView === cardView)) return conv;
  return { ...conv, threads: conv.threads.map((t) => (t.cardView === cardView ? t : { ...t, cardView })) };
}

export function setBranchesView(conv: Conversation, threadId: string, branchesView: Thread["branchesView"]): Conversation {
  const thread = findThread(conv, threadId);
  return thread && thread.branchesView !== branchesView ? replaceThread(conv, { ...thread, branchesView }) : conv;
}

// Makes a thread's card visible: every ancestor that hides its branches shows them again.
// Returns the same conversation when nothing above the thread is hidden.
export function showBranchesAbove(conv: Conversation, threadId: string): Conversation {
  let next = conv;
  for (const ancestor of ancestorPath(conv, threadId).slice(0, -1)) {
    if (ancestor.branchesView === "hidden") next = setBranchesView(next, ancestor.id, "shown");
  }
  return next;
}

// ---------- model context ----------

// The turns a thread inherits from its ancestors: for each ancestor, its turns up to and
// including the turn the child branched from.
export function inheritedTurns(conv: Conversation, threadId: string): { thread: Thread; turn: Turn }[] {
  const path = ancestorPath(conv, threadId);
  const result: { thread: Thread; turn: Turn }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const ancestor = path[i]!;
    const child = path[i + 1]!;
    const cut = ancestor.turns.findIndex((t) => t.id === child.parent?.turnId);
    for (const turn of ancestor.turns.slice(0, cut + 1)) result.push({ thread: ancestor, turn });
  }
  return result;
}

// The inherited turns that are really sent as context (the rest have no answer to send).
export function inheritedContext(conv: Conversation, threadId: string): { thread: Thread; turn: Turn }[] {
  return inheritedTurns(conv, threadId).filter((x) => canBranchFrom(x.turn));
}

// The messages sent to the model for the given turn: its full context, then its own prompt.
export function buildMessages(conv: Conversation, turnId: string): ChatMessage[] {
  const found = findTurn(conv, turnId);
  if (!found) throw new Error("Turn not found");
  const earlier = [
    ...inheritedTurns(conv, found.thread.id).map((x) => x.turn),
    ...found.thread.turns.slice(0, found.index),
  ].filter(canBranchFrom);
  const messages: ChatMessage[] = [];
  for (const turn of earlier) {
    messages.push({ role: "user", content: turn.prompt });
    messages.push({ role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: found.turn.prompt });
  return messages;
}

// ---------- turn status transitions ----------

// Returns the same conversation when `change` returns the same turn.
function updateTurn(conv: Conversation, turnId: string, change: (turn: Turn) => Turn): Conversation {
  const found = findTurn(conv, turnId);
  if (!found) return conv;
  const changed = change(found.turn);
  if (changed === found.turn) return conv;
  const turns = found.thread.turns.map((t) => (t.id === turnId ? changed : t));
  return replaceThread(conv, { ...found.thread, turns });
}

// waiting -> streaming, on the first text
export function appendAnswerText(conv: Conversation, turnId: string, text: string): Conversation {
  return updateTurn(conv, turnId, (t) => (isInFlight(t) ? { ...t, status: "streaming", answer: t.answer + text } : t));
}

// waiting | streaming -> complete
export function completeTurn(conv: Conversation, turnId: string): Conversation {
  return updateTurn(conv, turnId, (t) => (isInFlight(t) ? { ...t, status: "complete" } : t));
}

// waiting | streaming -> truncated (the model hit its output length limit; the text is kept)
export function truncateTurn(conv: Conversation, turnId: string): Conversation {
  return updateTurn(conv, turnId, (t) => (isInFlight(t) ? { ...t, status: "truncated" } : t));
}

// waiting | streaming -> stopped (the partial answer is kept)
export function stopTurn(conv: Conversation, turnId: string): Conversation {
  return updateTurn(conv, turnId, (t) => (isInFlight(t) ? { ...t, status: "stopped" } : t));
}

// waiting | streaming -> failed (the answer is cleared, the reason is kept)
export function failTurn(conv: Conversation, turnId: string, reason: string): Conversation {
  return updateTurn(conv, turnId, (t) => (isInFlight(t) ? { ...t, status: "failed", answer: "", error: reason } : t));
}

// waiting | streaming -> stopped (if it has text) or failed "Interrupted"
export function interruptTurn(conv: Conversation, turnId: string): Conversation {
  return updateTurn(conv, turnId, (t) => {
    if (!isInFlight(t)) return t;
    return t.answer.trim() !== "" ? { ...t, status: "stopped" } : { ...t, status: "failed", answer: "", error: "Interrupted" };
  });
}

// Retry and remove apply to a failed or stopped last turn that no branch leaves from.
function lastTurnActionAllowed(conv: Conversation, turnId: string, verb: string): Allowed {
  const found = findTurn(conv, turnId);
  if (!found) return { ok: false, reason: "Turn not found" };
  if (found.turn.status !== "failed" && found.turn.status !== "stopped") {
    return { ok: false, reason: `Only a failed or stopped message can be ${verb}` };
  }
  if (found.index !== found.thread.turns.length - 1) return { ok: false, reason: `Only the last message of a card can be ${verb}` };
  if (childrenOfTurn(conv, turnId).length > 0) return { ok: false, reason: `A message that has branches cannot be ${verb}` };
  return { ok: true };
}

export function retryAllowed(conv: Conversation, turnId: string): Allowed {
  return lastTurnActionAllowed(conv, turnId, "retried");
}

export function removeAllowed(conv: Conversation, turnId: string): Allowed {
  return lastTurnActionAllowed(conv, turnId, "removed");
}

// failed | stopped -> waiting (the same prompt runs again, answered by `model`). The turn's excerpt
// clips are removed: their text came from the old answer. A whole-answer clip stays and follows the new answer.
export function retryTurn(conv: Conversation, turnId: string, model: string | null): Conversation {
  if (!retryAllowed(conv, turnId).ok) return conv;
  const next = updateTurn(conv, turnId, (t) => ({ ...t, status: "waiting", answer: "", error: null, model }));
  return { ...next, clips: next.clips.filter((c) => !(c.kind === "excerpt" && c.turnId === turnId)) };
}

export function excerptClips(conv: Conversation, turnId: string): Clip[] {
  return conv.clips.filter((c) => c.kind === "excerpt" && c.turnId === turnId);
}

export function removeTurn(conv: Conversation, turnId: string): Conversation {
  const found = findTurn(conv, turnId);
  if (!found || !removeAllowed(conv, turnId).ok) return conv;
  const thread = { ...found.thread, turns: found.thread.turns.filter((t) => t.id !== turnId) };
  return { ...replaceThread(conv, thread), clips: conv.clips.filter((c) => c.turnId !== turnId) };
}

// ---------- output status transitions ----------

export function outputInFlight(output: FinalOutput): boolean {
  return output.status === "waiting" || output.status === "streaming";
}

// any -> waiting (a new combine run, written by `model`)
export function startOutput(conv: Conversation, model: string | null): Conversation {
  return { ...conv, output: { ...conv.output, status: "waiting", text: "", error: null, model } };
}

// waiting -> streaming, on the first text
export function appendOutputText(conv: Conversation, text: string): Conversation {
  const o = conv.output;
  if (!outputInFlight(o)) return conv;
  return { ...conv, output: { ...o, status: "streaming", text: o.text + text } };
}

function finishOutput(conv: Conversation, status: "complete" | "truncated" | "stopped"): Conversation {
  if (!outputInFlight(conv.output)) return conv;
  return { ...conv, output: { ...conv.output, status } };
}

export function completeOutput(conv: Conversation): Conversation {
  return finishOutput(conv, "complete");
}

export function truncateOutput(conv: Conversation): Conversation {
  return finishOutput(conv, "truncated");
}

export function stopOutput(conv: Conversation): Conversation {
  return finishOutput(conv, "stopped");
}

export function failOutput(conv: Conversation, reason: string): Conversation {
  const o = conv.output;
  if (!outputInFlight(o)) return conv;
  return { ...conv, output: { ...o, status: "failed", text: "", error: reason } };
}

export function interruptOutput(conv: Conversation): Conversation {
  const o = conv.output;
  if (!outputInFlight(o)) return conv;
  return o.text.trim() !== "" ? finishOutput(conv, "stopped") : failOutput(conv, "Interrupted");
}

export function setOutputInstruction(conv: Conversation, instruction: string): Conversation {
  return conv.output.instruction === instruction ? conv : { ...conv, output: { ...conv.output, instruction } };
}

// ---------- recovery on load ----------

// Conversations saved before title sources existed have none. Their titles count as typed by the
// user, so an old conversation is never retitled automatically.
function addMissingTitleSources(conv: Conversation): Conversation {
  const missing = (x: { titleSource?: TitleSource }) => x.titleSource === undefined;
  if (!missing(conv) && !conv.threads.some(missing)) return conv;
  return {
    ...conv,
    titleSource: missing(conv) ? "user" : conv.titleSource,
    threads: conv.threads.map((t) => (missing(t) ? { ...t, titleSource: "user" } : t)),
  };
}

// Turns and outputs saved before models were recorded have no `model`: it is filled in as null
// (the interface then shows ASSISTANT).
function addMissingModels(conv: Conversation): Conversation {
  const missing = (x: { model?: string | null }) => x.model === undefined;
  if (!missing(conv.output) && !conv.threads.some((t) => t.turns.some(missing))) return conv;
  return {
    ...conv,
    output: missing(conv.output) ? { ...conv.output, model: null } : conv.output,
    threads: conv.threads.map((t) => (t.turns.some(missing) ? { ...t, turns: t.turns.map((u) => (missing(u) ? { ...u, model: null } : u)) } : t)),
  };
}

// No turn may stay waiting or streaming after a reload. Missing title sources and models are
// filled in. Empty branches stay: the store drops the ones without a draft (discardEmptyBranches).
// Returns the same object when nothing needed recovering.
export function recoverConversation(conv: Conversation): Conversation {
  let next = addMissingModels(addMissingTitleSources(conv));
  if (next.threads.length === 0) {
    next = { ...next, threads: [createThread(null, next.title, next.titleSource, [], next.createdAt)] };
  }
  for (const thread of next.threads) {
    for (const turn of thread.turns) {
      if (isInFlight(turn)) next = interruptTurn(next, turn.id);
    }
  }
  return interruptOutput(next);
}

// Drops the empty branches (made by "Branch" and never used) except those in `keep` (they hold a draft).
export function discardEmptyBranches(conv: Conversation, keep: Set<string>): Conversation {
  let next = conv;
  for (const thread of conv.threads) {
    if (thread.parent !== null && thread.turns.length === 0 && !keep.has(thread.id)) next = deleteThread(next, thread.id);
  }
  return next;
}

// ---------- split and merge ----------

// Move turns (and everything that points at them) from one thread to another.
function repointMovedTurns(conv: Conversation, movedTurnIds: Set<string>, toThreadId: string): Conversation {
  return {
    ...conv,
    threads: conv.threads.map((t) =>
      t.parent && movedTurnIds.has(t.parent.turnId) ? { ...t, parent: { threadId: toThreadId, turnId: t.parent.turnId } } : t,
    ),
    clips: conv.clips.map((c) => (movedTurnIds.has(c.turnId) ? { ...c, threadId: toThreadId } : c)),
  };
}

export function splitAllowed(conv: Conversation, threadId: string, turnId: string): Allowed {
  const thread = findThread(conv, threadId);
  const index = thread?.turns.findIndex((t) => t.id === turnId) ?? -1;
  if (!thread || index < 0) return { ok: false, reason: "Turn not found" };
  if (index === 0) return { ok: false, reason: "The first message of a card is where the card starts" };
  const previous = thread.turns[index - 1]!;
  if (!canBranchFrom(previous)) return { ok: false, reason: "The message before this one has no answer to branch from" };
  return { ok: true };
}

// "Split off from here": this turn and the later turns of the card move into a new branch card
// that branches from the turn before it. Every turn keeps exactly the same model context.
export function splitOff(conv: Conversation, threadId: string, turnId: string, now: number): { conv: Conversation; threadId: string } {
  if (!splitAllowed(conv, threadId, turnId).ok) return { conv, threadId };
  const thread = findThread(conv, threadId)!;
  const index = thread.turns.findIndex((t) => t.id === turnId);
  const kept = thread.turns.slice(0, index);
  const moved = thread.turns.slice(index);
  const branch = createThread({ threadId, turnId: kept.at(-1)!.id }, titleFromPrompt(moved[0]!.prompt), "prompt", moved, now);
  let next = replaceThread(conv, { ...thread, turns: kept });
  next = { ...next, threads: [...next.threads, branch] };
  next = repointMovedTurns(next, new Set(moved.map((t) => t.id)), branch.id);
  return { conv: next, threadId: branch.id };
}

export function mergeAllowed(conv: Conversation, threadId: string): Allowed {
  const thread = findThread(conv, threadId);
  if (!thread) return { ok: false, reason: "Thread not found" };
  if (!thread.parent) return { ok: false, reason: "The root card has no parent to merge into" };
  const parent = findThread(conv, thread.parent.threadId);
  if (!parent) return { ok: false, reason: "Parent card not found" };
  if (parent.turns.at(-1)?.id !== thread.parent.turnId) {
    return { ok: false, reason: "Only a branch from the last message of its parent can merge into it" };
  }
  if (thread.turns.length === 0) return { ok: false, reason: "This card has no messages yet" };
  if (threadInFlight(parent)) return { ok: false, reason: "The parent card has an answer in progress" };
  return { ok: true };
}

// "Merge into parent": append the card's turns to its parent card. Every turn keeps the same context.
export function mergeIntoParent(conv: Conversation, threadId: string): { conv: Conversation; threadId: string } {
  if (!mergeAllowed(conv, threadId).ok) return { conv, threadId };
  const thread = findThread(conv, threadId)!;
  const parent = findThread(conv, thread.parent!.threadId)!;
  let next = replaceThread(conv, { ...parent, turns: [...parent.turns, ...thread.turns] });
  next = { ...next, threads: next.threads.filter((t) => t.id !== thread.id) };
  next = repointMovedTurns(next, new Set(thread.turns.map((t) => t.id)), parent.id);
  return { conv: next, threadId: parent.id };
}

// ---------- delete ----------

// Deletes the thread, its whole subtree, and the clips that point into it. The root cannot be deleted.
export function deleteThread(conv: Conversation, threadId: string): Conversation {
  const thread = findThread(conv, threadId);
  if (!thread || thread.parent === null) return conv;
  const ids = subtreeIds(conv, threadId);
  return {
    ...conv,
    threads: conv.threads.filter((t) => !ids.has(t.id)),
    clips: conv.clips.filter((c) => !ids.has(c.threadId)),
  };
}

// ---------- clips ----------

export function answerClip(conv: Conversation, turnId: string): Clip | undefined {
  return conv.clips.find((c) => c.kind === "answer" && c.turnId === turnId);
}

export function toggleAnswerClip(conv: Conversation, threadId: string, turnId: string): Conversation {
  const existing = answerClip(conv, turnId);
  if (existing) return { ...conv, clips: conv.clips.filter((c) => c.id !== existing.id) };
  return { ...conv, clips: [...conv.clips, { id: newId(), kind: "answer", threadId, turnId }] };
}

// An excerpt identical to one already taken from the same turn is not added twice.
export function addExcerptClip(conv: Conversation, threadId: string, turnId: string, text: string): Conversation {
  if (excerptClips(conv, turnId).some((c) => c.kind === "excerpt" && c.text === text)) return conv;
  return { ...conv, clips: [...conv.clips, { id: newId(), kind: "excerpt", threadId, turnId, text }] };
}

export function removeClip(conv: Conversation, clipId: string): Conversation {
  return conv.clips.some((c) => c.id === clipId) ? { ...conv, clips: conv.clips.filter((c) => c.id !== clipId) } : conv;
}

// Moves a clip to a new position in the list (drag to reorder, or Move up and down by one).
export function moveClipTo(conv: Conversation, clipId: string, toIndex: number): Conversation {
  const from = conv.clips.findIndex((c) => c.id === clipId);
  if (from < 0 || toIndex < 0 || toIndex >= conv.clips.length || toIndex === from) return conv;
  const clips = [...conv.clips];
  const [clip] = clips.splice(from, 1);
  clips.splice(toIndex, 0, clip!);
  return { ...conv, clips };
}

export function clipText(conv: Conversation, clip: Clip): string {
  if (clip.kind === "excerpt") return clip.text;
  return findTurn(conv, clip.turnId)?.turn.answer ?? "";
}

export function clipsAsMarkdown(conv: Conversation): string {
  return conv.clips
    .map((clip) => {
      const thread = findThread(conv, clip.threadId);
      return `## ${thread ? threadTitle(thread) : "Clip"}\n\n${clipText(conv, clip).trim()}`;
    })
    .join("\n\n");
}

// ---------- visible threads and layout ----------

// Threads that are drawn: everything except the threads under a card whose branches are hidden.
export function visibleThreads(conv: Conversation): Thread[] {
  const result: Thread[] = [];
  const visit = (thread: Thread) => {
    result.push(thread);
    if (thread.branchesView === "hidden") return;
    for (const child of childThreads(conv, thread.id)) visit(child);
  };
  visit(rootThread(conv));
  return result;
}

// How many threads are hidden below a card whose branches are hidden.
export function hiddenBranchCount(conv: Conversation, threadId: string): number {
  return subtreeIds(conv, threadId).size - 1;
}

// The measured size of one card: its height, and for each turn the y offset of its port
// (where a branch edge leaves) from the top of the card.
export type CardSize = { height: number; ports: Record<string, number> };

// Left to right tree. Each branch card's header is centered on the port of the turn it leaves from,
// unless that would overlap the subtree of the sibling above it; then it sits ROW_GAP below that subtree.
// A card whose size is not measured yet uses `fallbackHeight` and a port at the header center.
export function layoutTree(
  conv: Conversation,
  sizes: Record<string, CardSize>,
  fallbackHeight: number,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  // Places the thread and its visible subtree, and returns the bottom of that subtree.
  const place = (thread: Thread, depth: number, top: number): number => {
    positions[thread.id] = { x: depth * (CARD_WIDTH + COLUMN_GAP), y: top };
    const size = sizes[thread.id];
    let bottom = top + (size?.height ?? fallbackHeight);
    if (thread.branchesView === "hidden") return bottom;
    let previousBottom = -Infinity;
    for (const child of childThreads(conv, thread.id)) {
      const port = size?.ports[child.parent!.turnId] ?? HEADER_HEIGHT / 2;
      const desiredTop = Math.max(top, top + port - HEADER_HEIGHT / 2);
      const childTop = Math.max(desiredTop, previousBottom + ROW_GAP);
      previousBottom = place(child, depth + 1, childTop);
    }
    bottom = Math.max(bottom, previousBottom);
    return bottom;
  };
  place(rootThread(conv), 0, 0);
  return positions;
}
