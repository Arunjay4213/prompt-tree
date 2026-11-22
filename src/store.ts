// One zustand store: the loaded conversations (a cache keyed by id), which one is open, the
// conversation list, selection, UI preferences, server health, and named actions that call the
// pure functions in tree.ts. Streaming and saving live here and work per conversation, so a
// conversation keeps streaming and saving while another one is open.

import { create } from "zustand";
import type { ChatMessage, Conversation, ConversationSummary, Health, StreamEvent, Thread } from "../shared/api";
import * as api from "./api";
import { copyText } from "./text";
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
export const PANEL_MAX_WIDTH = 720;
const PANEL_DEFAULT_WIDTH = 480;
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
  selectedThreadId: string | null; // a thread of the open conversation
  tab: PanelTab;
  drafts: Record<string, string>; // the composer text of each thread, by thread id (also kept in localStorage)
  composerFocusTick: number;
  viewRequest: ViewRequest | null;
  sidebar: SidebarView;
  panelWidth: number;
  toast: ToastState;
};

// ---------- preferences in localStorage ----------

const PREF_SIDEBAR = "prompt-tree:sidebar";
const PREF_PANEL_WIDTH = "prompt-tree:panel-width";
const PREF_LAST_CONVERSATION = "prompt-tree:last-conversation";

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

export function clampPanelWidth(width: number): number {
  return Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width)));
}

function initialSidebar(): SidebarView {
  if (window.innerWidth < NARROW_WINDOW) return "collapsed";
  return readPref(PREF_SIDEBAR) === "collapsed" ? "collapsed" : "shown";
}

function initialPanelWidth(): number {
  const stored = Number(readPref(PREF_PANEL_WIDTH));
  return Number.isFinite(stored) && stored > 0 ? clampPanelWidth(stored) : PANEL_DEFAULT_WIDTH;
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
  selectedThreadId: null,
  tab: "thread",
  drafts: {},
  composerFocusTick: 0,
  viewRequest: null,
  sidebar: initialSidebar(),
  panelWidth: initialPanelWidth(),
  toast: { kind: "hidden", text: "" },
}));

const get = useStore.getState;
const set = useStore.setState;

// ---------- selectors ----------

export function selectOpenConversation(s: State): Conversation | undefined {
  return s.openId === null ? undefined : s.conversations[s.openId];
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
  | { kind: "title"; conversationId: string; threadId: string };
type ShownTarget = Exclude<StreamTarget, { kind: "title" }>;
type StreamEnd =
  | { kind: "complete" }
  | { kind: "truncated" }
  | { kind: "failed"; reason: string }
  | { kind: "stopped" }
  | { kind: "interrupted" }; // the stream ended without a final event

// Key: the turn id, "output:<conversation id>", or "title:<thread id>".
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
async function runStream(
  target: StreamTarget,
  request: { system?: string; messages: ChatMessage[] },
  onText: (text: string) => void,
  finish: (end: StreamEnd) => void,
) {
  const controller = new AbortController();
  const key = streamKey(target);
  streams.set(key, { target, controller });
  let end: StreamEnd = { kind: "interrupted" };
  try {
    await api.streamComplete(request, controller.signal, (event: StreamEvent) => {
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

function startTurnStream(conversationId: string, turnId: string) {
  const conv = get().conversations[conversationId];
  if (!conv) return;
  const messages = tree.buildMessages(conv, turnId);
  const target: ShownTarget = { kind: "turn", conversationId, turnId };
  void runStream(target, { messages }, (text) => queueText(target, text), (end) => {
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
// Demo and no-key mode never ask: their answers are placeholders, not titles.
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
  void runStream(target, { system: TITLE_SYSTEM, messages: [{ role: "user", content }] }, (text) => (reply += text), (end) => {
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

// ---------- boot and the conversation list ----------

// Runs once; React's StrictMode calls effects twice in development.
let booted = false;

export async function boot() {
  if (booted) return;
  booted = true;
  void api
    .getHealth()
    .then((health) => set({ health: { kind: "ready", health } }))
    .catch(() => set({ health: { kind: "unreachable" } }));
  await reloadList();
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
}

export function toggleSidebar() {
  setSidebar(get().sidebar === "shown" ? "collapsed" : "shown");
}

export function setPanelWidth(width: number) {
  const panelWidth = clampPanelWidth(width);
  if (panelWidth === get().panelWidth) return;
  set({ panelWidth });
  writePref(PREF_PANEL_WIDTH, String(panelWidth));
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
// selected thread is discarded if it is an empty branch.
export function selectThread(threadId: string | null) {
  // The selected card is always a visible card: hidden branches above it are shown first.
  if (threadId !== null) writeOpen((c) => tree.showBranchesAbove(c, threadId));
  const { selectedThreadId } = get();
  if (selectedThreadId === threadId) return;
  const conv = openConversationNow();
  const previous = conv && selectedThreadId ? tree.findThread(conv, selectedThreadId) : undefined;
  if (previous && previous.parent !== null && previous.turns.length === 0) {
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
  const result = tree.appendTurn(conv, rootId, prompt, Date.now());
  writeConversation(conv.id, () => result.conv, "now");
  setDraft(rootId, "");
  set({ selectedThreadId: rootId, tab: "thread" });
  writePref(PREF_LAST_CONVERSATION, conv.id);
  startTurnStream(conv.id, result.turnId);
}

// "Continue": the turn is added to the given card.
export function continueHere(threadId: string, prompt: string) {
  const conv = openConversationNow();
  if (!conv) return;
  const result = tree.appendTurn(conv, threadId, prompt, Date.now());
  writeConversation(conv.id, () => result.conv);
  setDraft(threadId, "");
  startTurnStream(conv.id, result.turnId);
}

// "Branch off": the turn goes into a new branch card after the last turn.
export function branchOff(threadId: string, prompt: string) {
  const conv = openConversationNow();
  if (!conv) return;
  const result = tree.branchOffWithPrompt(conv, threadId, prompt, Date.now());
  writeConversation(conv.id, () => result.conv);
  selectThread(result.threadId);
  setDraft(threadId, "");
  set({ tab: "thread" });
  requestView(result.threadId, "reveal");
  startTurnStream(conv.id, result.turnId);
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

export function stopTurn(turnId: string) {
  streams.get(turnId)?.controller.abort();
}

export function retryTurn(turnId: string) {
  const conv = openConversationNow();
  if (!conv || !tree.retryAllowed(conv, turnId).ok) return;
  const removed = tree.excerptClips(conv, turnId).length;
  writeConversation(conv.id, (c) => tree.retryTurn(c, turnId));
  if (removed > 0) showToast(`Removed ${removed} ${removed === 1 ? "excerpt" : "excerpts"} from the old answer`);
  startTurnStream(conv.id, turnId);
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

export function combine() {
  const open = openConversationNow();
  if (!open || open.clips.length === 0) return;
  const conversationId = open.id;
  const conv = tree.startOutput(open);
  writeConversation(conversationId, () => conv);
  const request = { system: COMBINE_SYSTEM, messages: [{ role: "user" as const, content: combineMessage(conv) }] };
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
