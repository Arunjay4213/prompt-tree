# prompt-tree

A local web app for talking to a model in a tree instead of one long line.
You ask something, then follow different directions as separate branches.
Each branch only sees the messages on its own path back to the root, so side questions do not pollute the main thread.
At the end you pick the parts you want from any branch and combine them into one final output.

The interface is the product.
The server is deliberately small.
The quality bar for the interface is https://arunjay.dev/blamingo, and the visual specification is `DESIGN.md`.

## Run

- `pnpm dev` starts the server (port 8787) and the web app (port 5173, proxies `/api` to the server).
- `pnpm dev:demo` does the same with `DEMO_MODE=1`: placeholder answers, no key, no cost.
- `pnpm typecheck` checks both the web app and the server.
- `pnpm e2e` drives the running demo app in a real browser through the main flows (`tools/e2e.mjs`). Run `pnpm dev:demo` first.
- `pnpm build` then `pnpm start` serves the built app from the server alone.
- The key lives in `.env` as `OPENAI_API_KEY`. Never read, print, or commit `.env`.
- The model is `gpt-6-luna` (OpenAI Responses API). It is set in one place on the server, overridable with `OPENAI_MODEL`.
- `PORT` overrides the server port (the Vite proxy follows it).

## Layout of the code

- `shared/api.ts` is the contract: the conversation data shapes and the HTTP API. Read it first.
- `server/` is a small Hono server: a stateless streaming proxy to the model plus a JSON file store (`data/conversations/<id>.json`).
- `src/` is the React app (Vite, TypeScript, Tailwind v4, `@xyflow/react` for the canvas, zustand for state, Radix primitives for tooltips and dialogs).
- `src/tree.ts` holds all tree logic as pure functions over `Conversation`.
- `src/store.ts` holds the state, the streaming, and the saving.
- The web app owns the conversation state. It saves the whole conversation with `PUT` after changes. The server never edits a conversation.

## Engineering rules

- Simple, robust code. Plain functions. No abstraction with a single caller. No speculative options.
- No unit-test suites. Verify by running the real app end to end in a browser and looking at it.
- No implicit state machines. States are named union types (see `TurnStatus`, `CardView`, `OutputStatus`). Every transition is a named function. Never encode a state as a mix of booleans, nulls, or sentinel values.
- All tree operations (branch, split, merge, delete, context building, numbering, layout) are pure functions in `src/tree.ts`, so they can be read and checked in one place.
- Colors, fonts, radii and easing come from the tokens in `src/index.css`. No raw hex values in components.
- Never use the em dash character. Use a plain dash.
- In long markdown files, put each sentence on its own line.
- No commit attribution lines (no Co-Authored-By).

## Product behaviour

`DESIGN.md` says how everything looks. This section says what it does.

### Core idea

- A **thread** is a straight line of turns (prompt + answer) and is drawn as **one card**.
- Continuing a thread adds a turn to the same card. No new card appears. This is how a direction stays compact.
- **Branching** creates a new card connected to the turn it branched from. The user decides, per message, whether it continues the card or becomes a branch.
- The choice is reversible:
  - **Split off from here** (on any turn except the first of a card) moves that turn and the later turns of the card into a new branch card.
  - **Merge into parent** (on a card that branches from the *last* turn of its parent) appends its turns to the parent card.
  - Both keep the model context of every turn exactly the same.
- Cards can be **folded** to one line, and a card can **hide its branches** (the whole subtree below it), so a big tree stays readable.
- **Clips**: the user marks whole answers or selected excerpts, from any branch, for the final output.
- The **Output** tab lists the clips in order, lets the user reorder and remove them, copy them as markdown, or ask the model to combine them into one final document.

### Model context

The messages sent for a new turn in thread T: walk from T up through `parent` links to the root.
For each ancestor thread, include its turns up to and including the turn the child branched from.
Then T's own earlier turns, then the new prompt.
Only turns that are `complete`, `truncated`, or `stopped` with text are included.
Sibling branches never appear.

### Identity of a branch

Branches are identified by a path number, not a color.
The root thread is `ROOT`. Its branches are `1`, `2`, `3` in the order they are drawn (by the turn they leave from, then by creation time). A branch of branch 1 is `1.1`, and so on.
The numbers are computed from the tree, never stored.

### Titles

