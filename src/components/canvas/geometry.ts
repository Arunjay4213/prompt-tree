// Canvas geometry: where edges run, and the viewport math for reveal, center and fit.
// Pure functions in flow coordinates (the coordinates of the layout, before zoom and pan).

import { CARD_WIDTH, COLUMN_GAP, HEADER_HEIGHT } from "../../tree";

export type Box = { x: number; y: number; width: number; height: number };
export type ViewportValue = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 1.5;
export const FIT_MAX_ZOOM = 1;
// Below this zoom the cards switch to the overview look.
export const OVERVIEW_ZOOM = 0.55;

const EDGE_RADIUS = 8;
// Free space kept around a card that is brought into view, in screen pixels.
const REVEAL_MARGIN = 24;
const FIT_PADDING = 48;

// The port sits centered on the card's right border (1px wide, so its center is half a pixel in).
export function portX(cardX: number): number {
  return cardX + CARD_WIDTH - 0.5;
}

// An edge ends at the middle of the left side of the child card's header.
export function edgeEnd(card: { x: number; y: number }): { x: number; y: number } {
  return { x: card.x, y: card.y + HEADER_HEIGHT / 2 };
}

// Lanes: every port that has a stepped (not straight) edge gets its own vertical line in the
// column gap, so edges from different turns never share one. The topmost port takes the
// rightmost lane, each lower port the next lane to the left; with that order no two edges cross.
// Lanes are 8px apart, at least 12px from both columns, closer together when many are needed.
const LANE_GAP = 8;
const LANE_MARGIN = 12;

// The x of each lane, relative to the parent card's left edge, for ports sorted top to bottom.
export function laneOffsets(count: number): number[] {
  const left = CARD_WIDTH + LANE_MARGIN;
  const right = CARD_WIDTH + COLUMN_GAP - LANE_MARGIN;
  const gap = count > 1 ? Math.min(LANE_GAP, (right - left) / (count - 1)) : 0;
  const center = (left + right) / 2;
  // On a half pixel, so a 1.5px line covers whole pixels at zoom 1.
  return Array.from({ length: count }, (_, i) => Math.floor(center + ((count - 1) / 2 - i) * gap) + 0.5);
}

// The lane of an edge whose port has no stepped edge (a straight edge does not use it).
export const MIDDLE_LANE = laneOffsets(1)[0]!;

// An orthogonal edge with rounded corners: right from the port to its lane `mx`, down (or up) the
// lane, then right into the child header. Every path has the same commands, so a straight edge and
// a stepped one draw the same way.
export function edgePath(sx: number, sy: number, tx: number, ty: number, mx: number): string {
  const dy = ty - sy;
  const dir = dy < 0 ? -1 : 1;
  const r = Math.min(EDGE_RADIUS, Math.abs(dy) / 2, mx - sx, tx - mx);
  return [
    `M ${sx} ${sy}`,
    `L ${mx - r} ${sy}`,
    `Q ${mx} ${sy} ${mx} ${sy + dir * r}`,
    `L ${mx} ${ty - dir * r}`,
    `Q ${mx} ${ty} ${mx + r} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(" ");
}

// Whole pixels keep the hairlines crisp at zoom 1.
function rounded(v: ViewportValue): ViewportValue {
  return { x: Math.round(v.x), y: Math.round(v.y), zoom: v.zoom };
}

// The smallest pan (no zoom change) that brings the box fully into view. When the box is larger
// than the view, its top or left edge is shown. Returns null when no pan is needed.
export function revealViewport(box: Box, view: ViewportValue, width: number, height: number): ViewportValue | null {
  const shift = (start: number, size: number, viewSize: number) => {
    const s = start * view.zoom;
    const e = (start + size) * view.zoom;
    const lo = REVEAL_MARGIN;
    const hi = viewSize - REVEAL_MARGIN;
    if (e - s > hi - lo) return lo - s; // too large: show its start
    if (s < lo) return lo - s;
    if (e > hi) return hi - e;
    return 0;
  };
  const dx = shift(box.x + view.x / view.zoom, box.width, width);
  const dy = shift(box.y + view.y / view.zoom, box.height, height);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  return rounded({ x: view.x + dx, y: view.y + dy, zoom: view.zoom });
}

// Centers the box without changing the zoom. A box taller than the view shows its top.
export function centerViewport(box: Box, zoom: number, width: number, height: number): ViewportValue {
  const x = width / 2 - (box.x + box.width / 2) * zoom;
  const tall = box.height * zoom > height - 2 * REVEAL_MARGIN;
  const y = tall ? REVEAL_MARGIN - box.y * zoom : height / 2 - (box.y + box.height / 2) * zoom;
  return rounded({ x, y, zoom });
}

// Fits all boxes, zoom between MIN_ZOOM and FIT_MAX_ZOOM. On an axis that does not fit even at
// the smallest zoom, the tree starts at the top (or left) edge.
export function fitViewport(boxes: Box[], width: number, height: number): ViewportValue | null {
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  const availW = width - 2 * FIT_PADDING;
  const availH = height - 2 * FIT_PADDING;
  const zoom = Math.min(FIT_MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(availW / (maxX - minX), availH / (maxY - minY))));
  const place = (min: number, max: number, avail: number, viewSize: number) =>
    (max - min) * zoom <= avail ? viewSize / 2 - ((min + max) / 2) * zoom : FIT_PADDING - min * zoom;
  return rounded({ x: place(minX, maxX, availW, width), y: place(minY, maxY, availH, height), zoom });
}

// The expo-out easing used for every canvas motion (the --ease-out-expo token as a function).
export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The zoom the overview look is drawn for, in steps of 0.05, so the cards only redraw a few times
// while the user zooms. 1 above the overview zoom.
export function zoomBucket(zoom: number): number {
  return zoom < OVERVIEW_ZOOM ? Math.max(MIN_ZOOM, Math.floor(zoom * 20) / 20) : 1;
}
