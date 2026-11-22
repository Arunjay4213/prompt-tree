// The minimap: every visible card as a line-colored rectangle, the selected card in fg, and the
// part of the canvas in view as a 1px fg outline. Click or drag in it to move the view there.

import { useReactFlow, useViewportStore } from "@xyflow/react";
import { useRef, type PointerEvent } from "react";
import type { Box } from "./geometry";

// idle: the pointer is not pressed on the minimap. dragging: the view follows that pointer.
type MinimapDrag = { kind: "idle" } | { kind: "dragging"; pointerId: number };

const WIDTH = 158;
const HEIGHT = 108;
const PAD = 8;

export function Minimap({ cards, selectedId }: { cards: (Box & { id: string })[]; selectedId: string | null }) {
  const [vx, vy, zoom] = useViewportStore((s) => s.transform);
  const paneWidth = useViewportStore((s) => s.width);
  const paneHeight = useViewportStore((s) => s.height);
  const flow = useReactFlow();
  const drag = useRef<MinimapDrag>({ kind: "idle" });

  // The part of the flow in view, in flow coordinates.
  const view: Box = { x: -vx / zoom, y: -vy / zoom, width: paneWidth / zoom, height: paneHeight / zoom };
  const all = [...cards, view];
  const minX = Math.min(...all.map((b) => b.x));
  const minY = Math.min(...all.map((b) => b.y));
  const maxX = Math.max(...all.map((b) => b.x + b.width));
  const maxY = Math.max(...all.map((b) => b.y + b.height));
  const scale = Math.min((WIDTH - 2 * PAD) / (maxX - minX), (HEIGHT - 2 * PAD) / (maxY - minY));
  const offsetX = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale;
  const toMap = (b: Box) => ({
    x: b.x * scale + offsetX,
    y: b.y * scale + offsetY,
    width: Math.max(1, b.width * scale),
    height: Math.max(1, b.height * scale),
  });

  const moveTo = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left - offsetX) / scale;
    const fy = (e.clientY - rect.top - offsetY) / scale;
    void flow.setViewport({ x: Math.round(paneWidth / 2 - fx * zoom), y: Math.round(paneHeight / 2 - fy * zoom), zoom });
  };

  const v = toMap(view);
  return (
    <div className="pt-minimap">
    <svg
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label="Minimap. Click or drag to move the view."
      onPointerDown={(e) => {
        drag.current = { kind: "dragging", pointerId: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e);
      }}
      onPointerMove={(e) => {
        if (drag.current.kind === "dragging" && drag.current.pointerId === e.pointerId) moveTo(e);
      }}
      onPointerUp={() => (drag.current = { kind: "idle" })}
      onPointerCancel={() => (drag.current = { kind: "idle" })}
    >
      {cards.map((card) => {
        const r = toMap(card);
        return (
          <rect
            key={card.id}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            rx={1}
            className={card.id === selectedId ? "fill-fg" : "fill-line"}
          />
        );
      })}
      <rect
        x={Math.round(v.x) + 0.5}
        y={Math.round(v.y) + 0.5}
        width={Math.max(1, Math.round(v.width) - 1)}
        height={Math.max(1, Math.round(v.height) - 1)}
        className="pt-minimap-view"
      />
    </svg>
    </div>
  );
}
