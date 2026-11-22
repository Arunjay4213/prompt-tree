import { ArrowDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Thread } from "../../shared/api";
import { selectOpenConversation, useStore } from "../store";
import * as tree from "../tree";
import { Composer } from "./Composer";
import { InheritedContext } from "./panel/InheritedContext";
import { SelectionBar, readAnswerSelection, type BarState } from "./panel/SelectionBar";
import { ThreadHeader } from "./panel/ThreadHeader";
import { TurnView } from "./panel/TurnView";
import { ICON, Label } from "./ui";

// The Thread tab: a fixed header, the scrolling body (inherited context, then the turns), and the composer.
export function ThreadPanel() {
  // Only the selected thread: text streaming into other threads never re-renders this panel.
  const thread = useStore((s) => {
    const conv = selectOpenConversation(s);
    return conv && s.selectedThreadId ? tree.findThread(conv, s.selectedThreadId) : undefined;
  });

  if (!thread) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Label>No card selected</Label>
        <p className="text-[13.5px] leading-[1.5] text-muted">Select a card on the canvas to read it here.</p>
      </div>
    );
  }
  // Keyed by thread: switching threads starts a fresh view that opens at the latest turn.
  return <ThreadView key={thread.id} thread={thread} />;
}

// Space above the YOU label when a tall latest turn is shown from its start.
const LANDING_GAP = 16;

// pinned: the body follows the end of the thread as answers grow.
// free:   the reader scrolled up; the view stays where it is.
type Follow = "pinned" | "free";

function ThreadView({ thread }: { thread: Thread }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState<Follow>("pinned");
  const followRef = useRef<Follow>("pinned");
  const lastTop = useRef(0); // scrollTop at the previous scroll event
  const [bar, setBar] = useState<BarState>({ kind: "none" });
  const live = tree.threadInFlight(thread);

  const changeFollow = (next: Follow) => {
    followRef.current = next;
    setFollow(next);
  };
  const scrollToEnd = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  };

  // Opens at the latest turn, before the first paint, without animating through the history:
  // a latest turn that fits is shown whole (scrolled to the end, following it); a taller one is
  // shown from its YOU label, a small gap below the top of the body, and the view stays there.
  // Then, whenever the content or the body changes size, a pinned body stays at the end.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const turns = contentRef.current?.querySelectorAll<HTMLElement>(".turn");
    const latest = turns?.[turns.length - 1];
    const label = latest?.querySelector<HTMLElement>("[data-turn-start]");
    if (scroller && latest && label && latest.offsetHeight > scroller.clientHeight) {
      scroller.scrollTop = label.offsetTop - LANDING_GAP;
      lastTop.current = scroller.scrollTop;
      changeFollow("free");
    } else {
      scrollToEnd();
    }
    const observer = new ResizeObserver(() => {
      if (followRef.current === "pinned") scrollToEnd();
      // Content above a shown selection bar may have moved; place the bar again.
      const content = contentRef.current;
      const scroller = scrollRef.current;
      if (content && scroller) setBar((bar) => (bar.kind === "none" ? bar : readAnswerSelection(content, scroller)));
    });
    if (scrollRef.current) observer.observe(scrollRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  // A new turn in this thread (the user sent a prompt): follow it.
  const turnCount = thread.turns.length;
  const previousCount = useRef(turnCount);
  useLayoutEffect(() => {
    if (turnCount > previousCount.current) {
      changeFollow("pinned");
      scrollToEnd();
    }
    previousCount.current = turnCount;
  }, [turnCount]);

  // The selection bar: shown when a selection inside one answer is finished (mouse or keyboard),
  // hidden as soon as the selection collapses or leaves that answer.
  useEffect(() => {
    const show = () => {
      const content = contentRef.current;
      const scroller = scrollRef.current;
      if (!content || !scroller) return;
      setBar(readAnswerSelection(content, scroller));
    };
    const onChange = () => {
      const content = contentRef.current;
      const scroller = scrollRef.current;
      if (!content || !scroller) return;
      if (readAnswerSelection(content, scroller).kind === "none") setBar({ kind: "none" });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === "Shift") show();
    };
    document.addEventListener("mouseup", show);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("mouseup", show);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader threadId={thread.id} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-testid="thread-body"
          className="scroll-y h-full overflow-x-hidden"
          onScroll={(e) => {
            // At the end: pinned. Moved up: the reader left the end, so free. Anything else (the
            // content grew under a pinned view before it was followed) keeps the current state.
            const el = e.currentTarget;
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
            const movedUp = el.scrollTop < lastTop.current - 1;
            lastTop.current = el.scrollTop;
            if (atEnd && followRef.current === "free") changeFollow("pinned");
            else if (movedUp && !atEnd && followRef.current === "pinned") changeFollow("free");
          }}
        >
          <div ref={contentRef} className="relative px-6">
            <InheritedContext threadId={thread.id} />
            {thread.turns.length === 0 ? (
              <EmptyBranch root={thread.parent === null} />
            ) : (
              thread.turns.map((turn, index) => (
                <TurnView key={turn.id} threadId={thread.id} turn={turn} index={index} isLast={index === thread.turns.length - 1} />
              ))
            )}
            <SelectionBar state={bar} threadId={thread.id} onDone={() => setBar({ kind: "none" })} />
          </div>
        </div>
        {follow === "free" && live && (
          <button
            type="button"
            data-testid="jump-latest"
            onClick={() => {
              changeFollow("pinned");
              scrollToEnd();
            }}
            className="label-sm absolute bottom-3 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-2 rounded-cell border border-line bg-bg px-3 text-fg transition-colors hover:border-fg"
          >
            <ArrowDown {...ICON} />
            Jump to latest
          </button>
        )}
      </div>
      <Composer threadId={thread.id} />
    </div>
  );
}

function EmptyBranch({ root }: { root: boolean }) {
  return (
    <div className="py-7">
      <Label>{root ? "Empty thread" : "New branch"}</Label>
      <p className="mt-2 max-w-[44ch] text-[13.5px] leading-[1.5] text-pretty text-muted">
        {root
          ? "Write the first prompt below."
          : "Write the first prompt of this branch below. It sees the inherited context above, and nothing from other branches."}
      </p>
    </div>
  );
}
