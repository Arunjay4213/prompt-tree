# prompt-tree visual design

This file is the visual specification.
The behaviour specification is in `CLAUDE.md`.
The quality bar is the page https://arunjay.dev/blamingo .
prompt-tree uses the same design language: light, precise, quiet, with hairlines, mono labels, and one accent color.

## 1. Principles

1. **One accent.** Black, off-white, warm grays, and orange. No other hue, except the pass and fail colors for status.
2. **Lines, not shadows.** Structure comes from 1px hairlines and spacing. No drop shadows, no gradients, no glow, no blur.
3. **Labels are mono, uppercase, and small.** Content is Geist. Metadata, counts, numbers, statuses and key hints are Geist Mono.
4. **Numbers identify things.** Branches are identified by a path number (`1`, `1.2`, `1.2.1`), never by a color.
5. **Orange means "this is in the output" or "this is happening now".** Clips and live activity. Nothing else is orange at rest.
6. **Black means "selected".** The selected card, the path back to the root, the active tab, the primary button.
7. **Nothing jumps.** Every change of position or size is animated. Nothing appears at a wrong place and then moves.
8. **Every state is designed.** Empty, loading, live, failed, disabled, hover, focus, and overflow each have a deliberate look.

## 2. Tokens

Define these once in `src/index.css` under `@theme` and use them everywhere. Never write a raw hex value in a component.

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#fdfcfc` | page, panels, cards |
| `--color-surface` | `#f1efec` | canvas background, hover fill, inset areas |
| `--color-fg` | `#09090b` | text, selected borders, primary button |
| `--color-muted` | `#5f5e5a` | secondary text, answer previews |
| `--color-faint` | `#8f8d88` | labels, metadata, placeholder |
| `--color-line` | `#c6c4bf` | borders of cards, panels, inputs |
| `--color-line-soft` | `#e4e2de` | dividers inside a card or list, canvas grid |
| `--color-accent` | `#ff6600` | clips, live indicator, focus ring, primary hover |
| `--color-accent-soft` | `#fff1e6` | background of a clipped row or an "in output" tag |
| `--color-pass` | `#1f7a4d` | "live" dot, saved state |
| `--color-fail` | `#c2410c` | failed turn, destructive hover, "not saved" |
| `--color-panel` | `#141417` | code block background |
| `--color-panel-2` | `#1f1f23` | code block header |
| `--color-panel-line` | `#2e2e34` | lines inside a code block |
| `--color-panel-fg` | `#e9e7e3` | code text |
| `--color-panel-muted` | `#9a9893` | code block label |
| `--radius-cell` | `6px` | buttons, inputs, cards, tags |
| `--radius-panel` | `10px` | code blocks, dialogs |
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | all motion |