- The conversation's title and the root thread's title are one title. Renaming either changes both.
- A title cut from a prompt uses the user's own words, not a quoted selection, and is cut at a word boundary.
- A title has a source: `prompt` (cut from the first prompt), `model` (a 2 to 5 word title the model wrote), or `user` (typed by the user).
- In live mode, when the first turn of a thread finishes and its title source is still `prompt`, the app asks the model for a short title and applies it if the source is still `prompt` at that moment.
- A title typed by the user is never replaced. Conversations saved before title sources existed count as `user`.
- The title request is not a turn: it shows nowhere, never blocks the composer, and fails silently (the prompt title stays).
- Demo mode and no-key mode make no title requests.

### Canvas

- Canvas keys (arrows, F, Enter, Escape) act only when no modifier is held and the focus is on the page or the canvas, never while another control is using those keys.
- A revealed card ends up clear of the minimap and the zoom controls. While the selected card grows with a streaming answer, the view follows its bottom edge until the user moves the view.
- The tree grows left to right. Positions always come from the layout function. Cards are not draggable. The canvas pans and zooms.
- A branch card is placed so that its header lines up with the turn it leaves from whenever there is room, so the first branch of a turn connects with a straight line. Later branches stack below without overlap.
- Selecting a card marks it and the path of cards and edges back to the root. That path is exactly the context the model sees.
- Below about 55% zoom the turn text is unreadable, so each card shows its title in large type instead (same card size, so nothing moves).
- Opening a conversation shows the root card at a readable zoom. It never shrinks the whole tree to fit unless the user presses Fit view.

### Sending

- The composer has two actions. **Continue** (Enter) adds the turn to the selected card. **Branch off** (Ctrl+Enter) puts the turn in a new branch card after the last turn. Shift+Enter makes a new line.
- **Branch** on a turn creates an empty branch card after that turn, selects it, and focuses the composer. An empty branch that loses selection is discarded.
- Selecting text inside an answer offers "Add to output" (an excerpt clip) and "Branch with selection" (a new branch whose prompt box starts with the selection as a quote).
- An excerpt keeps its markdown (bold, lists, code blocks with their language) and never includes interface text such as a code block's language label.
- The same excerpt cannot be added twice. Retrying a turn removes that turn's excerpt clips, because their text came from the old answer.
- Each thread has its own unsent draft. Text typed for one card never moves to another card. A discarded branch takes its draft with it. Drafts are kept in the browser's local storage, so they survive a reload.
- Clearing a title and confirming cancels the rename.

### Rules that keep the tree valid

- Several threads may have a turn in flight at once. One thread has at most one.
- Switching to another conversation never stops an answer. It keeps streaming and saving in the background, and the sidebar shows that the conversation is live.
- Branching is offered on `complete` and `truncated` turns, and on `stopped` turns that have text.
- A turn that has branches cannot be removed or retried.
- A `failed` or `stopped` last turn can be retried (the same prompt runs again) or removed.
- The composer is disabled while its thread has a turn in flight, and while the last turn is `failed`.
- If the root thread has no turns left, the start box is shown again and sending re-titles the thread and the conversation.
- On load, any turn still `waiting` or `streaming` becomes `stopped` (if it has text) or `failed` with the reason "Interrupted". The same applies to the output.
- Deleting a thread deletes its whole subtree and the clips that point into it. The root thread cannot be deleted.
- Closing the page mid-answer loses at most the last two seconds of text. The turn is recovered as `stopped`.
- The selected card is always a visible card. Selecting a card inside hidden branches shows those branches first. Hiding branches that contain the selection moves the selection to the card that hides them.

### Saving and two tabs

- Every save says which stored version it is based on (`X-Base-Version`). The server refuses a save based on an old version with 409.
- A refused save puts the conversation into a named conflict state: saving stops, and a bar offers "Load the other version" or "Keep this tab's version" (or "Keep it" / "Close it" when it was deleted elsewhere). Nothing is ever overwritten silently.
- A save that fails for another reason is retried every 5 seconds until it works. Pending saves are flushed when the page is hidden.
- A tab that only reads a conversation never saves it. Repairs made on load (an interrupted turn shown as stopped) are not written back.
- A conflict or a failed save on a conversation that is not open is shown on its row in the sidebar.
- Leaving the page while a conversation is in conflict, or has a failed save, asks for confirmation first.
