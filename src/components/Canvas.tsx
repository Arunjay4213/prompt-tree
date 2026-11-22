// The canvas: the tree of cards, their edges and ports, and the view (pan and zoom).
// React Flow provides pan, zoom and the viewport. The cards, ports and edges are drawn here in
// one layer inside the viewport, from one layout, so an edge always starts on its port and ends
// on its card in the same frame, and moves with them when they move.

import { Panel, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, useReactFlowStoreApi, useViewportStore } from "@xyflow/react";
import { Maximize, Minus, Plus } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "../../shared/api";
import { focusComposer, goToThread, requestFit, selectThread, toggleCardView, useStore } from "../store";
import * as tree from "../tree";
import { Edges, type EdgeLine } from "./canvas/Edges";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  OVERVIEW_ZOOM,
  centerViewport,
  easeOutExpo,
  MIDDLE_LANE,
  edgeEnd,
  edgePath,
  laneOffsets,
  fitViewport,
  fitsAboveObstacles,
  portX,
  prefersReducedMotion,
  revealViewport,
  type Box,
  type ViewportValue,
} from "./canvas/geometry";
import { cardInDirection, isArrowKey, isTypingTarget } from "./canvas/keyboard";
import { Minimap } from "./canvas/Minimap";
import { ThreadCard, type PathState } from "./ThreadCard";
import { IconButton } from "./ui";

// The card width for CSS (canvas.css and the loading skeleton), from the one constant in tree.ts.
document.documentElement.style.setProperty("--card-width", `${tree.CARD_WIDTH}px`);

// The height used for a card that is not measured yet. It is never painted at that size: cards
// measure themselves before the first paint.
const FALLBACK_HEIGHT = 120;
const VIEW_MS = 400;
const NO_NODES: never[] = [];

// "measuring": rendered invisibly so it can be measured. "shown": placed and visible.
type CardPhase = "measuring" | "shown";

type Position = { x: number; y: number };
// A card gliding from one position to another, started at `start` (performance.now()).
type Motion = { from: Position; to: Position; start: number; duration: number };
// off:       the view stays where it is.
// following: a card was revealed; when it grows (its answer streams in), the view pans to keep its
//            bottom edge in view. `height` is the card height the view was last adjusted for.
type Follow = { kind: "off" } | { kind: "following"; threadId: string; height: number };
// What an edge needs to be redrawn while its cards glide.
// laneX: the x of its vertical part, relative to the parent card.
type Link = { id: string; parentId: string; portY: number; laneX: number };

const MOVE_MS = 350;
// A new card rises this far (and fades in) when it appears.
const ENTER_RISE = 8;
const ENTER_MS = 300;

// Everything that decides which cards exist and where they go, as one string. The canvas only
// redraws when this changes (or the selection, or a card's measured size), not on every token.
function structureKey(conv: Conversation): string {
  return conv.threads
    .map((t) => `${t.id}<${t.parent?.turnId ?? ""}|${t.cardView}|${t.branchesView}|${t.turns.map((x) => x.id).join(",")}`)
    .join(";");
}

function sameSize(a: tree.CardSize | undefined, b: tree.CardSize): boolean {
  if (!a || a.height !== b.height) return false;
  const keys = Object.keys(b.ports);
  return keys.length === Object.keys(a.ports).length && keys.every((k) => a.ports[k] === b.ports[k]);
}

export const Canvas = memo(function Canvas() {
  const openId = useStore((s) => s.openId);
  if (openId === null) return null;
  return (
    <div className="absolute inset-0">
      <ReactFlowProvider>
        <Flow convId={openId} />
      </ReactFlowProvider>
    </div>
  );
});

