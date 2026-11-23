// One zustand store: the loaded conversations (a cache keyed by id), which one is open, the
// conversation list, selection, UI preferences, server health, and named actions that call the
// pure functions in tree.ts. Streaming and saving live here and work per conversation, so a
// conversation keeps streaming and saving while another one is open.

import { create } from "zustand";
import type { ChatMessage, Conversation, ConversationSummary, Health, ModelInfo, StreamEvent, Thread } from "../shared/api";
import * as api from "./api";
import { answerOptions, copyText, fallbackPrompts, parseRewrite, REWRITE_SYSTEM, rewriteMessage } from "./text";
import * as tree from "./tree";

export type HealthState = { kind: "loading" } | { kind: "ready"; health: Health } | { kind: "unreachable" };
export type ListState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; reason: string };
// Opening a conversation that is not in the cache yet.
export type OpenState = { kind: "idle" } | { kind: "loading"; id: string } | { kind: "failed"; id: string; reason: string };
// saved:    everything is on the server.
// saving:   changes wait for a save, or one is running.
// failed:   the last save failed; it is retried every few seconds.
// conflict: the server holds a newer version (another tab or window saved it), or it was deleted
//           there (currentUpdatedAt null). Automatic saving stops until the user decides.
export type SaveState =
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "failed" }
  | { kind: "conflict"; currentUpdatedAt: number | null };
const SAVED: SaveState = { kind: "saved" };
const SAVING: SaveState = { kind: "saving" };
const FAILED: SaveState = { kind: "failed" };
export type PanelTab = "thread" | "output";
// none:   the server offers no model (health not loaded yet, no provider set up, or unreachable).
// chosen: the model the next message, retry fallback and Combine use.
export type ModelChoice = { kind: "none" } | { kind: "chosen"; id: string };
// "Ask each" on a thread while its rewrite request runs: where the branches will go, and for which options.
export type SplitState = { kind: "splitting"; conversationId: string; turnId: string; options: string[] };
// The first-use tip: dismissed for good, or waiting under the first answer of the first conversation
// this browser started (conversationId null until that conversation exists).
export type FirstUseTip = { kind: "dismissed" } | { kind: "pending"; conversationId: string | null };
export type SidebarView = "shown" | "collapsed";
// A request for the canvas to move its view. The tick makes a repeated request a new one.
// reveal: pan only if the card is off screen. center: center the card. fit: fit the whole visible tree.
export type ViewRequest =
  | { kind: "reveal"; threadId: string; tick: number }
  | { kind: "center"; threadId: string; tick: number }
  | { kind: "fit"; tick: number };
// "hidden" keeps the last text so the toast can fade out with it.
export type ToastState = { kind: "hidden"; text: string } | { kind: "shown"; text: string };

export const PANEL_MIN_WIDTH = 380;
const PANEL_MAX_SHARE = 0.7; // of the window: the widest the panel goes, and reading mode
const PANEL_DEFAULT_MIN = 560;
const PANEL_DEFAULT_MAX = 820;
const SIDEBAR_WIDTH = 248;
// default: half of the area right of the sidebar, 560 to 820. set: a width the person dragged to.
export type PanelSize = { kind: "default" } | { kind: "set"; width: number };
// normal: the panel at its size. reading: the panel at 70% of the window for reading.
export type PanelMode = "normal" | "reading";
const NARROW_WINDOW = 1100;
const TOAST_MS = 1800;

type State = {
  health: HealthState;
  listState: ListState;
  list: ConversationSummary[]; // newest first, as the server returns it
  conversations: Record<string, Conversation>; // loaded conversations, open or streaming in the background
  openId: string | null; // null only before boot has picked a conversation
  openState: OpenState;
  saveStates: Record<string, SaveState>;
  modelChoice: ModelChoice;
  splits: Record<string, SplitState>; // by thread id
  tip: FirstUseTip;
  selectedThreadId: string | null; // a thread of the open conversation
  tab: PanelTab;
  drafts: Record<string, string>; // the composer text of each thread, by thread id (also kept in localStorage)
  composerFocusTick: number;
  viewRequest: ViewRequest | null;
  sidebar: SidebarView;
  panelSize: PanelSize;
  panelMode: PanelMode;
  panelWidth: number; // the width the panel has now, from panelSize, panelMode and the window (panelWidthFor)
  toast: ToastState;
};

// ---------- preferences in localStorage ----------

const PREF_SIDEBAR = "prompt-tree:sidebar";
const PREF_PANEL_WIDTH = "prompt-tree:panel-width";
const PREF_PANEL_MODE = "prompt-tree:panel-mode";
const PREF_TIP = "prompt-tree:tip";
const PREF_FIRST_CONVERSATION = "prompt-tree:first-conversation";
const PREF_LAST_CONVERSATION = "prompt-tree:last-conversation";
const PREF_MODEL = "prompt-tree:model";

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable; preferences are only a convenience
  }
}

