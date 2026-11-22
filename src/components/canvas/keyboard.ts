// Keyboard navigation on the canvas: which card an arrow key moves the selection to.

import type { Conversation } from "../../../shared/api";
import * as tree from "../../tree";

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export function isArrowKey(key: string): key is ArrowKey {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
}

// Left: the parent card. Right: the first branch. Up and Down: the previous or next sibling,
// or else the nearest card above or below in the same column. Null when there is none.
export function cardInDirection(
  conv: Conversation,
  visibleIds: Set<string>,
  positions: Record<string, { x: number; y: number }>,
  selectedId: string,
  key: ArrowKey,
): string | null {
  const thread = tree.findThread(conv, selectedId);
  if (!thread) return null;
  if (key === "ArrowLeft") return thread.parent?.threadId ?? null;
  const visibleChildren = (id: string) => tree.childThreads(conv, id).filter((t) => visibleIds.has(t.id));
  if (key === "ArrowRight") return thread.branchesView === "shown" ? (visibleChildren(thread.id)[0]?.id ?? null) : null;

  const step = key === "ArrowUp" ? -1 : 1;
  if (thread.parent) {
    const siblings = visibleChildren(thread.parent.threadId);
    const sibling = siblings[siblings.findIndex((t) => t.id === thread.id) + step];
    if (sibling) return sibling.id;
  }
  const here = positions[selectedId];
  if (!here) return null;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const id of visibleIds) {
    const p = positions[id];
    if (!p || id === selectedId || p.x !== here.x) continue;
    const distance = (p.y - here.y) * step;
    if (distance > 0 && distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

// Keys on the canvas only act when the user is not typing and no dialog is open.
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null;
}