function Flow({ convId }: { convId: string }) {
  const key = useStore((s) => {
    const c = s.conversations[convId];
    return c ? structureKey(c) : "";
  });
  // The conversation as of the last structural change. Text and status changes do not matter here.
  const conv = useMemo(() => useStore.getState().conversations[convId], [convId, key]);
  const selectedId = useStore((s) => s.selectedThreadId);
  const viewRequest = useStore((s) => s.viewRequest);
  const overview = useViewportStore((s) => s.transform[2] < OVERVIEW_ZOOM);
  const flow = useReactFlow();
  const storeApi = useReactFlowStoreApi();
  const gridRef = useRef<HTMLDivElement>(null);

  // Measured card sizes, reported by the cards before they paint.
  const [sizes, setSizes] = useState<Record<string, tree.CardSize>>({});
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const onMeasure = useCallback((id: string, size: tree.CardSize | null) => {
    if (size === null) {
      if (!sizesRef.current[id]) return;
      setSizes((prev) => {
        const { [id]: _gone, ...rest } = prev;
        return rest;
      });
      return;
    }
    if (sameSize(sizesRef.current[id], size)) return;
    setSizes((prev) => ({ ...prev, [id]: size }));
  }, []);

  const visible = useMemo(() => (conv ? tree.visibleThreads(conv) : []), [conv]);
  const layout = useMemo(() => (conv ? tree.layoutTree(conv, sizes, FALLBACK_HEIGHT) : {}), [conv, sizes]);
  const numbers = useMemo(() => (conv ? tree.pathNumbers(conv) : {}), [conv]);
  const pathIds = useMemo(
    () => new Set(conv && selectedId ? tree.ancestorPath(conv, selectedId).map((t) => t.id) : []),
    [conv, selectedId],
  );
  const ready = visible.every((t) => sizes[t.id] !== undefined);

  // Cards shown in the last painted frame, and where they were. While a new card is still being
  // measured (never painted, but kept safe), the shown cards stay where they are.
  const shownBefore = useRef(new Set<string>());
  const lastPositions = useRef<Record<string, Position>>({});
  const bornAt = useRef(new Map<string, number>());

  const phaseOf = (id: string): CardPhase => (sizes[id] && (ready || shownBefore.current.has(id)) ? "shown" : "measuring");
  const positionOf = (id: string): Position =>
    (!ready && shownBefore.current.has(id) ? lastPositions.current[id] : undefined) ?? layout[id] ?? { x: 0, y: 0 };

  // The edges that are drawn: both cards shown. Then the lanes: for each parent card, its ports
  // that have a stepped edge (child header not level with the port), top to bottom.
  const links: Link[] = [];
  for (const thread of visible) {
    if (!thread.parent) continue;
    const parentId = thread.parent.threadId;
    if (phaseOf(thread.id) !== "shown" || phaseOf(parentId) !== "shown") continue;
    const portY = sizes[parentId]?.ports[thread.parent.turnId] ?? tree.HEADER_HEIGHT / 2;
    links.push({ id: thread.id, parentId, portY, laneX: MIDDLE_LANE });
  }
  const steppedPorts = new Map<string, Set<number>>();
  for (const link of links) {
    const from = positionOf(link.parentId);
    const to = edgeEnd(positionOf(link.id));
    if (from.y + link.portY === to.y) continue;
    const set = steppedPorts.get(link.parentId) ?? new Set<number>();
    set.add(link.portY);
    steppedPorts.set(link.parentId, set);
  }
  const laneOf = new Map<string, Map<number, number>>();
  for (const [parentId, portYs] of steppedPorts) {
    const sorted = [...portYs].sort((a, b) => a - b);
    const offsets = laneOffsets(sorted.length);
    laneOf.set(parentId, new Map(sorted.map((y, i) => [y, offsets[i]!])));
  }
  for (const link of links) link.laneX = laneOf.get(link.parentId)?.get(link.portY) ?? MIDDLE_LANE;

  // Edges, and the ports they leave from (keyed by the parent card, then by the port's y).
  const edges: EdgeLine[] = [];
  const ports = new Map<string, Map<number, boolean>>();
  for (const link of links) {
    const from = positionOf(link.parentId);
    const to = edgeEnd(positionOf(link.id));
    const onPath = pathIds.has(link.id);
    if (!bornAt.current.has(link.id)) bornAt.current.set(link.id, performance.now());
    edges.push({
      id: link.id,
      d: edgePath(portX(from.x), from.y + link.portY, to.x, to.y, from.x + link.laneX),
      onPath,
      bornAt: bornAt.current.get(link.id)!,
    });
    const cardPorts = ports.get(link.parentId) ?? new Map<number, boolean>();
    cardPorts.set(link.portY, (cardPorts.get(link.portY) ?? false) || onPath);
    ports.set(link.parentId, cardPorts);
  }

  // The boxes of the visible cards, for fit, reveal and the minimap.
  const boxes = useMemo(
    () =>
      visible.map((t) => ({
        id: t.id,
        x: layout[t.id]?.x ?? 0,
        y: layout[t.id]?.y ?? 0,
        width: tree.CARD_WIDTH,
        height: sizes[t.id]?.height ?? FALLBACK_HEIGHT,
      })),
    [visible, layout, sizes],
  );

  useLayoutEffect(() => {
    if (!ready) return;
    shownBefore.current = new Set(visible.map((t) => t.id));
    lastPositions.current = layout;
    for (const id of bornAt.current.keys()) if (!layout[id]) bornAt.current.delete(id);
  });

  // ---------- motion ----------
  // Cards glide to new positions (350ms expo). The glide runs here, frame by frame, and not as a
  // CSS transition: an edge is drawn each frame from where its two cards are in that frame, while
  // a port moves at once with the card's content. So an edge never starts or ends off its card.
  // React renders the target positions; right after each commit (before paint) and on every
  // frame of a glide, the DOM is set to the in-between positions.
  const motions = useRef(new Map<string, Motion>());
  const slotEls = useRef(new Map<string, HTMLDivElement>());
  const sceneRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<Link[]>([]);
  linksRef.current = links;
  const frame = useRef(0);

  const drawFrame = useCallback((now: number): boolean => {
    let moving = false;
    const at = (id: string): Position | undefined => {
      const m = motions.current.get(id);
      if (!m) return undefined;
      const t = Math.min(1, (now - m.start) / m.duration);
      if (t < 1) moving = true;
      const e = easeOutExpo(t);
      return { x: m.from.x + (m.to.x - m.from.x) * e, y: m.from.y + (m.to.y - m.from.y) * e };
    };
    for (const [id, el] of slotEls.current) {
      const p = at(id);
      if (p) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    const paths = new Map<string, SVGPathElement>();
    for (const el of sceneRef.current?.querySelectorAll<SVGPathElement>(".pt-edge") ?? []) paths.set(el.dataset.edge!, el);
    for (const link of linksRef.current) {
      const from = at(link.parentId);
      const to = at(link.id);
      const el = paths.get(link.id);
      if (!from || !to || !el) continue;
      el.setAttribute("d", edgePath(portX(from.x), from.y + link.portY, to.x, to.y + tree.HEADER_HEIGHT / 2, from.x + link.laneX));
    }
    return moving;
  }, []);

  useLayoutEffect(() => {
    const now = performance.now();
    const instant = prefersReducedMotion();
    const shown = new Set<string>();
    for (const thread of visible) {
      if (phaseOf(thread.id) !== "shown") continue;
      shown.add(thread.id);
      const target = positionOf(thread.id);
      const m = motions.current.get(thread.id);
      if (!m) {
        // A card that just appeared rises into place (its opacity fades in with CSS).
        const from = instant ? target : { x: target.x, y: target.y + ENTER_RISE };
        motions.current.set(thread.id, { from, to: target, start: now, duration: ENTER_MS });
      } else if (m.to.x !== target.x || m.to.y !== target.y) {
        const t = Math.min(1, (now - m.start) / m.duration);
        const e = easeOutExpo(t);
        const current = { x: m.from.x + (m.to.x - m.from.x) * e, y: m.from.y + (m.to.y - m.from.y) * e };
        motions.current.set(thread.id, { from: instant ? target : current, to: target, start: now, duration: MOVE_MS });
      }
    }
    for (const id of motions.current.keys()) if (!shown.has(id)) motions.current.delete(id);
    if (!drawFrame(now) || frame.current !== 0) return;
    const loop = (time: number) => {
      frame.current = drawFrame(time) ? requestAnimationFrame(loop) : 0;
    };
    frame.current = requestAnimationFrame(loop);
  });
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // ---------- the view ----------

  const paneSize = () => {
    const { width, height } = storeApi.viewportStore.getState();
    return { width, height };
  };
  const moveView = (next: ViewportValue | null, duration: number) => {
    if (!next) return;
    void flow.setViewport(next, { duration: prefersReducedMotion() ? 0 : duration, ease: easeOutExpo, interpolate: "linear" });
  };
  const boxOf = (id: string): Box | undefined => boxes.find((b) => b.id === id);
  // The minimap and the zoom controls cover the canvas: a revealed card must stay clear of them.
  const obstacles = (): Box[] => {
    const pane = gridRef.current?.getBoundingClientRect();
    if (!pane) return [];
    return [...(gridRef.current?.querySelectorAll(".pt-minimap, .pt-controls") ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - pane.left, y: r.top - pane.top, width: r.width, height: r.height };
    });
  };
  // After a card is revealed, the view follows it while it grows (an answer streaming in), until
  // the user pans or zooms, the card no longer fits, or another card is revealed.
  const follow = useRef<Follow>({ kind: "off" });

  // On open, the root card is at the top left at zoom 1 (the default viewport). A remembered
  // selection deeper in the tree is brought into view instead, without motion.
  const opened = useRef(false);
  const handledTick = useRef(useStore.getState().viewRequest?.tick ?? 0);
  useLayoutEffect(() => {
    if (!ready || !conv) return;
    const { width, height } = paneSize();
    if (width === 0 || height === 0) return;
    if (!opened.current) {
      opened.current = true;
      const box = selectedId && selectedId !== tree.rootThread(conv).id ? boxOf(selectedId) : undefined;
      if (box) moveView(revealViewport(box, flow.getViewport(), width, height, obstacles()), 0);
    }
    if (viewRequest && viewRequest.tick > handledTick.current) {
      handledTick.current = viewRequest.tick;
      if (viewRequest.kind === "fit") {
        follow.current = { kind: "off" };
        moveView(fitViewport(boxes, width, height), VIEW_MS);
        return;
      }
      const box = boxOf(viewRequest.threadId);
      if (!box) return;
      const view = flow.getViewport();
      follow.current = { kind: "following", threadId: viewRequest.threadId, height: box.height };
      moveView(
        viewRequest.kind === "reveal"
          ? revealViewport(box, view, width, height, obstacles())
          : centerViewport(box, view.zoom, width, height),
        VIEW_MS,
      );
      return;
    }
    // Following: the followed card grew. Keep its bottom edge in view; once it no longer fits,
    // keep its top in view and stop following.
    const f = follow.current;
    if (f.kind !== "following") return;
    const box = boxOf(f.threadId);
    if (!box || f.threadId !== selectedId) {
      follow.current = { kind: "off" };
      return;
    }
    if (box.height === f.height) return;
    follow.current = { ...f, height: box.height };
    const view = flow.getViewport();
    if (!fitsAboveObstacles(box, view.zoom, height, obstacles())) follow.current = { kind: "off" };
    // At once, like a chat view that sticks to its bottom: the card has already grown.
    moveView(revealViewport(box, view, width, height, obstacles()), 0);
  });

  // ---------- the grid (and the edge width) follow pan and zoom without re-rendering ----------

  useLayoutEffect(() => {
    const apply = ({ transform: [x, y, zoom] }: { transform: [number, number, number] }) => {
      const el = gridRef.current;
      if (!el) return;
      el.style.backgroundSize = `${24 * zoom}px ${24 * zoom}px`;
      el.style.backgroundPosition = `${x}px ${y}px`;
      // Edges and card lines stay at least 1px wide on screen when zoomed out (.pt-edge, .pt-card).
      el.querySelector<HTMLElement>(".pt-scene")?.style.setProperty("--zoom", String(zoom));
    };
    apply(storeApi.viewportStore.getState());
    return storeApi.viewportStore.subscribe(apply);
  }, [storeApi]);

  // ---------- keyboard ----------

  const latest = useRef({ conv, visible, layout, selectedId });
  latest.current = { conv, visible, layout, selectedId };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The canvas keys act only with no modifier held (Shift extends a text selection), with no
      // dialog open, and only for key presses on the page itself or inside the canvas column. A key
      // pressed in the panel, the sidebar, the top bar or any control that uses arrows (the panel's
      // resize handle, a clip's drag handle, a text field) belongs to that control.
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (document.querySelector("[role='dialog']")) return;
      // Escape in a text field that did not use it (the composer) leaves the field for the canvas,
      // so the canvas keys work again. The card selection stays.
      if (e.key === "Escape" && isTypingTarget(e.target)) {
        (e.target as HTMLElement).blur();
        gridRef.current?.focus({ preventScroll: true });
        return;
      }
      const onCanvas = e.target === document.body || (e.target instanceof Node && gridRef.current?.contains(e.target) === true);
      if (!onCanvas || isTypingTarget(e.target)) return;
      const { conv, visible, layout, selectedId } = latest.current;
      if (!conv) return;
      if (e.key === "Escape") {
        if (selectedId) selectThread(null);
        return;
      }
      if (isArrowKey(e.key)) {
        e.preventDefault();
        const next = selectedId
          ? cardInDirection(conv, new Set(visible.map((t) => t.id)), layout, selectedId, e.key)
          : tree.rootThread(conv).id;
        if (next) goToThread(next);
        return;
      }
      if (!selectedId) return;
      if (e.key === "Enter") {
        if (e.target instanceof HTMLElement && e.target.closest("button, a, [role='button']")) return;
        e.preventDefault();
        focusComposer();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleCardView(selectedId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!conv) return null;

  return (
    <div
      ref={gridRef}
      // Focus lands here when a dialog closes and its opener is gone (a deleted card's button).
      tabIndex={-1}
      data-focus-target="canvas"
      className="grid-surface absolute inset-0 outline-none"
      // React Flow cancels the default of a press on the canvas, so the browser would leave the
      // focus in the composer and the arrow keys would type there. Pressing the canvas leaves it.
      onPointerDownCapture={() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && isTypingTarget(active)) active.blur();
      }}
    >
      <ReactFlow
        nodes={NO_NODES}
        edges={NO_NODES}
        defaultViewport={{ x: 48, y: 48, zoom: 1 }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        panOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        panActivationKeyCode={null}
        disableKeyboardA11y
        onPaneClick={() => selectThread(null)}
        // A pan or zoom by the user (it has an input event; the app's own moves have none) ends
        // the following of a growing card.
        onMoveStart={(event) => {
          if (event) follow.current = { kind: "off" };
        }}
        attributionPosition="top-right"
        className="pt-flow"
      >
        <ViewportPortal>
          <div ref={sceneRef} className="pt-scene" data-overview={overview}>
            <Edges edges={edges} />
            {/* Cards in creation order, so existing cards never move in the DOM. */}
            {conv.threads.map((thread) => {
              const position = layout[thread.id];
              if (!position) return null;
              const phase = phaseOf(thread.id);
              const at = positionOf(thread.id);
              const pathState: PathState = thread.id === selectedId ? "selected" : pathIds.has(thread.id) ? "path" : "normal";
              return (
                <div
                  key={thread.id}
                  ref={(el) => {
                    if (el) slotEls.current.set(thread.id, el);
                    else slotEls.current.delete(thread.id);
                  }}
                  data-phase={phase}
                  className={`pt-slot ${phase === "shown" ? "pt-slot-in" : ""}`}
                  style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
                >
                  <ThreadCard
                    threadId={thread.id}
                    pathState={pathState}
                    pathNumber={numbers[thread.id] ?? ""}
                    hiddenCount={thread.branchesView === "hidden" ? tree.hiddenBranchCount(conv, thread.id) : 0}
                    height={sizes[thread.id]?.height ?? null}
                    onMeasure={onMeasure}
                  />
                  {[...(ports.get(thread.id) ?? [])].map(([y, onPath]) => (
                    <span key={y} className="pt-port" data-on-path={onPath} style={{ top: y - 3.5 }} aria-hidden />
                  ))}
                </div>
              );
            })}
          </div>
        </ViewportPortal>
        <Panel position="bottom-left">
          <Controls />
        </Panel>
        <Panel position="bottom-right">
          <Minimap cards={boxes} selectedId={selectedId} />
        </Panel>
      </ReactFlow>
    </div>
  );
}

// Zoom in, zoom out and fit, as one bordered group of icon buttons. Memoized: it only changes with the zoom.
const Controls = memo(function Controls() {
  const zoom = useViewportStore((s) => s.transform[2]);
  const flow = useReactFlow();
  const duration = () => (prefersReducedMotion() ? 0 : 200);
  return (
    <div className="pt-controls">
      <IconButton
        icon={Plus}
        label="Zoom in"
        data-testid="canvas-zoom-in"
        disabledReason={zoom >= MAX_ZOOM - 0.001 ? "Already at the largest zoom" : null}
        onClick={() => void flow.zoomIn({ duration: duration() })}
      />
      <IconButton
        icon={Minus}
        label="Zoom out"
        data-testid="canvas-zoom-out"
        disabledReason={zoom <= MIN_ZOOM + 0.001 ? "Already at the smallest zoom" : null}
        onClick={() => void flow.zoomOut({ duration: duration() })}
      />
      <IconButton icon={Maximize} label="Fit view" data-testid="canvas-fit" onClick={requestFit} />
    </div>
  );
});
