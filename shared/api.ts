// The contract between the web app (src/) and the server (server/).
// Both sides import from this file. Change it only together with both sides.

// ---------- Conversation data (owned by the web app, stored by the server as-is) ----------

// A turn is one prompt and the model's answer to it.
// waiting:   request sent, no answer text yet
// streaming: answer text is arriving
// complete:  answer finished normally
// truncated: the model hit its output length limit; the partial text is kept; treated like
//            complete for context and branching. A "done" event with outcome "cut_off" ends a turn here.
// stopped:   the user pressed Stop, or the page closed mid-answer; the partial answer is kept
// failed:    the request failed; `error` holds a readable reason and `answer` is empty
export type TurnStatus = "waiting" | "streaming" | "complete" | "truncated" | "stopped" | "failed";

export type Turn = {
  id: string;
  prompt: string;
  answer: string;
  status: TurnStatus;
  error: string | null;
  createdAt: number;
};

// How a thread's card is drawn on the canvas.
export type CardView = "open" | "folded";

// Whether the cards that branch off a thread (and everything below them) are drawn.
export type BranchesView = "shown" | "hidden";

// Where a thread's or a conversation's title came from.
// prompt: cut from the first prompt
// model:  a short title the model wrote after the first answer (live mode only)
// user:   typed by the user; never replaced automatically. Conversations saved before this field
//         existed are loaded as "user".
export type TitleSource = "prompt" | "model" | "user";

// A thread is a straight line of turns, drawn as one card.
// Branches are identified by a path number computed from the tree (ROOT, 1, 1.2), never stored.
// `parent` is null for the root thread. Otherwise the thread branches off right after
// `parent.turnId`, which is a turn inside thread `parent.threadId`.
// The model context for a turn is: the context of the parent turn (recursively, up to the root),
// then the earlier turns of this thread. Sibling branches never see each other.
export type Thread = {
  id: string;
  parent: { threadId: string; turnId: string } | null;
  title: string;
  titleSource: TitleSource;
  cardView: CardView;
  branchesView: BranchesView;
  turns: Turn[];
  createdAt: number;
};

// A clip is something the user picked for the final output.
// "answer" means the whole answer of a turn (text is read from the turn when shown).
// "excerpt" means a piece of text the user selected inside an answer.
export type Clip =
  | { id: string; kind: "answer"; threadId: string; turnId: string }
  | { id: string; kind: "excerpt"; threadId: string; turnId: string; text: string };

// The combined final document that the model writes from the clips.
// The statuses mean the same as for a turn, plus "empty" (never written).
// truncated: the model hit its output length limit; the partial text is kept; treated like complete.
export type OutputStatus = "empty" | "waiting" | "streaming" | "complete" | "truncated" | "stopped" | "failed";

export type FinalOutput = {
  status: OutputStatus;
  text: string;
  instruction: string; // the user's optional note on how to combine the clips
  error: string | null;
};

export type Conversation = {
  id: string; // must match CONVERSATION_ID_PATTERN
  title: string;
  titleSource: TitleSource;
  createdAt: number;
  updatedAt: number;
  threads: Thread[]; // threads[0] is the root thread
  clips: Clip[]; // array order is the order in the final output
  output: FinalOutput;
};

export type ConversationSummary = { id: string; title: string; updatedAt: number };

export const CONVERSATION_ID_PATTERN = /^[a-z0-9-]{8,64}$/;

// ---------- HTTP API (all under /api) ----------
//
// GET    /api/health                 -> Health
// GET    /api/conversations          -> ConversationSummary[]   (newest first)
// GET    /api/conversations/:id      -> Conversation            (404 if missing)
// PUT    /api/conversations/:id      body: Conversation, header X-Base-Version -> 204  (create or replace)
// DELETE /api/conversations/:id      -> 204
// POST   /api/complete               body: CompleteRequest -> text/event-stream of StreamEvent
//
// Errors on the JSON routes: non-2xx status with body { error: string }.
//
// Save conflicts (two tabs or windows saving the same conversation):
// PUT requires the header X-Base-Version. Its value is the decimal `updatedAt` of the stored
// version this save is based on, or the literal `new` when this client has never loaded or saved
// this conversation. A missing or malformed header is a 400.
// The save is written (204) only when the stored file exists and the header equals
// String(stored.updatedAt), or when no file exists and the header is `new`.
// Anything else is a 409 with body SaveConflict. `currentUpdatedAt` is the stored `updatedAt`,
// or null when no file exists (the conversation was deleted elsewhere).

// live:   a real key is configured, answers come from the model
// demo:   DEMO_MODE=1, answers are placeholder text, no key needed, no money spent
// no_key: no key is configured and demo mode is off; /api/complete will answer with an error event
export type ServerMode = "live" | "demo" | "no_key";

export type Health = { mode: ServerMode; model: string };

export type SaveConflict = { error: string; currentUpdatedAt: number | null };

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type CompleteRequest = {
  system?: string;
  messages: ChatMessage[]; // must be non-empty and end with a user message
};

// POST /api/complete streams Server-Sent Events. Every event is one line `data: <JSON StreamEvent>`.
// The stream is zero or more "text" events followed by exactly one "done" or "error" event.
// If the browser closes the request, the server cancels the model call.
export type StreamEvent =
  | { type: "text"; text: string } // append to the answer
  | { type: "done"; outcome: "complete" | "cut_off" } // cut_off: the model hit its output length limit
  | { type: "error"; message: string }; // readable reason, safe to show to the user