Fonts: `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, imported in `src/main.tsx`.

- `--font-sans`: `"Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`
- `--font-mono`: `"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

Global: `-webkit-font-smoothing: antialiased`, `text-rendering: optimizeLegibility`, `::selection` is black on off-white inverted (`background: fg; color: bg`), `:focus-visible` is `outline: 2px solid accent; outline-offset: 2px`.

## 3. Type

| Style | Font | Size / line | Weight | Tracking | Color |
|---|---|---|---|---|---|
| Display (empty state heading) | sans | 44px / 1.05 | 400 | -0.04em | fg |
| Panel title (thread title) | sans | 22px / 1.2 | 500 | -0.02em | fg |
| Reading body (answers) | sans | 15px / 1.6 | 400 | 0 | fg |
| Prompt in panel | sans | 15px / 1.5 | 500 | -0.005em | fg |
| Card title | sans | 13.5px / 1.3 | 500 | -0.005em | fg |
| Card prompt | sans | 13px / 1.4 | 500 | 0 | fg |
| Card answer preview | sans | 13px / 1.45 | 400 | 0 | muted |
| UI text (buttons, list items) | sans | 13.5px / 1.3 | 500 | -0.005em | fg |
| Label | mono | 11px / 1.4 | 400 | 0.12em, uppercase | faint |
| Small label (inside cards) | mono | 10.5px / 1.4 | 400 | 0.1em, uppercase | faint |
| Number (path, counts) | mono | same as its label | 400 | 0.04em, tabular-nums | faint or fg |

Use `text-wrap: balance` on headings and `text-wrap: pretty` on reading text.

## 4. Components

### Icons

Fold = `ChevronsDownUp`, open = `ChevronsUpDown`, fit view = `Maximize`, branch = `GitBranch`, clip = `Paperclip`, delete = `Trash2`, copy = `Copy`. The same action uses the same icon everywhere (top bar, thread header). The one exception is the card header on the canvas, whose fold control is a single chevron that rotates.

### Buttons

- **Primary**: height 34, padding 0 14, radius 6, background fg, text bg, 1px fg border. Hover: background accent, border accent, text fg. Transition 150ms.
- **Secondary**: same size, transparent, 1px line border, text fg. Hover: border fg.
- **Ghost / icon button**: 28 by 28, radius 6, icon 15px stroke 1.5, color muted. Hover: background surface, color fg. Active state (toggled on): color fg, or accent for the clip toggle.
- **Destructive**: a secondary button whose hover border and text are `fail`.
- Disabled: opacity 0.4, `cursor: not-allowed`, and a tooltip that says why.
- Key hints sit inside or beside buttons as mono small labels, for example `ENTER`.

### Tag

Height 22, padding 0 8, 1px line border, radius 6, mono 10.5px uppercase tracking 0.1em, color muted. Optional 6px dot before the text.
The "in output" variant: background accent-soft, border accent, text fg.

### Tooltip, dialog, popover

Use Radix primitives (`@radix-ui/react-tooltip`, `@radix-ui/react-dialog`, `@radix-ui/react-popover` as needed). Never use `title` attributes, `window.confirm`, or `window.alert`.

- Tooltip: background fg, text bg, mono 10.5px uppercase tracking 0.08em, padding 5px 8px, radius 6, 400ms open delay, 6px offset.
- Dialog (confirm delete): centered box, background bg, 1px fg border, radius 10, corner ticks, overlay `rgba(9,9,11,0.25)`. Title 18px weight 500, body 14px muted, buttons right-aligned: secondary Cancel, destructive confirm.
- Conflict bar layout: when the canvas column is wide, the message is on the left and the two buttons on the right; when it is narrow, the message takes the full width and the buttons sit on a row below it. Nothing overlaps at any width from 320px.
- Conflict bar (a save was refused because the conversation changed elsewhere): a full-width strip at the top of the canvas column, under the top bar, background `bg`, bottom hairline in the fail color, a 6px fail dot, the message in UI text, and two small buttons on the right (secondary and ghost). The top bar save label reads `CONFLICT` in the fail color.
- Toast ("Copied", "Not saved"): bottom center of the canvas, background fg, text bg, mono label style, radius 6, slides up 8px and fades, leaves after 1.8s.

### Corner ticks

The Blamingo signature: a small L mark just outside each corner of a box (7px long, 4px outside, 1.5px, color fg).
Copy the `.ticks` rule from the Blamingo stylesheet.
Use it on exactly three things: the selected card on the canvas, the empty-state prompt box, and the combined document box in the Output tab.

### Code blocks and markdown

- Fenced code: dark panel (`panel` background, radius 10), a header strip (`panel-2`, bottom line `panel-line`) with the language as a mono label and a Copy icon button on the right, code in mono 12.5px / 1.55, color `panel-fg`, horizontal scroll inside the block, never wider than the column.
- Syntax colors: a restrained theme. Keywords `#ff9d5c` (soft orange), strings `#b9d7a8`, comments `panel-muted`, numbers and literals `#e9c98a`, everything else `panel-fg`.
- Inline code: mono 0.9em, background surface, radius 4, padding 1px 5px.
- Headings inside answers: weight 500, tight tracking, sizes 20 / 17 / 15. Lists with comfortable spacing. Links underlined with `line` color, underline turns accent on hover.
- Tables: hairline cells (`line-soft`), header row in mono small label style, horizontal scroll if too wide.
- Blockquotes: 2px fg left bar, muted text.