// The widest the panel may be in a window of this width.
export function panelMaxWidth(windowWidth: number): number {
  return Math.max(PANEL_MIN_WIDTH, Math.floor(windowWidth * PANEL_MAX_SHARE));
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

// The panel's width for its size, its mode, the sidebar and the window. A stored width stays valid
// when the window shrinks: it is clamped here, every time.
function panelWidthFor(size: PanelSize, mode: PanelMode, sidebar: SidebarView, windowWidth: number): number {
  const max = panelMaxWidth(windowWidth);
  if (mode === "reading") return max;
  if (size.kind === "set") return clamp(size.width, PANEL_MIN_WIDTH, max);
  const area = windowWidth - (sidebar === "shown" ? SIDEBAR_WIDTH : 0);
  return clamp(clamp(area / 2, PANEL_DEFAULT_MIN, PANEL_DEFAULT_MAX), PANEL_MIN_WIDTH, max);
}

function initialSidebar(): SidebarView {
  if (window.innerWidth < NARROW_WINDOW) return "collapsed";
  return readPref(PREF_SIDEBAR) === "collapsed" ? "collapsed" : "shown";
}

function initialPanelSize(): PanelSize {
  const stored = Number(readPref(PREF_PANEL_WIDTH));
  return Number.isFinite(stored) && stored > 0 ? { kind: "set", width: stored } : { kind: "default" };
}

function initialPanelMode(): PanelMode {
  return readPref(PREF_PANEL_MODE) === "reading" ? "reading" : "normal";
}

// ---------- the store ----------

export const useStore = create<State>(() => ({
  health: { kind: "loading" },
  listState: { kind: "loading" },
  list: [],
  conversations: {},
  openId: null,
  openState: { kind: "idle" },
  saveStates: {},
  modelChoice: { kind: "none" },
  splits: {},
  tip: readPref(PREF_TIP) === "dismissed" ? { kind: "dismissed" } : { kind: "pending", conversationId: readPref(PREF_FIRST_CONVERSATION) },
  selectedThreadId: null,
  tab: "thread",
  drafts: {},
  composerFocusTick: 0,
  viewRequest: null,
  sidebar: initialSidebar(),
  panelSize: initialPanelSize(),
  panelMode: initialPanelMode(),
  panelWidth: panelWidthFor(initialPanelSize(), initialPanelMode(), initialSidebar(), window.innerWidth),
  toast: { kind: "hidden", text: "" },
}));

const get = useStore.getState;
const set = useStore.setState;

// ---------- selectors ----------

export function selectOpenConversation(s: State): Conversation | undefined {
  return s.openId === null ? undefined : s.conversations[s.openId];
}

const NO_MODELS: ModelInfo[] = [];

// The models the server offers (none until health has loaded).
export function selectModels(s: State): ModelInfo[] {
  // `?? NO_MODELS`: a server from before model providers sends no list.
  return s.health.kind === "ready" ? (s.health.health.models ?? NO_MODELS) : NO_MODELS;
}

export function selectOpenSaveState(s: State): SaveState {
  return s.openId === null ? SAVED : (s.saveStates[s.openId] ?? SAVED);
}

// Whether a conversation has a turn or the combined output in flight (the sidebar's live dot).
export function selectIsLive(id: string): (s: State) => boolean {
  return (s) => {
    const conv = s.conversations[id];
    return conv !== undefined && tree.conversationInFlight(conv);
  };
}

function inList(id: string): boolean {
  return get().list.some((c) => c.id === id);
}

// ---------- changing a conversation ----------

// edit:   saved about 500 ms after the last change
// stream: saved at most every 2 seconds while text streams in
// now:    saved right away (a turn or the output finished)
type SaveKind = "edit" | "stream" | "now";

// Every change to a conversation goes through here. It updates the cache and schedules a save.
// A conversation that is no longer in the cache (deleted) is left alone.
function writeConversation(id: string, change: (conv: Conversation) => Conversation, save: SaveKind = "edit") {
  const conv = get().conversations[id];
  if (!conv) return;
  const next = change(conv);
  if (next === conv) return;
  set((s) => ({ conversations: { ...s.conversations, [id]: next } }));
  markChanged(id, save);
}

function writeOpen(change: (conv: Conversation) => Conversation, save: SaveKind = "edit") {
  const id = get().openId;
  if (id !== null) writeConversation(id, change, save);
}

function openConversationNow(): Conversation | undefined {
  return selectOpenConversation(get());
}

// ---------- saving, per conversation ----------

type Handle = ReturnType<typeof setTimeout>;
// The delayed save: none due, one after an edit (500 ms), or one while text streams (2 s).
type SaveTimer = { kind: "none" } | { kind: "edit"; handle: Handle } | { kind: "stream"; handle: Handle };
// After a failed save, the next attempt runs on its own every SAVE_RETRY_MS until one succeeds.
type RetryTimer = { kind: "none" } | { kind: "waiting"; handle: Handle };
type SaveSlot = { timer: SaveTimer; retry: RetryTimer; chain: Promise<void> };
const NO_TIMER = { kind: "none" } as const;
const SAVE_RETRY_MS = 5000;
const saveSlots = new Map<string, SaveSlot>();
// The stored version each cached conversation's next save is based on (sent as X-Base-Version):
// "new" for a conversation made in this tab, else the updatedAt it was loaded with or last saved as.
const baseVersions = new Map<string, api.BaseVersion>();
const unsaved = new Set<string>(); // ids with changes that no save has picked up yet

function slotFor(id: string): SaveSlot {
  let slot = saveSlots.get(id);
  if (!slot) {
    slot = { timer: NO_TIMER, retry: NO_TIMER, chain: Promise.resolve() };
    saveSlots.set(id, slot);
  }
  return slot;
}

function setSaveState(id: string, state: SaveState) {
  const current = get().saveStates[id];
  if (current && current.kind === state.kind && (current.kind !== "conflict" || current === state)) return;
  set((s) => ({ saveStates: { ...s.saveStates, [id]: state } }));
}

function inConflict(id: string): boolean {
  return get().saveStates[id]?.kind === "conflict";
}

// In a conflict the change is kept for a later "Keep this tab's version", but nothing is saved.
function markChanged(id: string, kind: SaveKind) {
  unsaved.add(id);
  if (inConflict(id)) return;
  setSaveState(id, SAVING);
  scheduleSave(id, kind);
}

function clearSaveTimer(slot: SaveSlot) {
  if (slot.timer.kind !== "none") clearTimeout(slot.timer.handle);
  slot.timer = NO_TIMER;
}

function clearRetryTimer(slot: SaveSlot) {
  if (slot.retry.kind !== "none") clearTimeout(slot.retry.handle);
  slot.retry = NO_TIMER;
}

// One retry timer per conversation. It only saves if the conversation still exists and still has
// changes that no other save has picked up.
function scheduleRetry(id: string) {
  const slot = slotFor(id);
  if (slot.retry.kind === "waiting") return;
  const handle = setTimeout(() => {
    slot.retry = NO_TIMER;
    if (get().conversations[id] && unsaved.has(id) && !inConflict(id)) saveNow(id);
  }, SAVE_RETRY_MS);
  slot.retry = { kind: "waiting", handle };
}

function scheduleSave(id: string, kind: SaveKind) {
  const slot = slotFor(id);
  if (kind === "now") {
    clearSaveTimer(slot);
    saveNow(id);
    return;
  }
  if (kind === "stream") {
    if (slot.timer.kind === "none") slot.timer = { kind: "stream", handle: setTimeout(() => fireSave(id), 2000) };
    return;
  }
  if (slot.timer.kind === "stream") return; // a save is already due soon
  clearSaveTimer(slot);
  slot.timer = { kind: "edit", handle: setTimeout(() => fireSave(id), 500) };
}

function fireSave(id: string) {
  slotFor(id).timer = NO_TIMER;
  saveNow(id);
}

// Saves of one conversation run one after another, so an older body never overwrites a newer one.
// A blank conversation that was never stored is not stored. `keepalive` lets a save started while
// the page is being hidden or closed finish after the page is gone.
function saveNow(id: string, keepalive = false) {
  const slot = slotFor(id);
  slot.chain = slot.chain.then(async () => {
    const conv = get().conversations[id];
    if (!conv || !unsaved.has(id) || inConflict(id)) return;
    unsaved.delete(id);
    if (tree.isBlank(conv) && !inList(id)) {
      setSaveState(id, SAVED);
      return;
    }
    const base = baseVersions.get(id);
    if (base === undefined) return; // every cached conversation has a base version; nothing to save otherwise
    const stamped = { ...conv, updatedAt: Date.now() };
    try {
      const result = await api.saveConversation(stamped, base, keepalive);
      if (result.kind === "conflict") {
        // Another tab or window saved a newer version, or deleted it: stop saving and ask.
        unsaved.add(id);
        clearSaveTimer(slot);
        clearRetryTimer(slot);
        if (get().conversations[id]) setSaveState(id, { kind: "conflict", currentUpdatedAt: result.currentUpdatedAt });
        return;
      }
      baseVersions.set(id, stamped.updatedAt);
      clearRetryTimer(slot);
      if (!get().conversations[id]) return; // deleted while saving
      const summary = { id, title: stamped.title, updatedAt: stamped.updatedAt };
      set((s) => ({ list: [summary, ...s.list.filter((c) => c.id !== id)] }));
      if (!unsaved.has(id)) setSaveState(id, SAVED);
    } catch {
      unsaved.add(id); // retried by the retry timer, or sooner with the next change
      setSaveState(id, FAILED);
      if (get().conversations[id]) scheduleRetry(id);
    }
  });
}

// ---------- streaming ----------

// turn and output stream into the conversation. title is collected silently and applied at the end;
// it is not a turn, so it never makes the conversation live and never blocks the composer.
type StreamTarget =
  | { kind: "turn"; conversationId: string; turnId: string }
  | { kind: "output"; conversationId: string }
  | { kind: "title"; conversationId: string; threadId: string }
  | { kind: "rewrite"; conversationId: string; threadId: string };
type ShownTarget = Exclude<StreamTarget, { kind: "title" } | { kind: "rewrite" }>;
type StreamEnd =
  | { kind: "complete" }
  | { kind: "truncated" }
  | { kind: "failed"; reason: string }
  | { kind: "stopped" }
  | { kind: "interrupted" }; // the stream ended without a final event

// Key: the turn id, "output:<conversation id>", "title:<thread id>", or "rewrite:<thread id>".
const streams = new Map<string, { target: StreamTarget; controller: AbortController }>();
const pendingText = new Map<string, { target: ShownTarget; text: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function streamKey(target: StreamTarget): string {
  switch (target.kind) {
    case "turn":
      return target.turnId;
    case "output":
      return `output:${target.conversationId}`;
    case "title":
      return `title:${target.threadId}`;
    case "rewrite":
      return `rewrite:${target.threadId}`;
  }
}

// Incoming text is batched and applied about once per frame. A timer (not requestAnimationFrame)
// keeps background tabs applying and saving text too.
function queueText(target: ShownTarget, text: string) {
  const key = streamKey(target);
  pendingText.set(key, { target, text: (pendingText.get(key)?.text ?? "") + text });
  if (flushTimer === null) flushTimer = setTimeout(flushText, 16);
}

function flushText() {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  for (const { target, text } of pendingText.values()) {
    writeConversation(
      target.conversationId,
      (conv) => (target.kind === "turn" ? tree.appendAnswerText(conv, target.turnId, text) : tree.appendOutputText(conv, text)),
      "stream",
    );
  }
  pendingText.clear();
}

// `onText` receives each piece of text as it arrives.
// `request.model` null: no model is available, so nothing is sent and the stream fails at once.
async function runStream(
  target: StreamTarget,
  request: { system?: string; messages: ChatMessage[]; model: string | null },
  onText: (text: string) => void,
  finish: (end: StreamEnd) => void,
) {
  const model = request.model;
  if (model === null) {
    finish({ kind: "failed", reason: NO_MODEL_REASON });
    return;
  }
  const controller = new AbortController();
  const key = streamKey(target);
  streams.set(key, { target, controller });
  let end: StreamEnd = { kind: "interrupted" };
  try {
    await api.streamComplete({ ...request, model }, controller.signal, (event: StreamEvent) => {
      if (event.type === "text") onText(event.text);
      else if (event.type === "done") end = event.outcome === "cut_off" ? { kind: "truncated" } : { kind: "complete" };
      else end = { kind: "failed", reason: event.message };
    });
  } catch (err) {
    if (controller.signal.aborted) end = { kind: "stopped" };
    else end = { kind: "failed", reason: err instanceof Error ? `Could not get an answer: ${err.message}` : "Could not get an answer" };
  }
  streams.delete(key);
  flushText();
  finish(end);
}

async function startTurnStream(conversationId: string, turnId: string) {
  if (get().health.kind === "loading") {
    // Sent before any model was chosen: the turn waits for health and takes the chosen model.
    const model = await chosenModelWhenReady();
    writeConversation(conversationId, (c) => (tree.findTurn(c, turnId)?.turn.model === null ? tree.setWaitingTurnModel(c, turnId, model) : c));
  }
  const conv = get().conversations[conversationId];
  const turn = conv ? tree.findTurn(conv, turnId)?.turn : undefined;
  // The turn can be gone (deleted) or no longer waiting while health was loading.
  if (!conv || turn?.status !== "waiting") return;
  const messages = tree.buildMessages(conv, turnId);
  const model = turn.model;
  const target: ShownTarget = { kind: "turn", conversationId, turnId };
  void runStream(target, { messages, model }, (text) => queueText(target, text), (end) => {
    writeConversation(
      conversationId,
      (c) => {
        switch (end.kind) {
          case "complete":
            return tree.completeTurn(c, turnId);
          case "truncated":
            return tree.truncateTurn(c, turnId);
          case "failed":
            return tree.failTurn(c, turnId, end.reason);
          case "stopped":
            return tree.stopTurn(c, turnId);
          case "interrupted":
            return tree.interruptTurn(c, turnId);
        }
      },
      "now",
    );
    requestTitle(conversationId, turnId);
  });
}

const TITLE_SYSTEM =
  "You name conversation threads. Reply with a title of 2 to 5 words for the exchange below. Plain text only: no quotes, no markdown, no trailing punctuation.";
const TITLE_INPUT_CHARS = 1500;

// After the first turn of a thread finishes, live mode asks the model for a short title.
// Demo and no-key mode never ask: no model would write the title.
function requestTitle(conversationId: string, turnId: string) {
  const health = get().health;
  if (health.kind !== "ready" || health.health.mode !== "live") return;
  const conv = get().conversations[conversationId];
  const found = conv ? tree.threadToTitle(conv, turnId) : undefined;
  if (!found) return;
  const { thread, turn } = found;
  const content = `Prompt:\n${turn.prompt.slice(0, TITLE_INPUT_CHARS)}\n\nAnswer:\n${turn.answer.slice(0, TITLE_INPUT_CHARS)}`;
  let reply = "";
  const target: StreamTarget = { kind: "title", conversationId, threadId: thread.id };
  // The title comes from the model that wrote the answer, or the current choice if it is gone.
  const model = availableModel(turn.model);
  void runStream(target, { system: TITLE_SYSTEM, messages: [{ role: "user", content }], model }, (text) => (reply += text), (end) => {
    // The title is a cosmetic extra: if the request fails or is cut off, the prompt title stays and no error is shown.
    if (end.kind !== "complete") return;
    writeConversation(conversationId, (c) => tree.applyModelTitle(c, thread.id, tree.titleFromModel(reply)));
  });
}

function abortStreamsOf(conversationId: string) {
  for (const { target, controller } of streams.values()) {
    if (target.conversationId === conversationId) controller.abort();
  }
  for (const [key, { target }] of pendingText) {
    if (target.conversationId === conversationId) pendingText.delete(key);
  }
}

// ---------- the model choice ----------

const NO_MODEL_REASON = "No model is available. Set a provider key in .env (see .env.example) and restart the server.";

// The stored choice when the server still offers it, otherwise the server's default. Runs when
// health arrives, so a model that disappeared from the server is never used.
function settleModelChoice() {
  const models = selectModels(get());
  const stored = readPref(PREF_MODEL);
  const health = get().health;
  const fallback = health.kind === "ready" ? health.health.defaultModel : null;
  const id = models.some((m) => m.id === stored) ? stored : fallback !== null && models.some((m) => m.id === fallback) ? fallback : (models[0]?.id ?? null);
  set({ modelChoice: id === null ? { kind: "none" } : { kind: "chosen", id } });
}

export function chooseModel(id: string) {
  if (!selectModels(get()).some((m) => m.id === id)) return;
  set({ modelChoice: { kind: "chosen", id } });
  writePref(PREF_MODEL, id);
}

// The model id the next request uses, or null when none is available.
function chosenModel(): string | null {
  const choice = get().modelChoice;
  return choice.kind === "chosen" ? choice.id : null;
}

// Resolves once health has arrived or failed, and the model choice is settled.
let healthSettled: () => void = () => {};
const healthDone = new Promise<void>((resolve) => (healthSettled = resolve));

// The chosen model, after waiting for health while it is still loading. Until health arrives no
// model is chosen, so a request made in the first instant after the page loads waits here instead
// of failing for lack of a model.
async function chosenModelWhenReady(): Promise<string | null> {
  if (get().health.kind === "loading") await healthDone;
  return chosenModel();
}

// `preferred` when the server offers it, otherwise the current choice.
function availableModel(preferred: string | null): string | null {
  return preferred !== null && selectModels(get()).some((m) => m.id === preferred) ? preferred : chosenModel();
}

// ---------- boot and the conversation list ----------

// Runs once; React's StrictMode calls effects twice in development.
let booted = false;

export async function boot() {
  if (booted) return;
  booted = true;
  void api
    .getHealth()
    .then((health) => {
      set({ health: { kind: "ready", health } });
      settleModelChoice();
    })
    .catch(() => set({ health: { kind: "unreachable" } }))
    .finally(() => healthSettled());
  await reloadList();
  // The person may have opened or started a conversation while the list was loading.
  if (get().openId !== null) return;
  const lastId = readPref(PREF_LAST_CONVERSATION);
  const list = get().list;
  const target = list.find((c) => c.id === lastId) ?? list[0];
  if (target) await openConversation(target.id);
  else newConversation();
}

export async function reloadList() {
  set({ listState: { kind: "loading" } });
  try {
    const list = await api.listConversations();
    set({ list, listState: { kind: "ready" } });
  } catch (err) {
    set({ listState: { kind: "failed", reason: err instanceof Error ? err.message : "The server did not answer" } });
  }
}

// Leaving the open conversation: an empty selected branch is discarded, the selection is
// remembered for when it opens again, and a blank conversation that was never stored is dropped,
// unless its start box holds typed text (then "New conversation" brings it back).
const lastSelection = new Map<string, string>();

function leaveOpenConversation() {
  const id = get().openId;
  if (id === null) return;
  const selected = get().selectedThreadId;
  selectThread(null);
  const conv = get().conversations[id];
  if (!conv) return;
  if (selected && tree.findThread(conv, selected)) lastSelection.set(id, selected);
  if (tree.isBlank(conv) && !inList(id) && !get().drafts[tree.rootThread(conv).id]) {
    dropDrafts(conv.threads.map((t) => t.id));
    baseVersions.delete(id);
    set((s) => {
      const { [id]: _dropped, ...conversations } = s.conversations;
      return { conversations };
    });
  }
}

// Shows a conversation that is in the cache.
function showConversation(id: string) {
  const conv = get().conversations[id];
  if (!conv) return;
  const remembered = lastSelection.get(id);
  const selected = remembered && tree.findThread(conv, remembered) ? remembered : tree.rootThread(conv).id;
  set({ openId: id, openState: { kind: "idle" }, selectedThreadId: selected, viewRequest: null });
  if (inList(id)) writePref(PREF_LAST_CONVERSATION, id);
}

export async function openConversation(id: string) {
  const { openId, openState } = get();
  if (openId === id && openState.kind !== "failed") return;
  leaveOpenConversation();
  if (get().conversations[id]) {
    showConversation(id);
    return;
  }
  set({ openId: id, openState: { kind: "loading", id }, selectedThreadId: null, viewRequest: null });
  const stillLoading = () => {
    const s = get().openState;
    return s.kind === "loading" && s.id === id;
  };
  try {
    const result = await api.getConversation(id);
    if (result.kind === "missing") {
      set((s) => ({ list: s.list.filter((c) => c.id !== id) }));
      if (stillLoading()) {
        showToast("That conversation no longer exists");
        openFallback();
      }
      return;
    }
    if (!inList(id)) return; // deleted while it was loading
    baseVersions.set(id, result.conversation.updatedAt);
    // Repairs made on load (an interrupted turn shown as stopped) are not saved: they are made again
    // on every load, and saving them from a tab that only reads would overwrite another tab's answer.
    const conversation = tree.recoverConversation(result.conversation);
    set((s) => ({ conversations: { ...s.conversations, [id]: conversation } }));
    restoreDrafts(conversation);
    // Empty branches that hold no draft are dropped (also not saved); those with a draft stay.
    const withDrafts = new Set(Object.entries(get().drafts).filter(([, text]) => text.trim() !== "").map(([threadId]) => threadId));
    const kept = tree.discardEmptyBranches(conversation, withDrafts);
    if (kept !== conversation) set((s) => ({ conversations: { ...s.conversations, [id]: kept } }));
    if (stillLoading()) showConversation(id);
  } catch (err) {
    if (stillLoading()) {
      set({ openState: { kind: "failed", id, reason: err instanceof Error ? err.message : "The server did not answer" } });
    }
  }
}

// Tries again to open the conversation that failed to load.
export function retryOpen() {
  const s = get().openState;
  if (s.kind === "failed") void openConversation(s.id);
}

// Opens the newest conversation, or a new blank one.
function openFallback() {
  set({ openId: null, openState: { kind: "idle" } });
  const next = get().list[0];
  if (next) void openConversation(next.id);
  else newConversation();
}

// A new blank conversation. If the open one is already blank, it only focuses the start box.
export function newConversation() {
  const open = openConversationNow();
  if (open && tree.isBlank(open)) {
    focusComposer();
    return;
  }
  leaveOpenConversation();
  const kept = Object.values(get().conversations).find((c) => tree.isBlank(c) && !inList(c.id));
  if (kept) {
    set({ tab: "thread" });
    showConversation(kept.id);
    focusComposer();
    return;
  }
  const conv = tree.createConversation(Date.now());
  baseVersions.set(conv.id, "new");
  set((s) => ({ conversations: { ...s.conversations, [conv.id]: conv }, tab: "thread" }));
  showConversation(conv.id);
  focusComposer();
}

// Deleting first stops everything that could write the conversation again: the save timer,
// its streams, and any save in flight. Only then is DELETE sent, so a late PUT never recreates it.
export async function deleteConversation(id: string) {
  await forgetConversation(id);
  removeStoredDrafts(id);
  try {
    await api.deleteConversation(id);
  } catch {
    showToast("Could not delete the conversation");
    void reloadList();
  }
}

// Drops a conversation from this tab: its timers, streams, drafts and cached copy. Another
// conversation opens if it was the open one. Resolves when no save of it is running any more.
async function forgetConversation(id: string) {
  const slot = saveSlots.get(id);
  if (slot) {
    clearSaveTimer(slot);
    clearRetryTimer(slot);
  }
  unsaved.delete(id);
  abortStreamsOf(id);
  dropDrafts(get().conversations[id]?.threads.map((t) => t.id) ?? [], id);
  lastSelection.delete(id);
  baseVersions.delete(id);
  const wasOpen = get().openId === id;
  set((s) => {
    const { [id]: _conv, ...conversations } = s.conversations;
    const { [id]: _save, ...saveStates } = s.saveStates;
    return { conversations, saveStates, list: s.list.filter((c) => c.id !== id) };
  });
  if (wasOpen) openFallback();
  if (slot) await slot.chain;
  saveSlots.delete(id);
}

// ---------- save conflicts (another tab or window) ----------

// "Load the other version": this tab's answers for the conversation stop, then its copy is
// replaced by the stored one. If it was deleted meanwhile, the conflict becomes the deleted case.
export async function loadOtherVersion(id: string) {
  abortStreamsOf(id);
  const slot = saveSlots.get(id);
  if (slot) {
    clearSaveTimer(slot);
    clearRetryTimer(slot);
    await slot.chain;
  }
  let result: api.LoadResult;
  try {
    result = await api.getConversation(id);
  } catch {
    showToast("Could not load the other version");
    return;
  }
  // While the GET ran, the conversation may have been closed or deleted here, or the user chose
  // "Keep this tab's version": then the loaded copy is dropped.
  const before = get().conversations[id];
  if (!before || !inConflict(id)) return;
  if (result.kind === "missing") {
    setSaveState(id, { kind: "conflict", currentUpdatedAt: null });
    return;
  }
  const loaded = tree.recoverConversation(result.conversation);
  baseVersions.set(id, result.conversation.updatedAt);
  unsaved.delete(id);
  set((s) => ({ conversations: { ...s.conversations, [id]: loaded } }));
  setSaveState(id, SAVED);
  dropDrafts(before.threads.filter((t) => !tree.findThread(loaded, t.id)).map((t) => t.id), id);
  if (get().openId === id) set({ selectedThreadId: drawnSelection(loaded, get().selectedThreadId) });
}

// The selection after the conversation changed under it: a thread that is gone gives the root,
// a thread that is not drawn (its branches hidden above it) gives its nearest drawn ancestor.
function drawnSelection(conv: Conversation, selected: string | null): string {
  const root = tree.rootThread(conv).id;
  if (!selected || !tree.findThread(conv, selected)) return root;
  const drawn = new Set(tree.visibleThreads(conv).map((t) => t.id));
  const path = tree.ancestorPath(conv, selected);
  for (let i = path.length - 1; i >= 0; i--) if (drawn.has(path[i]!.id)) return path[i]!.id;
  return root;
}

// "Keep this tab's version" (or "Keep it" when it was deleted elsewhere): save this copy over the
// stored one, based on the version the server reported.
export function keepThisVersion(id: string) {
  const state = get().saveStates[id];
  if (state?.kind !== "conflict") return;
  baseVersions.set(id, state.currentUpdatedAt ?? "new");
  unsaved.add(id);
  setSaveState(id, SAVING);
  saveNow(id);
}

// "Close it": the conversation was deleted elsewhere; drop it from this tab too.
export function closeDeletedConversation(id: string) {
  removeStoredDrafts(id);
  void forgetConversation(id);
}

export function renameConversation(title: string) {
  writeOpen((conv) => tree.renameConversation(conv, title));
}

// ---------- UI preferences, toast ----------

export function setSidebar(sidebar: SidebarView) {
  set({ sidebar });
  writePref(PREF_SIDEBAR, sidebar);
  refreshPanelWidth();
}

// Recomputes the panel width (after the window, the sidebar, the size or the mode changed).
export function refreshPanelWidth() {
  const s = get();
  const panelWidth = panelWidthFor(s.panelSize, s.panelMode, s.sidebar, window.innerWidth);
  if (panelWidth !== s.panelWidth) set({ panelWidth });
}

export function toggleSidebar() {
  setSidebar(get().sidebar === "shown" ? "collapsed" : "shown");
}

// Dragging the edge: the panel takes that width (and leaves reading mode).
export function setPanelWidth(width: number) {
  const next = clamp(width, PANEL_MIN_WIDTH, panelMaxWidth(window.innerWidth));
  set({ panelSize: { kind: "set", width: next }, panelMode: "normal" });
  writePref(PREF_PANEL_WIDTH, String(next));
  writePref(PREF_PANEL_MODE, "normal");
  refreshPanelWidth();
}

export function togglePanelMode() {
  const panelMode: PanelMode = get().panelMode === "reading" ? "normal" : "reading";
  set({ panelMode });
  writePref(PREF_PANEL_MODE, panelMode);
  refreshPanelWidth();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

// One toast at a time; a new one replaces the current one.
export function showToast(text: string) {
  if (toastTimer !== null) clearTimeout(toastTimer);
  set({ toast: { kind: "shown", text } });
  toastTimer = setTimeout(() => {
    toastTimer = null;
    set({ toast: { kind: "hidden", text } });
  }, TOAST_MS);
}

// Copies text to the clipboard and says whether it worked.
export function copyWithToast(text: string) {
  void copyText(text).then((ok) => showToast(ok ? "Copied" : "Copy failed"));
}

// ---------- selection and view ----------

// Selects a thread of the open conversation (null clears the selection). The previously
// selected thread is discarded if it is an empty branch without a draft.
export function selectThread(threadId: string | null) {
  // The selected card is always a visible card: hidden branches above it are shown first.
  if (threadId !== null) writeOpen((c) => tree.showBranchesAbove(c, threadId));
  const { selectedThreadId } = get();
  if (selectedThreadId === threadId) return;
  const conv = openConversationNow();
  const previous = conv && selectedThreadId ? tree.findThread(conv, selectedThreadId) : undefined;
  if (previous && previous.parent !== null && previous.turns.length === 0 && (get().drafts[previous.id] ?? "").trim() === "") {
    writeOpen((c) => tree.deleteThread(c, previous.id));
    dropDrafts([previous.id]);
  }
  set({ selectedThreadId: threadId });
}

// Selects a thread and brings its card into view on the canvas.
export function goToThread(threadId: string, kind: "reveal" | "center" = "reveal") {
  selectThread(threadId);
  set({ tab: "thread" });
  requestView(threadId, kind);
}

export function setTab(tab: PanelTab) {
  set({ tab });
}

export function requestView(threadId: string, kind: "reveal" | "center") {
  set((s) => ({ viewRequest: { kind, threadId, tick: (s.viewRequest?.tick ?? 0) + 1 } }));
}

export function requestFit() {
  set((s) => ({ viewRequest: { kind: "fit", tick: (s.viewRequest?.tick ?? 0) + 1 } }));
}

// Drafts belong to threads of the open conversation.
export function setDraft(threadId: string, text: string) {
  set((s) => ({ drafts: { ...s.drafts, [threadId]: text } }));
  const id = get().openId;
  if (id !== null) storeDraftsSoon(id);
}

// The drafts of threads that no longer exist (discarded, deleted, merged away, or their
// conversation deleted) are dropped with them. `conversationId` defaults to the open one.
function dropDrafts(threadIds: Iterable<string>, conversationId = get().openId) {
  const drafts = { ...get().drafts };
  let changed = false;
  for (const id of threadIds) {
    if (id in drafts) {
      delete drafts[id];
      changed = true;
    }
  }
  if (!changed) return;
  set({ drafts });
  if (conversationId !== null) storeDraftsSoon(conversationId);
}

// ---------- drafts in localStorage ----------
// One key per stored conversation: a map of thread id to draft text, written shortly after the last
// change, removed when no draft is left. Only conversations on the server are kept (a blank one that
// was never saved disappears when left, and its drafts with it).

const DRAFTS_KEY_PREFIX = "prompt-tree:drafts:";
const DRAFTS_WRITE_MS = 400;
const draftWrites = new Map<string, Handle>();

function storeDraftsSoon(conversationId: string) {
  const pending = draftWrites.get(conversationId);
  if (pending !== undefined) clearTimeout(pending);
  draftWrites.set(
    conversationId,
    setTimeout(() => {
      draftWrites.delete(conversationId);
      storeDrafts(conversationId);
    }, DRAFTS_WRITE_MS),
  );
}

function storeDrafts(conversationId: string) {
  const conv = get().conversations[conversationId];
  if (!conv || !inList(conversationId)) return;
  const map: Record<string, string> = {};
  for (const t of conv.threads) {
    const text = get().drafts[t.id];
    if (text) map[t.id] = text;
  }
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(DRAFTS_KEY_PREFIX + conversationId);
    else localStorage.setItem(DRAFTS_KEY_PREFIX + conversationId, JSON.stringify(map));
  } catch {
    // storage unavailable; drafts then live only in memory
  }
}

function removeStoredDrafts(conversationId: string) {
  const pending = draftWrites.get(conversationId);
  if (pending !== undefined) clearTimeout(pending);
  draftWrites.delete(conversationId);
  try {
    localStorage.removeItem(DRAFTS_KEY_PREFIX + conversationId);
  } catch {
    // storage unavailable
  }
}

// A loaded conversation gets its stored drafts back. Drafts of threads that no longer exist are
// dropped from storage; a draft already typed in this tab wins over the stored one.
function restoreDrafts(conv: Conversation) {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(localStorage.getItem(DRAFTS_KEY_PREFIX + conv.id) ?? "{}") as Record<string, unknown>;
  } catch {
    return;
  }
  const restored: Record<string, string> = {};
  for (const [threadId, text] of Object.entries(stored)) {
    if (typeof text === "string" && text !== "" && tree.findThread(conv, threadId)) restored[threadId] = text;
  }
  set((s) => ({ drafts: { ...restored, ...s.drafts } }));
  if (Object.keys(restored).length !== Object.keys(stored).length) storeDrafts(conv.id);
}

// Asks the composer (or the start box) to take focus.
export function focusComposer() {
  set((s) => ({ composerFocusTick: s.composerFocusTick + 1 }));
}

// ---------- sending ----------

// The first prompt of a blank conversation goes into its root thread. It is saved at once,
// so the conversation shows in the list right away.
export function sendFirstPrompt(prompt: string) {
  const conv = openConversationNow();
  if (!conv || !tree.isBlank(conv)) return;
  const rootId = tree.rootThread(conv).id;
  const result = tree.appendTurn(conv, rootId, prompt, chosenModel(), Date.now());
  writeConversation(conv.id, () => result.conv, "now");
  setDraft(rootId, "");
  set({ selectedThreadId: rootId, tab: "thread" });
  const tip = get().tip;
  if (tip.kind === "pending" && tip.conversationId === null) {
    set({ tip: { kind: "pending", conversationId: conv.id } });
    writePref(PREF_FIRST_CONVERSATION, conv.id);
  }
  writePref(PREF_LAST_CONVERSATION, conv.id);
  void startTurnStream(conv.id, result.turnId);
}

// "Send": the turn is added to the given card.
export function continueHere(threadId: string, prompt: string) {
  const conv = openConversationNow();
  if (!conv) return;
  const result = tree.appendTurn(conv, threadId, prompt, chosenModel(), Date.now());
  writeConversation(conv.id, () => result.conv);
  setDraft(threadId, "");
  void startTurnStream(conv.id, result.turnId);
}

// "New branch": the turn goes into a new branch card after the last turn.
export function branchOff(threadId: string, prompt: string) {
  const conv = openConversationNow();
  if (!conv) return;
  const result = tree.branchOffWithPrompt(conv, threadId, prompt, chosenModel(), Date.now());
  writeConversation(conv.id, () => result.conv);
  selectThread(result.threadId);
  setDraft(threadId, "");
  set({ tab: "thread" });
  requestView(result.threadId, "reveal");
  void startTurnStream(conv.id, result.turnId);
}

// "Branch": an empty branch card after the turn, selected, with the composer focused.
export function branchFromTurn(threadId: string, turnId: string, draft = "") {
  const conv = openConversationNow();
  if (!conv) return;
  const result = tree.createBranch(conv, threadId, turnId, Date.now());
  writeConversation(conv.id, () => result.conv);
  selectThread(result.threadId);
  setDraft(result.threadId, draft);
  set({ tab: "thread" });
  requestView(result.threadId, "reveal");
  focusComposer();
}

// "New branch" with an empty box: an empty branch after the last turn, like Branch on that turn.
export function branchFromLastTurn(threadId: string) {
  const last = openConversationNow() && tree.findThread(openConversationNow()!, threadId)?.turns.at(-1);
  if (last && tree.canBranchFrom(last)) branchFromTurn(threadId, last.id);
}

// "Another branch from the same message": an empty sibling of this branch, selected, composer focused.
export function branchFromSameMessage(threadId: string) {
  const conv = openConversationNow();
  const result = conv ? tree.createSiblingBranch(conv, threadId, Date.now()) : undefined;
  if (!conv || !result) return;
  writeConversation(conv.id, () => result.conv);
  selectThread(result.threadId);
  set({ tab: "thread" });
  requestView(result.threadId, "reveal");
  focusComposer();
}

// "Branch per option": a branch after the turn titled with the option, its draft the option quoted.
function optionDraft(title: string): string {
  return `> ${title}\n\n`;
}

export function branchForOption(threadId: string, turnId: string, title: string) {
  const conv = openConversationNow();
  if (!conv) return;
  const result = tree.createBranch(conv, threadId, turnId, Date.now(), title);
  writeConversation(conv.id, () => result.conv);
  selectThread(result.threadId);
  setDraft(result.threadId, optionDraft(title));
  set({ tab: "thread" });
  requestView(result.threadId, "reveal");
  focusComposer();
}

// "Branch all": a branch for every option that has none yet; the first option's branch is selected.
export function branchAllOptions(threadId: string, turnId: string, titles: string[]) {
  const conv = openConversationNow();
  if (!conv || titles.length === 0) return;
  let next = conv;
  const ids: string[] = [];
  const created: string[] = [];
  const now = Date.now();
  titles.forEach((title, i) => {
    const existing = tree.optionBranch(next, turnId, title);
    if (existing) {
      ids.push(existing.id);
      return;
    }
    const result = tree.createBranch(next, threadId, turnId, now + i, title);
    next = result.conv;
    ids.push(result.threadId);
    created.push(result.threadId);
  });
  writeConversation(conv.id, () => next);
  for (const id of created) setDraft(id, optionDraft(tree.findThread(next, id)!.title));
  selectThread(ids[0]!);
  set({ tab: "thread" });
  requestView(ids[0]!, "reveal");
  focusComposer();
}

// ---------- "Ask each" ----------

// One question about every option of the thread's last answer: one rewrite request (silent, not a
// turn), then one branch per option with its own first turn, all started at once.
export async function askEach(threadId: string, question: string) {
  const conv = openConversationNow();
  const last = conv ? tree.findThread(conv, threadId)?.turns.at(-1) : undefined;
  if (!conv || !last || !tree.canBranchFrom(last) || get().splits[threadId]) return;
  const options = answerOptions(last.answer);
  if (options.length < 2) return;
  const split: SplitState = { kind: "splitting", conversationId: conv.id, turnId: last.id, options };
  set((s) => ({ splits: { ...s.splits, [threadId]: split } }));
  const model = await chosenModelWhenReady();
  if (model === null) {
    // Without a model nothing can rewrite the question: the fallback prompts.
    finishSplit(threadId, split, fallbackPrompts(options, question), model);
    return;
  }
  let reply = "";
  const target: StreamTarget = { kind: "rewrite", conversationId: conv.id, threadId };
  const request = { system: REWRITE_SYSTEM, messages: [{ role: "user" as const, content: rewriteMessage(last.answer, options, question) }], model };
  void runStream(target, request, (text) => (reply += text), (end) => {
    // Aborted because the thread or the conversation was deleted: nothing is created.
    if (end.kind === "stopped") {
      endSplit(threadId);
      return;
    }
    // A failed or cut-off rewrite, or a reply that is not one prompt per option, is not an error
    // for the person: the split still happens with the quoted question.
    const prompts = end.kind === "complete" ? parseRewrite(reply, options.length) : null;
    finishSplit(threadId, split, prompts ?? fallbackPrompts(options, question), model);
  });
}

function endSplit(threadId: string) {
  set((s) => {
    const { [threadId]: _done, ...splits } = s.splits;
    return { splits };
  });
}

// The branches go under the thread and turn the split started on, in its conversation, even when
// another conversation is open by now. If that thread or turn is gone, the result is dropped.
function finishSplit(threadId: string, split: SplitState, prompts: string[], model: string | null) {
  endSplit(threadId);
  const conv = get().conversations[split.conversationId];
  const thread = conv ? tree.findThread(conv, threadId) : undefined;
  if (!conv || !thread || !thread.turns.some((t) => t.id === split.turnId)) return;
  const options = split.options.map((title, i) => ({ title, prompt: prompts[i] ?? title }));
  const result = tree.createOptionBranches(conv, threadId, split.turnId, options, model, Date.now());
  writeConversation(conv.id, () => result.conv, "now");
  set((s) => ({ drafts: { ...s.drafts, [threadId]: "" } }));
  storeDraftsSoon(conv.id);
  const first = result.threadIds[0];
  if (first && get().openId === conv.id) {
    selectThread(first);
    set({ tab: "thread" });
    requestView(first, "reveal");
  }
  for (const turnId of result.turnIds) void startTurnStream(conv.id, turnId);
}

export function dismissTip() {
  set({ tip: { kind: "dismissed" } });
  writePref(PREF_TIP, "dismissed");
}

export function stopTurn(turnId: string) {
  streams.get(turnId)?.controller.abort();
}

export function retryTurn(turnId: string) {
  const conv = openConversationNow();
  if (!conv || !tree.retryAllowed(conv, turnId).ok) return;
  const removed = tree.excerptClips(conv, turnId).length;
  // The turn's own model when the server still offers it, otherwise the current choice.
  const model = availableModel(tree.findTurn(conv, turnId)?.turn.model ?? null);
  writeConversation(conv.id, (c) => tree.retryTurn(c, turnId, model));
  if (removed > 0) showToast(`Removed ${removed} ${removed === 1 ? "excerpt" : "excerpts"} from the old answer`);
  void startTurnStream(conv.id, turnId);
}

export function removeTurn(turnId: string) {
  writeOpen((c) => tree.removeTurn(c, turnId));
}

// ---------- thread actions ----------

export function renameThread(threadId: string, title: string) {
  writeOpen((c) => tree.renameThread(c, threadId, title));
}

export function toggleCardView(threadId: string) {
  writeOpen((c) => {
    const thread = tree.findThread(c, threadId);
    return thread ? tree.setCardView(c, threadId, thread.cardView === "open" ? "folded" : "open") : c;
  });
}

export function setAllCardViews(view: Thread["cardView"]) {
  writeOpen((c) => tree.setAllCardViews(c, view));
}

// Hiding the branches of a card that is above the selected card selects that card.
export function toggleBranchesView(threadId: string) {
  const conv = openConversationNow();
  const thread = conv ? tree.findThread(conv, threadId) : undefined;
  if (!conv || !thread) return;
  const next = thread.branchesView === "shown" ? "hidden" : "shown";
  const selected = get().selectedThreadId;
  if (next === "hidden" && selected && selected !== threadId && tree.subtreeIds(conv, threadId).has(selected)) {
    selectThread(threadId);
  }
  writeOpen((c) => tree.setBranchesView(c, threadId, next));
}

export function splitOff(threadId: string, turnId: string) {
  const conv = openConversationNow();
  if (!conv) return;
  const result = tree.splitOff(conv, threadId, turnId, Date.now());
  writeConversation(conv.id, () => result.conv);
  selectThread(result.threadId);
  requestView(result.threadId, "reveal");
}

export function mergeIntoParent(threadId: string) {
  const conv = openConversationNow();
  if (!conv) return;
  const result = tree.mergeIntoParent(conv, threadId);
  writeConversation(conv.id, () => result.conv);
  // The merged card's draft joins the parent's: the parent's text, an empty line, then the child's.
  const draft = get().drafts[threadId] ?? "";
  if (result.threadId !== threadId) {
    const parentDraft = get().drafts[result.threadId] ?? "";
    if (draft !== "") setDraft(result.threadId, parentDraft !== "" ? `${parentDraft}\n\n${draft}` : draft);
    dropDrafts([threadId]);
  }
  set({ selectedThreadId: result.threadId });
}

// Deletes a card and everything below it; their answers in flight are stopped first.
export function deleteThread(threadId: string) {
  const conv = openConversationNow();
  const thread = conv ? tree.findThread(conv, threadId) : undefined;
  if (!conv || !thread || thread.parent === null) return;
  const ids = tree.subtreeIds(conv, threadId);
  for (const t of conv.threads) {
    if (!ids.has(t.id)) continue;
    for (const turn of t.turns) streams.get(turn.id)?.controller.abort();
    streams.get(`rewrite:${t.id}`)?.controller.abort();
  }
  const selected = get().selectedThreadId;
  if (selected && ids.has(selected)) set({ selectedThreadId: thread.parent.threadId });
  writeConversation(conv.id, (c) => tree.deleteThread(c, threadId));
  dropDrafts(ids);
}

// ---------- clips and output ----------

export function toggleAnswerClip(threadId: string, turnId: string) {
  writeOpen((c) => tree.toggleAnswerClip(c, threadId, turnId));
}

// "duplicate": the same text was already taken from this turn; nothing is added.
export function addExcerptClip(threadId: string, turnId: string, text: string): "added" | "duplicate" {
  const conv = openConversationNow();
  if (!conv) return "duplicate";
  const next = tree.addExcerptClip(conv, threadId, turnId, text);
  if (next === conv) return "duplicate";
  writeConversation(conv.id, () => next);
  return "added";
}

export function removeClip(clipId: string) {
  writeOpen((c) => tree.removeClip(c, clipId));
}

export function moveClipTo(clipId: string, toIndex: number) {
  writeOpen((c) => tree.moveClipTo(c, clipId, toIndex));
}

export function setOutputInstruction(instruction: string) {
  writeOpen((c) => tree.setOutputInstruction(c, instruction));
}

const COMBINE_SYSTEM = [
  "You combine pieces that a user selected from a branching conversation into one final document.",
  "Merge the pieces into a single coherent document in markdown, in the order given unless the user's instruction says otherwise.",
  "Remove repetition and connect the pieces with short transitions where needed.",
  "Do not invent facts, examples, or content that is not in the pieces. If the pieces disagree, say so plainly.",
  "Answer with the document only, without remarks about the task.",
].join(" ");

function combineMessage(conv: Conversation): string {
  const firstPrompt = tree.rootThread(conv).turns[0]?.prompt ?? "";
  const pieces = conv.clips.map((clip, i) => {
    const thread = tree.findThread(conv, clip.threadId);
    const label = thread ? tree.threadTitle(thread) : "Unknown branch";
    const kind = clip.kind === "answer" ? "whole answer" : "excerpt";
    return `### Piece ${i + 1} (${kind}, from the branch "${label}")\n\n${tree.clipText(conv, clip).trim()}`;
  });
  const instruction = conv.output.instruction.trim();
  return [
    `The conversation started with this prompt:\n\n${firstPrompt}`,
    `The selected pieces, in order:\n\n${pieces.join("\n\n")}`,
    instruction ? `How to combine them: ${instruction}` : "No extra instruction was given.",
  ].join("\n\n---\n\n");
}

export async function combine() {
  const open = openConversationNow();
  if (!open || open.clips.length === 0) return;
  const conversationId = open.id;
  let model = chosenModel();
  writeConversation(conversationId, () => tree.startOutput(open, model));
  if (get().health.kind === "loading") {
    // Started before any model was chosen: the run waits for health and takes the chosen model.
    model = await chosenModelWhenReady();
    writeConversation(conversationId, (c) => (c.output.status === "waiting" ? tree.startOutput(c, model) : c));
  }
  const conv = get().conversations[conversationId];
  if (!conv || conv.output.status !== "waiting") return;
  const request = { system: COMBINE_SYSTEM, messages: [{ role: "user" as const, content: combineMessage(conv) }], model };
  const target: ShownTarget = { kind: "output", conversationId };
  void runStream(target, request, (text) => queueText(target, text), (end) => {
    writeConversation(
      conversationId,
      (c) => {
        switch (end.kind) {
          case "complete":
            return tree.completeOutput(c);
          case "truncated":
            return tree.truncateOutput(c);
          case "failed":
            return tree.failOutput(c, end.reason);
          case "stopped":
            return tree.stopOutput(c);
          case "interrupted":
            return tree.interruptOutput(c);
        }
      },
      "now",
    );
  });
}

export function stopCombine() {
  const id = get().openId;
  if (id !== null) streams.get(`output:${id}`)?.controller.abort();
}

// Browsers cap the total body of keepalive requests in flight at 64 KB.
const KEEPALIVE_BUDGET = 64 * 1024;

// The page is being hidden or closed (visibilitychange to hidden, pagehide): every pending save runs
// now, through the save queue, instead of after its delay. Saves whose bodies fit in the keepalive
// budget can finish after the page is gone; larger ones are sent normally and may be cut off.
// The next load recovers turns that were in flight.
export function flushSavesOnHide() {
  flushText();
  let budget = KEEPALIVE_BUDGET;
  for (const id of [...unsaved]) {
    const conv = get().conversations[id];
    if (!conv || inConflict(id)) continue;
    const slot = slotFor(id);
    clearSaveTimer(slot);
    const size = new TextEncoder().encode(JSON.stringify(conv)).length;
    const keepalive = size <= budget;
    if (keepalive) budget -= size;
    saveNow(id, keepalive);
  }
}

// Leaving now would lose work: a conversation is in conflict, or has a failed save with changes
// not on the server. The page then asks the browser to confirm leaving.
export function leavingLosesWork(): boolean {
  return Object.entries(get().saveStates).some(([id, state]) => state.kind === "conflict" || (state.kind === "failed" && unsaved.has(id)));
}
