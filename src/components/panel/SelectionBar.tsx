import { useLayoutEffect, useRef } from "react";
import { addExcerptClip, branchFromTurn, selectOpenConversation, showToast, useStore } from "../../store";
import * as tree from "../../tree";
import { selectionMarkdown } from "./excerptMarkdown";
import { Tip } from "../ui";
import type { TurnRole } from "./TurnView";

// none:  no bar.
// shown: a finished selection inside one answer. `threadId` is the thread that owns the answer
//        (an ancestor for an earlier turn), `role` the role of that turn. `center` and `top` are in
//        the coordinates of the body content; `placement` is "above" the selection, or "below" it
//        when there is no room above.
export type BarState =
  | { kind: "none" }
  | { kind: "shown"; threadId: string; turnId: string; role: TurnRole; text: string; center: number; top: number; placement: "above" | "below" };

const BAR_HEIGHT = 32;
const GAP = 8;
const EDGE = 8; // the bar keeps this distance from the panel's edges

function answerOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-answer-turn]") ?? null;
}

// Reads the document selection. It counts only when it lies inside one answer of this body: a
// selection that reaches into a prompt, a button, or a second answer gives no bar.
export function readAnswerSelection(content: HTMLElement, scroller: HTMLElement): BarState {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return { kind: "none" };
  const range = selection.getRangeAt(0);
  const answer = answerOf(range.startContainer);
  if (!answer || !content.contains(answer)) return { kind: "none" };
  const visible = range.toString().trim();
  if (!visible) return { kind: "none" };
  let inAnswer = range;
  if (!answer.contains(range.endContainer)) {
    // A triple click ends the range at the start of the next element. That still counts when no
    // text outside the answer is selected.
    inAnswer = range.cloneRange();
    inAnswer.setEnd(answer, answer.childNodes.length);
    if (inAnswer.toString().trim() !== visible) return { kind: "none" };
  }
  // The excerpt is the selection as markdown, built from the selected elements.
  const text = selectionMarkdown(inAnswer, answer);
  if (!text) return { kind: "none" };
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  const first = rects[0];
  const last = rects.at(-1);
  if (!first || !last) return { kind: "none" };
  const origin = content.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  // Above the first line of the selection, or below its last line when the first line is too
  // close to the top of the visible body (below the answer's sticky label row, which stays on top).
  const stickyRow = answer.closest(".turn")?.querySelector<HTMLElement>("[data-answer-row]")?.offsetHeight ?? 0;
  const roomAbove = first.top - view.top >= stickyRow + BAR_HEIGHT + GAP + EDGE;
  const line = roomAbove ? first : last;
  return {
    kind: "shown",
    threadId: answer.dataset.answerThread ?? "",
    turnId: answer.dataset.answerTurn ?? "",
    role: answer.dataset.answerRole === "earlier" ? "earlier" : "own",
    text,
    center: (line.left + line.right) / 2 - origin.left,
    top: roomAbove ? first.top - origin.top - GAP : last.bottom - origin.top + GAP,
    placement: roomAbove ? "above" : "below",
  };
}

// The small black bar above a selection inside an answer: add it to the output as an excerpt, or
// start a branch whose prompt opens with it as a quote (not from an earlier turn). Pressing it never clears the selection
// first (mousedown is prevented), so the selected text is still there when the click lands.
export function SelectionBar({ state, onDone }: { state: BarState; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const turn = useStore((s) => {
    const conv = selectOpenConversation(s);
    return conv && state.kind === "shown" ? tree.findTurn(conv, state.turnId)?.turn : undefined;
  });

  // Keeps the bar inside the panel: its center is clamped once its width is known.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent || state.kind !== "shown") return;
    const half = el.offsetWidth / 2;
    const left = Math.min(Math.max(state.center, half + EDGE), parent.clientWidth - half - EDGE);
    el.style.left = `${left}px`;
  }, [state]);

  if (state.kind === "none") return null;
  const branchReason = turn && tree.canBranchFrom(turn) ? null : "Branching needs a finished answer";

  const finish = () => {
    window.getSelection()?.removeAllRanges();
    onDone();
  };

  return (
    <div
      ref={ref}
      data-testid="selection-bar"
      data-selection-bar
      data-placement={state.placement}
      role="toolbar"
      aria-label="Selection"
      onMouseDown={(e) => e.preventDefault()}
      style={{ left: state.center, top: state.top }}
      className={`selection-bar absolute z-20 flex h-8 w-max -translate-x-1/2 items-stretch rounded-cell bg-fg ${
        state.placement === "above" ? "-translate-y-full" : ""
      }`}
    >
      <button
        type="button"
        className={`${state.role === "own" ? "rounded-l-cell" : "rounded-cell"} px-3 text-[13px] font-medium whitespace-nowrap text-bg transition-colors hover:text-accent`}
        onClick={() => {
          const added = addExcerptClip(state.threadId, state.turnId, state.text);
          showToast(added === "added" ? "Added to output" : "Already in output");
          finish();
        }}
      >
        Add to output
      </button>
      {state.role === "own" && (
        <>
          <span aria-hidden className="my-2 w-px bg-muted" />
          <Tip content={branchReason}>
            <button
              type="button"
              aria-disabled={branchReason !== null || undefined}
              className="rounded-r-cell px-3 text-[13px] font-medium whitespace-nowrap text-bg transition-colors hover:text-accent aria-disabled:cursor-not-allowed aria-disabled:text-faint aria-disabled:hover:text-faint"
              onClick={() => {
                if (branchReason !== null) return;
                const quote = state.text
                  .split("\n")
                  .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
                  .join("\n");
                branchFromTurn(state.threadId, state.turnId, `${quote}\n\n`);
                finish();
              }}
            >
              Branch with selection
            </button>
          </Tip>
        </>
      )}
    </div>
  );
}
