import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, selectOpenConversation, setPanelWidth, setTab, useStore, type PanelTab } from "../store";
import * as tree from "../tree";
import { OutputPanel } from "./OutputPanel";
import { ThreadPanel } from "./ThreadPanel";
import { Skeleton } from "./ui";

// hidden: the start screen of a blank conversation is shown, the panel sits off screen.
// shown:  the panel takes its width at the right of the window.
type Presence = "hidden" | "shown";
type Drag = { kind: "idle" } | { kind: "dragging"; startX: number; startWidth: number };

// The right column: the THREAD / OUTPUT tab strip, the tab body, and the resize handle on its left edge.
// The outer box animates its width between 0 and the panel width, so the panel slides in from the right
// while the canvas column narrows with it. The first presence after load is applied without motion.
export function RightPanel() {
  const width = useStore((s) => s.panelWidth);
  // Plain values only, so streamed text does not re-render the panel shell.
  const convId = useStore((s) => selectOpenConversation(s)?.id);
  const blank = useStore((s) => {
    const conv = selectOpenConversation(s);
    return conv ? tree.isBlank(conv) : false;
  });
  const clipCount = useStore((s) => selectOpenConversation(s)?.clips.length ?? 0);
  const tab = useStore((s) => s.tab);
  const loadFailed = useStore((s) => s.openState.kind === "failed");
  const [drag, setDrag] = useState<Drag>({ kind: "idle" });
  const presence: Presence = convId !== undefined && blank ? "hidden" : "shown";

  const settled = useRef(false);
  useEffect(() => {
    if (convId !== undefined) settled.current = true;
  }, [convId]);
  const animate = settled.current && drag.kind === "idle";

  return (
    <div
      style={{ width: presence === "shown" ? width : 0 }}
      className={`relative shrink-0 ${animate ? "transition-[width] duration-300 ease-out-expo" : ""}`}
    >
      <aside
        aria-label="Thread and output"
        inert={presence === "hidden"}
        style={{ width }}
        className="absolute inset-y-0 left-0 flex flex-col border-l border-line bg-bg"
      >
        <ResizeHandle width={width} drag={drag} setDrag={setDrag} />
        <div role="tablist" aria-label="Panel" className="flex h-12 shrink-0 items-stretch gap-6 border-b border-line px-6">
          {convId !== undefined && presence === "shown" && (
            <>
              <Tab tab="thread" active={tab === "thread"} testId="tab-thread">
                Thread
              </Tab>
              <Tab tab="output" active={tab === "output"} testId="tab-output">
                Output
                <ClipCount conversationId={convId} count={clipCount} />
              </Tab>
            </>
          )}
        </div>
        {convId === undefined ? (
          loadFailed ? (
            <MutedLine>Nothing to show until the conversation loads.</MutedLine>
          ) : (
            <PanelSkeleton />
          )
        ) : presence === "hidden" ? null : tab === "thread" ? (
          <ThreadPanel />
        ) : (
          <OutputPanel />
        )}
      </aside>
    </div>
  );
}

function Tab({ tab, active, testId, children }: { tab: PanelTab; active: boolean; testId: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={() => setTab(tab)}
      className={`label relative flex items-center gap-2 transition-colors ${active ? "text-fg" : "hover:text-fg"}`}
    >
      {children}
      <span className={`absolute inset-x-0 -bottom-px h-[1.5px] bg-fg transition-opacity ${active ? "opacity-100" : "opacity-0"}`} aria-hidden />
    </button>
  );
}

// The clip count flashes accent once when a clip is added (not when another conversation opens).
function ClipCount({ conversationId, count }: { conversationId: string; count: number }) {
  const previous = useRef({ conversationId, count });
  const [flashes, setFlashes] = useState(0);
  useEffect(() => {
    const before = previous.current;
    if (before.conversationId === conversationId && count > before.count) setFlashes((n) => n + 1);
    previous.current = { conversationId, count };
  }, [conversationId, count]);
  return (
    <span key={flashes} data-testid="clip-count" className={`num ${flashes > 0 ? "count-flash" : ""}`}>
      {count}
    </span>
  );
}

// A 6px grab zone over the panel's left hairline. The hairline turns fg on hover and while dragging.
function ResizeHandle({ width, drag, setDrag }: { width: number; drag: Drag; setDrag: (drag: Drag) => void }) {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "dragging", startX: e.clientX, startWidth: width });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.kind === "dragging") setPanelWidth(drag.startWidth + (drag.startX - e.clientX));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") setPanelWidth(width + 16);
    if (e.key === "ArrowRight") setPanelWidth(width - 16);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the panel"
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={drag.kind === "dragging"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDrag({ kind: "idle" })}
      onPointerCancel={() => setDrag({ kind: "idle" })}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -left-[4px] z-20 w-[6px] cursor-col-resize touch-none outline-none"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-[3px] w-px bg-transparent transition-colors group-hover:bg-fg group-focus-visible:bg-accent group-data-[dragging=true]:bg-fg"
      />
    </div>
  );
}

function MutedLine({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-center text-[13.5px] text-faint">{children}</div>;
}

function PanelSkeleton() {
  return (
    <div className="space-y-3 px-6 py-6" aria-busy="true">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-5 w-64" />
      <div className="pt-4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  );
}