## 5. Layout

Full window, no page scroll. Three columns separated by 1px `line` hairlines. All backgrounds are `bg` except the canvas.

```
┌──────────────┬───────────────────────────────────────────┬──────────────────────┐
│ Sidebar      │ Top bar (48px)                            │ Tabs (48px)          │
│ 248px        ├───────────────────────────────────────────┤ THREAD   OUTPUT 3    │
│              │                                           ├──────────────────────┤
│              │ Canvas                                    │ Panel body           │
│              │                                           │ 480px, resizable     │
│              │                                           │ 380 to 720           │
│              │                                           ├──────────────────────┤
│              │                                           │ Composer             │
└──────────────┴───────────────────────────────────────────┴──────────────────────┘
```

- The sidebar can be collapsed with a button in the top bar (it slides out, 250ms). The state is remembered.
- The right panel is resized by dragging its left edge (a 6px invisible grab zone; the hairline turns fg on hover and while dragging). The width is remembered.
- Minimum supported window: 1100 by 640. Below 1100 wide the sidebar starts collapsed.

### Sidebar

- Top (48px, bottom hairline): the mark and the wordmark `prompt-tree` (sans 15px weight 500, tracking -0.01em). The mark is a small tree glyph drawn with 1.5px lines and filled dots, like the Blamingo diagrams: one dot on the left, lines with right angles to three dots on the right, the middle one orange.
- A full-width primary button "New conversation" with a plus icon and the key hint.
- Label `CONVERSATIONS`.
- List rows, 1px `line-soft` divider between rows: title (UI text, one line, ellipsis), below it a mono small label `6 THREADS · 2H AGO`.
  Active row: a 2px fg bar on the left edge and background surface. Hover: background surface.
  On hover a ghost trash button appears at the right; it opens the confirm dialog.
  A row whose conversation is in conflict shows a 6px fail dot and `CONFLICT` in the fail color in place of the time; a failed save shows `NOT SAVED` the same way.
- Bottom (top hairline, 40px): the model tag, mono small label: a 6px dot (pass color for live, accent for demo, fail for no key) and `GPT-6-LUNA`, or `DEMO MODE`, or `NO API KEY`. A tooltip explains the mode.

### Top bar

The bar degrades in a fixed order as it gets narrower, and nothing ever overflows or overlaps: first the counts label is dropped, then the mode tag shortens to its dot and one word, then the save state becomes a colored dot with a tooltip. The title keeps at least 120px. The sidebar toggle and the three icon buttons are always fully visible.

Left: sidebar toggle, then the conversation title (UI text 14px weight 500; click to edit in place, Enter saves, Escape cancels).
Middle-left after the title: a mono label with counts, for example `6 THREADS · 14 TURNS`.
Right: save state as a mono small label (`SAVED`, `SAVING`, or `NOT SAVED` in fail color), then ghost buttons: Fold all, Open all, Fit view.
In demo mode or no-key mode a tag sits before the save state (`DEMO - PLACEHOLDER ANSWERS`, or `NO API KEY` with the fix in its tooltip).

## 6. Canvas

- Background `surface` with a line grid: 1px `line-soft` lines every 24px (the Blamingo hero panel look). The grid pans and zooms with the content.
- Zoom range 0.35 to 1.5. Pan by dragging the background or two-finger scroll. Zoom with pinch or Ctrl+scroll.
- Bottom-left: a vertical control group (zoom in, zoom out, fit) as joined ghost buttons in a `bg` box with a `line` border.
- The React Flow attribution stays on (hiding it prints a console warning in development). It is restyled as a quiet mono small label in faint color with no background, 8px inside the top-right corner of the canvas.
- Bottom-right: a minimap, 160 by 110, `bg` background, `line` border, cards as `line` rectangles, the selected card fg, the viewport as a 1px fg outline. No colored mask.

### Card

Width 380. Background `bg`. Border 1px `line`. Radius 6. No shadow.

