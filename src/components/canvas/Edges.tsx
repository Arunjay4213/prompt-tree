// The edges of the tree, drawn in one SVG under the cards, in flow coordinates.
// Edges on the selected path are drawn in a second group above the others, so where several
// branches share a line out of one port, the black path line is on top.

import { memo, useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./geometry";

export type EdgeLine = {
  id: string; // the child thread id
  d: string;
  onPath: boolean;
  bornAt: number; // performance.now() when the edge was first drawn
};

const DRAW_MS = 400;

export function Edges({ edges }: { edges: EdgeLine[] }) {
  return (
    <svg className="pt-edges" width="1" height="1" aria-hidden>
      <g>
        {edges
          .filter((e) => !e.onPath)
          .map((e) => (
            <EdgePath key={e.id} {...e} />
          ))}
      </g>
      <g>
        {edges
          .filter((e) => e.onPath)
          .map((e) => (
            <EdgePath key={e.id} {...e} />
          ))}
      </g>
    </svg>
  );
}

// A new edge draws in from the port to the card. An edge that moves to the other group (the
// selection changed) mounts again; it continues the draw-in where it was, or is simply drawn.
const EdgePath = memo(function EdgePath({ id, d, onPath, bornAt }: EdgeLine) {
  const ref = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const age = performance.now() - bornAt;
    if (!el || age >= DRAW_MS || prefersReducedMotion()) return;
    const animation = el.animate(
      [
        { strokeDasharray: "1 1", strokeDashoffset: 1 },
        { strokeDasharray: "1 1", strokeDashoffset: 0 },
      ],
      { duration: DRAW_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    animation.currentTime = Math.max(0, age);
    return () => animation.cancel();
  }, [bornAt]);
  return (
    <path
      ref={ref}
      className="pt-edge"
      data-testid={`edge-${id}`}
      data-edge={id}
      data-on-path={onPath}
      d={d}
      pathLength={1}
    />
  );
});
