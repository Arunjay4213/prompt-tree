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
- `pnpm dev:demo` does the same in demo mode (the server gets `--demo`): recorded and sample answers, no key, no cost (see "Demo mode" below).
- Demo mode is on when the server is started with `--demo` or when `DEMO_MODE=1` is in the environment or `.env`. Scripts use `--demo`, because `VAR=value command` does not work in Windows shells.
- `pnpm typecheck` checks both the web app and the server.
- `pnpm e2e` drives the running demo app in a real browser through the main flows (`tools/e2e.mjs`). Run `pnpm dev:demo` first.
- `pnpm build` then `pnpm start` serves the built app from the server alone; `pnpm start:demo` does the same in demo mode.
- Keys live in `.env`. Never read, print, or commit `.env`.
- Models come from providers. A provider is active when its key (or base URL) is set in `.env`; see "Models and providers" below.
- `PORT` overrides the server port (the Vite proxy follows it).

## Layout of the code

- `shared/api.ts` is the contract: the conversation data shapes and the HTTP API. Read it first.
- `server/` is a small Hono server: a stateless streaming proxy to the model providers plus a JSON file store (`data/conversations/<id>.json`, or `data/demo/<id>.json` in demo mode).
- `server/providers/` has one file per provider. Each exports the same small function shape, so adding a provider is adding one file and one line in the registry.
- `src/` is the React app (Vite, TypeScript, Tailwind v4, `@xyflow/react` for the canvas, zustand for state, Radix primitives for tooltips and dialogs).
- `src/tree.ts` holds all tree logic as pure functions over `Conversation`.
- `src/store.ts` holds the state, the streaming, and the saving.
- The web app owns the conversation state. It saves the whole conversation with `PUT` after changes. The server never edits a conversation.

## Engineering rules

- Simple, robust code. Plain functions. No abstraction with a single caller. No speculative options.
- No unit-test suites. Verify by running the real app end to end in a browser and looking at it.
- Checks stay small. A check covers the change that was just made, runs in under two minutes, and is thrown away afterwards. Do not build up private check scripts across rounds and do not re-run everything after every change.
- The repo keeps exactly one smoke script, `tools/e2e.mjs`: the main path only, about a minute to run. A new feature does not add a flow to it unless it is part of the main path.
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
  - **Move to a new branch** (on any turn except the first of a card) moves that turn and the later turns of the card into a new branch card.
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

### Models and providers

- Providers: `openai` (OpenAI Responses API), `anthropic` (Claude, Messages API), `compatible` (any OpenAI-compatible Chat Completions endpoint, for example OpenRouter, Ollama, LM Studio, Groq, or Gemini's compatible endpoint), `opencode` (a local opencode V2 server the person runs with `opencode serve`), and `demo` (recorded and sample answers, see "Demo mode" below).
- A model id is `<provider>:<model name>`, for example `openai:gpt-6-luna` or `anthropic:claude-opus-5-5`.
- `.env` decides what is available: `OPENAI_API_KEY` with optional `OPENAI_MODELS`; `ANTHROPIC_API_KEY` with optional `ANTHROPIC_MODELS`; `COMPATIBLE_BASE_URL` with `COMPATIBLE_MODELS`, optional `COMPATIBLE_API_KEY` and `COMPATIBLE_NAME`. `OPENCODE_URL` and `OPENCODE_PASSWORD` (the opencode server's own password) with optional `OPENCODE_MODELS`; `DEFAULT_MODEL` picks the default.
- The opencode provider never sees a model login: opencode holds the person's access (a ChatGPT plan, Copilot, API keys, local models) and prompt-tree only talks to its local server. Each request uses a fresh opencode session with every tool denied, sends the branch's history as one transcript prompt, and deletes the session afterwards. prompt-tree gives opencode a plain chat agent of its own (a file in the work folder it uses for sessions), so opencode's coding instructions are replaced. Sessions are titled `prompt-tree request`, and leftovers with that title are removed at startup.
- The server reports the available models in `GET /api/health`. Every completion request names its model.
- The person picks the model in the composer. The choice is remembered in the browser and applies to the next message, so different branches can use different models.
- Each turn records the model that answered it, and its label is shown on the turn. Retry uses the turn's own model when it is still available, otherwise the current choice.
- Title requests and Combine use the same model as the turn or the current choice.

### Demo mode

- Demo mode (`--demo` or `DEMO_MODE=1`) makes no network calls and needs no key.
  It offers two demo models, `demo-a` and `demo-b`, so the picker can be tried.
- Demo mode stores its conversations in a separate folder (`data/demo`), so demo and test conversations never mix with real ones in `data/conversations`.
- The app ships one conversation recorded from a real model, `server/demo/sample.json`, with `server/demo/script.json` holding the one thing a conversation does not store: the question that was asked with Ask each.
- At server start in demo mode, when `data/demo` has no conversations, the sample is copied in as a normal conversation (same id, `createdAt` and `updatedAt` set to the start time).
  A deleted sample comes back only when the folder is empty at a later start.
- If the sample cannot be read, demo mode still works with the sample answer only, and the server logs one line saying so.
- `GET /api/health` in demo mode carries `demo.suggestedPrompt`, the sample's first question.
  The start screen offers it as a "Try: ..." button.
- Each demo answer streams in small pieces over about two seconds. It is chosen by these rules, first match wins:
  1. Combine: the sample's combined document when every collected item comes from the sample (its text, ignoring whitespace, is found in one of the sample's recorded answers).
     Otherwise a demo document that says demo mode does not call a model, then the collected items in order, each under a short heading with its branch.
  2. The Ask each rewrite: a JSON array with one prompt per option.
     When the question says "each" (or "each one", "each option", "each of them"), the first of those words is replaced with the option title ("What does each cost?" becomes "What does Trains cost?"); otherwise the prompt is "For <option>, <question>" with the question's first letter in lower case.
     When the question equals the sample's Ask each question, the sample's recorded prompts instead.
  3. A message equal to a prompt in the sample (trimmed, any case, whitespace collapsed): that turn's recorded answer.
  4. A message that names one of the sample's options (the titles of the branches that leave from the sample's first turn, any case): that branch's first answer.
  5. Anything else: a short sample answer that says it is one, with three options under headings, a list and a code block.
     Its options show when the question asked for options, and Ask each shows when a follow-up says "each"; the answer's second sentence tells the visitor so.