```
┌────────────────────────────────────────────┐
│ 1.2   Thread title here              3  ⌄ │  header, 40px
├────────────────────────────────────────────┤
│ 01  What about using sqlite instead?       │  turn row
│     Answer preview in muted text that     ●│  ● = port where a branch leaves
│     clamps after four lines of text...     │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤  line-soft divider
│ 02  And how does that scale?               │
│     ...                                    │
└────────────────────────────────────────────┘
```

- **Header** (padding 0 12, bottom hairline `line-soft` when open): path number as a mono number in faint (`ROOT` for the root thread), the title (card title style, one line, ellipsis), then on the right the turn count as a mono number, a `+3 HIDDEN` tag when branches are hidden (click shows them), and the fold chevron ghost button (rotates 180 degrees, 200ms).
- **Turn row** (padding 10 12): a 24px left gutter with the turn index as a mono number (`01`, `02`), then the prompt (card prompt style, max 2 lines) and the answer preview (max 4 lines, plain text with markdown stripped).
  Hover: background `surface` at 50% and two ghost buttons (clip toggle, branch) appear at the right end of the prompt's first line. That space is always reserved, so text never sits under a button.
- **Clipped turn**: a 2px accent bar on the left edge of the row, the turn index in accent, and the clip toggle always visible in accent. If the turn has excerpt clips, a small "in output" tag `2 EXCERPTS`.
- **Live turn**: instead of the preview while waiting, a mono small label `THINKING` with three dots that pulse in sequence. While streaming, the preview shows the last four lines of the text and a 6px accent dot pulses next to a `WRITING` label.
- **Stopped turn**: the preview plus a mono small label `STOPPED`.
- **Failed turn**: a mono small label `FAILED` in fail color and the error message in muted text, max 2 lines.
- **Port**: where a branch leaves a turn, a 7px filled circle sits centered on the card's right border at that row (fg when on the selected path, `faint` otherwise).
- **Folded card**: header only (40px). If it contains clips, a small accent square and the clip count appear before the turn count. If it has a live turn, the accent pulse dot appears there too.
- **Empty new branch**: dashed 1px `line` border, header shows the path number and `NEW BRANCH`, body is one line of muted text: "Write the first prompt in the panel."
- Card borders stay at least one screen pixel wide at every zoom level.
- **Selected card**: border 1.5px fg and corner ticks. Do not change the card's size when selected (compensate the border so nothing shifts).
- **Cards on the path to the root** (ancestors of the selected card): border 1px fg.
- **Hover on a card that is not selected**: border `faint`.
- Cards never get dimmed.

### Placement

