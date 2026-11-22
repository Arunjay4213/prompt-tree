# prompt-tree

A local web app for talking to a model in a tree of cards instead of one long chat.
Each card is a thread of prompts and answers, and each branch only sees the messages on its own path back to the root, so side questions never leak into the main line.
For every message you choose whether it continues the current card or starts a new branch, and you can change your mind later by splitting a card or merging a branch back into its parent.
When you are done, you clip the answers or excerpts you want from any branch and combine them into one final output.

The model is OpenAI `gpt-6-luna`, called through the Responses API.

## Setup

You need Node 22 and pnpm.

```sh
pnpm install
cp .env.example .env
```

Then open `.env` and set `OPENAI_API_KEY`.
`OPENAI_MODEL` and `PORT` are optional overrides.
Never commit `.env`.

## Run

- `pnpm dev` starts the server on port 8787 and the web app on http://localhost:5173 (Vite proxies `/api` to the server).
- `pnpm dev:demo` does the same in demo mode: placeholder answers, no key needed, no money spent.
- `pnpm build` then `pnpm start` serves the built app from the server alone, on http://127.0.0.1:8787.
- `pnpm typecheck` checks the web app and the server.
- `pnpm e2e` drives the running demo app in a real browser through the main flows. Start `pnpm dev:demo` first.

## How to use it

Type a first question on the start screen.
The answer appears in the root card on the canvas and in the panel on the right.

**Sending.**
The composer has two actions.
Continue (Enter) adds the turn to the selected card.
Branch off (Ctrl+Enter) puts the turn in a new branch card after the last turn.
Shift+Enter makes a new line.

**Branching from an earlier point.**
Press Branch under any finished answer to start an empty branch card right after that turn.
Select text inside an answer to get two options: Add to output (an excerpt clip) and Branch with selection (a new branch whose prompt starts with the selection as a quote).

**Keeping the tree readable.**
Each card can be folded to one line, and a card can hide its branches (the whole subtree below it).
Fold all cards and Open all cards are in the top bar.
Below about 55% zoom, cards show their title in large type instead of the turns.

**Changing your mind.**
Split off (on any turn except the first of a card) moves that turn and the later ones into a new branch card.
Merge into parent (on a card that branches from the last turn of its parent) appends its turns to the parent card.
Both keep the model context of every turn exactly the same.

**Clips and Combine.**
Clip a whole answer with Add to output under it (or the clip button on the card), or an excerpt through a text selection.
The Output tab lists the clips in order.
You can reorder them, remove them, copy them as markdown, or press Combine into one document to have the model merge them, with an optional note on how.
The combined document can be copied or downloaded as a `.md` file.

**Titles.**
A card starts with a title cut from its first prompt.
With a real key, the model then writes a short title of 2 to 5 words.
Click a title in the panel or the top bar to rename it; a title you typed is never replaced.

**Keyboard on the canvas** (when you are not typing):

- Arrow keys move the selection: Left to the parent, Right to the first branch, Up and Down to siblings.
- Enter focuses the composer for the selected card.
- F folds or opens the selected card.
- Escape clears the selection.
- Alt+N starts a new conversation (anywhere in the app).

## How it works

**Storage.**
Conversations are stored as JSON files in `data/conversations/<id>.json`, one file per conversation.
The web app owns the conversation state and saves the whole conversation with `PUT` after changes.
The server stores each file as it was sent and never edits it.

**Model context.**
For a new turn in a branch, the app walks from that branch up through its parents to the root.
From each ancestor it takes the turns up to and including the turn the child branched from, then the earlier turns of the branch itself, then the new prompt.
Sibling branches are never included.
The selected card and its path back to the root are marked on the canvas, so you can see exactly what the model sees.

**Saving from two tabs.**
Every save sends the stored version it is based on in the `X-Base-Version` header.
If another tab or window saved a newer version (or deleted the conversation), the server refuses the save with 409.
The tab then stops saving and shows a bar where you choose to load the other version or keep this tab's version, so nothing is overwritten silently.
A save that fails for another reason is retried every 5 seconds.

**Streaming.**
`POST /api/complete` is a stateless proxy that streams the model's answer as Server-Sent Events.
Several branches can stream at once, and an answer keeps streaming and saving when you switch to another conversation.

## Project layout

- `shared/api.ts` - the contract between the web app and the server: data shapes and the HTTP API.
- `server/index.ts` - the Hono server: JSON routes, the streaming route, and serving the built app.
- `server/model.ts` - the model call in live, demo and no-key mode.
- `server/store.ts` - the JSON file store with atomic writes and the version check.
- `src/tree.ts` - all tree logic as pure functions (branch, split, merge, delete, context, numbering, layout).
- `src/store.ts` - the app state (zustand), streaming, and saving.
- `src/api.ts` - fetch helpers and the stream reader.
- `src/text.ts` - text helpers for previews, times, copy and download.
- `src/components/` - the React interface: canvas, cards, panel, sidebar, top bar, composer.
- `src/components/canvas/` - edges, minimap, geometry and keyboard navigation for the canvas.
- `src/components/panel/` - the parts of the Thread and Output tabs.
- `src/index.css`, `src/canvas.css`, `src/panel.css` - design tokens and styles.
- `tools/e2e.mjs` - the end-to-end browser run behind `pnpm e2e`.
- `data/` - stored conversations (not committed).
- `CLAUDE.md` - behaviour specification and engineering rules.
- `DESIGN.md` - visual specification.

## Credits

- [React Flow](https://reactflow.dev) by xyflow for the pan and zoom canvas.
- [Geist](https://vercel.com/font) and Geist Mono fonts.
- [Lucide](https://lucide.dev) icons.
- [Radix](https://www.radix-ui.com) primitives for tooltips and dialogs.
- [dnd-kit](https://dndkit.com) for reordering clips.