- Turns in the sample name the real model that wrote them (for example `openai:gpt-6-luna`).
  Their label shows it, and new messages and retries use a demo model.

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

- The composer has two actions. **Send** (Enter) adds the turn to the selected card. **New branch** (Ctrl+Enter) puts the turn in a new branch card after the last turn. Shift+Enter makes a new line.
- **Another branch from the same message**, on a branch, creates an empty sibling branch from the same turn.
- **New branch** with an empty box creates an empty branch card after the last turn and focuses its composer, so a person can branch first and type second.
- **Branch** on a turn creates an empty branch card after that turn, selects it, and focuses the composer. An empty branch that has no draft and loses selection is discarded. An empty branch that has a draft is kept.
- **Ask each**: when the last answer of the selected thread contains options (see Branch per option below), or when the text being typed asks about each of them ("each", "both", "every", "all the options") and the last answer has headings or a list that would count as options, the composer offers a third action, "Ask each" (Ctrl+Shift+Enter). It sends one question to every option at once: one branch per option, each titled with its option (a user title), each with the question rewritten to ask about only that option, all streaming in parallel. The first new branch is selected.
  - The rewrite is one small request to the current model before the branches start: it gets the answer, the option titles, and the question, and returns one prompt per option. It is not a turn and shows nowhere except as a short "splitting" state in the composer.
  - If the rewrite fails, is cut off, returns the wrong number of prompts, or no model is available, each branch gets the original question with its option quoted above it. The split always happens.
  - Enter never splits. When the text contains a word such as "each", "both", "every" or "all the options", the Ask each button is drawn as the primary action as a hint, and Send as secondary.
  - An option that already has a branch still gets a new one: the question is new.
- **Branch per option**: when an answer contains a set of options (two to eight headings of the same level; or else its first top-level list of two to eight items, but only when that list is numbered or every item starts with a bold name; a plain bulleted list of sentences is not a set of options), the options are listed under the answer. Choosing one creates a branch after that turn, titled with the option (a user title, never replaced automatically), whose draft starts with the option quoted. "Branch all" creates one branch per option and selects the first. An option that already has its branch is shown as a link to it instead.
  Headings or list items count as options only when the message that produced the answer asked for alternatives (`askedForAlternatives`: it names options, alternatives, ways, ideas, approaches and similar words).
  Otherwise they are sections of one answer: no "Branch per option" row and no Ask each from that answer, except when the text being typed asks about each of them (see Ask each).
- Selecting text inside an answer offers "Add to output" (an excerpt clip) and "Branch with selection" (a new branch whose prompt box starts with the selection as a quote).
- A branch's Thread tab shows the whole conversation it sees, ancestors first, in full.
  Earlier messages from ancestors can only be read, copied and collected; a clip taken from one belongs to the card that owns that message, not to the open branch.
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