- Columns: card width 380, column gap 72. Rows: at least 24 between cards in the same column.
- A branch card's header center lines up with the port of the turn it leaves from when there is room, so the first branch of a turn is joined by one straight horizontal line. Otherwise it sits 24 below the card above it and the edge steps down.
- When a conversation opens, the view shows the root card at the top left with 48px of margin at zoom 1 (or the saved selection's card). It does not shrink the tree to fit.
- Fit view (the button) fits the whole visible tree, zoom between 0.35 and 1.

### Overview mode (zoom below 0.55)

Turn text is unreadable when zoomed far out, so below 0.55 zoom every card switches to an overview look with the same outer size:
the body text is hidden and the thread title is shown in large type (sized so it reads like 13px on screen, max 3 lines, weight 500) next to its path number, with the clip count and live dot if any.
Switching between the two looks is a 150ms cross-fade, and it never changes the layout.

### Edges

- Orthogonal lines with rounded corners (step edges, corner radius 8), never curves.
- 1.5px, color `line`. On the selected path: fg. The path edges are drawn above the others.
- An edge starts at the port of the turn it branches from and ends at the middle of the left side of the child card's header.
- Lanes: a straight edge needs no vertical part. Every other edge turns down inside the gap between the two columns. Each port that has stepped edges gets its own vertical lane there, so edges from different turns never share a vertical line. The topmost port takes the rightmost lane and each lower port the next lane to the left (this order makes crossings impossible). Lanes are 8px apart and stay at least 12px away from both columns; with many lanes the spacing shrinks to fit.
- When a branch is created, its edge draws in from the port to the card (stroke dash animation, 400ms expo) and the card fades in and rises 8px (300ms expo).

### Motion on the canvas

- Card position changes: 350ms expo on the transform.
- Card height changes while streaming are immediate (text grows naturally), and the cards below follow with the position animation.
- A new or newly selected card that is outside the view is brought into view by a smooth pan (400ms), without changing the zoom. Never refit the whole tree unless the user presses Fit view.
- With `prefers-reduced-motion: reduce`, all of this is instant.

### Keyboard on the canvas

When focus is not in a text field: Left goes to the parent card, Right to the first branch, Up and Down to the previous and next sibling (or the nearest card in the same column), Enter focuses the composer, `F` folds or opens the selected card, Escape clears the selection.

## 7. Right panel

### Tabs

A 48px strip with a bottom hairline. Two tabs as mono labels: `THREAD` and `OUTPUT`. The Output tab shows the clip count as a mono number after the word; when a clip is added the number flashes accent once (600ms).
The active tab is fg with a 1.5px fg underline that sits on the hairline. The inactive tab is faint, fg on hover.

### Thread tab

Padding 24px left and right. Three zones: a fixed header (breadcrumb, title, actions) with a bottom hairline, a scrolling body (inherited context, then the turns), and the composer fixed at the bottom.
Selecting a thread shows its latest turn: if that turn fits in the body, the body is scrolled to the bottom; if it is taller than the body, its first line (the `YOU` label) is placed at the top of the body. The header is always visible.

1. **Breadcrumb**: mono small labels, the ancestor path numbers and titles separated by `/`, for example `ROOT / 1 PRICING / 1.2`. Each ancestor is clickable (fg on hover). Truncate titles to about 18 characters.
2. **Title**: panel title style. Click to edit in place. Below it a row of small secondary buttons with icons and text: Fold (or Open), Hide branches (or Show branches), Merge into parent, and Delete (destructive) pushed to the right. Disabled ones explain why in a tooltip.
3. **Inherited context**: a collapsed row with a top and bottom `line-soft` hairline: mono label `INHERITED CONTEXT · 3 TURNS` and a chevron. Expanded, it lists the ancestor turns in a condensed, muted form (prompt in fg 13.5px, answer clamped to 3 lines in muted, each with its thread path number). Hidden for the root thread.
4. **Turns**. Each turn:
   - A label row: the turn index and `YOU` as a mono small label.
   - The prompt (prompt-in-panel style).
   - A label row: `LUNA` as a mono small label, and when live an accent pulse dot with `THINKING` or `WRITING`, and a small secondary Stop button on the right.
   - The answer as markdown (reading body).
   - An action row under the answer: ghost buttons with text, mono small label style: `ADD TO OUTPUT` (becomes the "in output" tag `IN OUTPUT` with a check icon when clipped; click removes), `BRANCH`, `SPLIT OFF` (not on the first turn), `COPY`. The row is faint at rest and fg on hover of the turn. On the last turn it is always fg.
   - If the turn has excerpt clips: a tag `2 EXCERPTS IN OUTPUT`.
   - If branches leave from this turn: a list of links under the action row, one per branch: a small corner arrow, the path number as a mono number, and the branch title. Click selects that branch.
   - 28px of space and a `line-soft` hairline between turns.
   - Failed turn: a box with a 1px fail border: label `FAILED`, the message, and two small buttons: Retry (secondary) and Remove (ghost).
5. **Selection bar**: when the user selects text inside an answer, a small bar appears just above the selection: background fg, radius 6, two text buttons in bg color separated by a hairline: `ADD TO OUTPUT` and `BRANCH WITH SELECTION`. It disappears when the selection collapses. It must not steal the selection when clicked (use mousedown preventDefault).
6. **Auto-scroll**: while an answer streams, the body stays pinned to the bottom only if the user was already at the bottom. If they scrolled up, do not move the view; show a small ghost button `JUMP TO LATEST` above the composer.

### Composer

- A top hairline, padding 16px 24px.
- A textarea with no border of its own inside a box with a 1px `line` border, radius 6; the box border turns fg when focused (no outline ring inside). Text 15px. Grows with the content up to 40% of the panel height, then scrolls. Placeholder in faint: "Continue this thread..." or, for a new branch, "First prompt of this branch...".
- Under the box, one row: on the left, when the panel is at least about 560px wide, a mono small label `SHIFT+ENTER NEW LINE`; on the right the secondary button "Branch off" with the key hint `CTRL+ENTER` inside it and the primary button "Continue" with the key hint `ENTER` inside it.
- The row must never wrap or cut text at any panel width from 380 to 720. At narrow widths the left label is dropped first.
- For an empty thread there is one primary button, "Send".
- When the thread is busy, the box is disabled and its placeholder says "Waiting for the answer..." (the left label says `WAITING FOR THE ANSWER` when there is room). When the last turn failed, it says `RETRY OR REMOVE THE FAILED TURN FIRST`.

### Output tab

1. Label `FINAL OUTPUT` and, when there are no clips, an empty state: a short heading (18px weight 500) "Nothing collected yet" and two lines of muted text that explain the two ways to add a clip, with the two icons shown inline.
2. **Clip list**, drawn as bordered cells (top and bottom hairlines, `line-soft` between). Each cell:
   - Left: a drag handle (six dots, faint, fg on hover) and the position as a mono number (`01`).
   - Top line: the branch path number and thread title as a mono small label, and a tag `EXCERPT` for excerpts.
   - The text, 13.5px, clamped to 4 lines, with a `SHOW MORE` text button when clamped.
   - On hover, on the right: ghost buttons Move up, Move down, Remove.
   - Click on the label line selects the clip's card and brings it into view on the canvas.
   - Drag to reorder with `@dnd-kit/sortable`: the dragged cell gets a 1px fg border and background bg, the others move smoothly.
3. A secondary button "Copy clips" under the list.
4. **Combine**: label `COMBINE`, a textarea box like the composer with the placeholder "Optional: how should these be combined?", and a primary button "Combine into one document". While it runs the button becomes a secondary Stop.
5. **Combined document**: a box with corner ticks, padding 20px, the markdown rendered as reading body. Above the box a label row: `COMBINED DOCUMENT` and the status (`WRITING` with the accent dot, `STOPPED`, `FAILED` in fail color), and on the right ghost buttons Copy and Download.

## 8. Empty states

- **No conversation open, or a new empty conversation**: the canvas shows, centered, a box 640px wide with corner ticks: a label `NEW CONVERSATION`, the display heading "What do you want to explore?", a borderless textarea (15px, 3 rows, grows), and a bottom row with the hint `ENTER TO START` on the left and the primary button "Start" on the right.
  Under the box, three columns of small text separated by hairlines, in the Blamingo "steps" style: `01 ASK` "Start with one question.", `02 BRANCH` "Follow side questions in their own cards. Each branch only sees its own path.", `03 COLLECT` "Pick the best parts from any branch and combine them."
  The right panel is hidden in this state, so the start box is centered in the whole area right of the sidebar. When the first prompt is sent, the panel slides in from the right (300ms expo).
- **Loading the conversation list or a conversation**: skeleton rows (surface-colored bars), never a spinner in the middle of the screen, never a blank flash.
- **A conversation failed to load**: a centered message with the reason and a Retry button.

## 9. Quality checklist (every screen must pass)

1. No text is cut off without an ellipsis, and no text overflows its box.
2. Spacing uses the scale 4, 8, 12, 16, 24, 32, 48. Left edges of labels and content line up inside each column.
3. Every interactive element has a hover state, a focus-visible ring, and a tooltip if it is an icon only.
4. Icons are the same size and stroke everywhere (15px, stroke 1.5).
5. No layout shift when hovering, selecting, toggling, or when a scrollbar appears (use `scrollbar-gutter: stable` and thin custom scrollbars in `line` color).
6. No flash of unstyled or mispositioned content on load or when switching conversations.
7. The canvas never shows overlapping cards or an edge running through a card.
8. Long content is handled: a 300-character title, a prompt with no spaces, a 500-line answer, a wide table, a wide code block, 40 cards.
9. The browser console is clean: no errors, no warnings from React, no failed requests.
