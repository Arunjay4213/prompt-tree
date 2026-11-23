import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Thread } from "../../shared/api";
import { selectOpenConversation, useStore } from "../store";
import * as tree from "../tree";
import { Composer } from "./Composer";
import { EarlierGenerations, GenerationHeader, useGenerations } from "./panel/Generations";
import { SelectionBar, readAnswerSelection, type BarState } from "./panel/SelectionBar";
import { ThreadHeader } from "./panel/ThreadHeader";
import { TurnView } from "./panel/TurnView";
import { ICON, Label } from "./ui";

// The Thread tab: a fixed header, the scrolling body (for a branch the whole conversation it sees,
// one generation per card on its path; for the root its turns), and the composer.
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

// Space above the YOU label when a turn is shown from its start.
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
  const generations = useGenerations(thread.id);
  const ownGeneration = generations.at(-1);
  // The generation whose section is at the top of the body (the picker's label). Kept in a ref
  // too, so scroll events set the state only when it changes.
  const [inView, setInView] = useState(thread.id);
  const inViewRef = useRef(thread.id);

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
  const isAtEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
  // Sections are children of the content box, which starts at the top of the scrolled area, so
  // their offsetTop compares directly with scrollTop.
  const readInView = () => {
    const scroller = scrollRef.current;
    const sections = contentRef.current?.querySelectorAll<HTMLElement>("[data-generation]");
    if (!scroller || !sections || sections.length === 0) return;
    let id = sections[0]!.dataset.generation ?? "";
    for (const section of sections) if (section.offsetTop <= scroller.scrollTop + 1) id = section.dataset.generation ?? id;
    // A last section too short to reach the top would otherwise never be "in view", so the
    // picker could not show the branch it was just asked for: at the end, or with nothing to
    // scroll, the last generation counts as the one in view.
    if (isAtEnd(scroller)) id = sections[sections.length - 1]!.dataset.generation ?? id;
    if (id !== inViewRef.current) {
      inViewRef.current = id;
      setInView(id);
    }
  };
  // Choosing a generation in the picker: its header goes to the top of the body at once. The
  // follow state ends as a manual scroll would leave it: pinned at the end, free anywhere else.
  const chooseGeneration = useCallback((id: string) => {
    const scroller = scrollRef.current;
    const section = contentRef.current?.querySelector<HTMLElement>(`[data-generation="${id}"]`);
    if (!scroller || !section) return;
    scroller.scrollTop = section.offsetTop;
    lastTop.current = scroller.scrollTop;
    changeFollow(isAtEnd(scroller) ? "pinned" : "free");
    readInView();
  }, []);

  // Opens before the first paint, without animating through the history.
  // With turns of its own: a latest own turn that fits is shown whole (scrolled to the end,
  // following it); a taller one is shown from its YOU label, a small gap below the top of the
  // body, and the view stays there. When that taller turn is a branch's first own turn, the view
  // starts at the branch's generation header instead, so it is clear that earlier messages are above.
  // A branch with no turns yet: the message it branched from (the last earlier turn) is shown
  // from its YOU label, so the reader sees what the branch is about; when that is already the
  // end of the body, it follows the end as usual.
  // Then, whenever the content or the body changes size, a pinned body stays at the end.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    const own = content?.querySelectorAll<HTMLElement>('.turn[data-role="own"]');
    const latest = own?.[own.length - 1];
    const label = latest?.querySelector<HTMLElement>("[data-turn-start]");
    const earlier = content?.querySelectorAll<HTMLElement>('.turn[data-role="earlier"]');
    const origin = earlier?.[earlier.length - 1]?.querySelector<HTMLElement>("[data-turn-start]");
    const branchStart = own?.length === 1 ? content?.querySelector<HTMLElement>(`[data-generation="${thread.id}"]`) : null;
    if (scroller && latest && label && latest.offsetHeight > scroller.clientHeight) {
      scroller.scrollTop = thread.parent !== null && branchStart ? branchStart.offsetTop : label.offsetTop - LANDING_GAP;
      lastTop.current = scroller.scrollTop;
      changeFollow("free");
    } else if (scroller && !latest && origin) {
      scroller.scrollTop = origin.offsetTop - LANDING_GAP;
      lastTop.current = scroller.scrollTop;
      changeFollow(isAtEnd(scroller) ? "pinned" : "free");
    } else {
      scrollToEnd();
    }
    readInView();
    const observer = new ResizeObserver(() => {
      if (followRef.current === "pinned") scrollToEnd();
      readInView();
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
      <ThreadHeader threadId={thread.id} generations={generations} inView={inView} onChoose={chooseGeneration} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-testid="thread-body"
          className="scroll-y h-full overflow-x-hidden"
          onScroll={(e) => {
            // At the end: pinned. Moved up: the reader left the end, so free. Anything else (the
            // content grew under a pinned view before it was followed) keeps the current state.
            const el = e.currentTarget;
            const atEnd = isAtEnd(el);
            const movedUp = el.scrollTop < lastTop.current - 1;
            lastTop.current = el.scrollTop;
            if (atEnd && followRef.current === "free") changeFollow("pinned");
            else if (movedUp && !atEnd && followRef.current === "pinned") changeFollow("free");
            readInView();
          }}
        >
          <div ref={contentRef} className="relative px-6">
            {/* The text column: at most 760px and centered, like the header and the composer. */}
            <div className="mx-auto max-w-[760px]">
              <EarlierGenerations threadId={thread.id} generations={generations} />
              <section data-generation={thread.id}>
                {thread.parent !== null && ownGeneration && <GenerationHeader generation={ownGeneration} kind="current" />}
                {thread.turns.length === 0 ? (
                  <EmptyBranch root={thread.parent === null} />
                ) : (
                  thread.turns.map((turn, index) => (
                    <TurnView key={turn.id} role="own" threadId={thread.id} turn={turn} index={index} isLast={index === thread.turns.length - 1} />
                  ))
                )}
              </section>
            </div>
            <SelectionBar state={bar} onDone={() => setBar({ kind: "none" })} />
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
            className="absolute bottom-3 left-1/2 z-10 flex h-[30px] -translate-x-1/2 items-center gap-2 rounded-cell border border-line bg-bg px-3 text-[13px] font-medium text-fg transition-colors hover:border-fg"
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

// For a branch the generation header above already names it, so only the note is shown.
function EmptyBranch({ root }: { root: boolean }) {
  if (!root) {
    return (
      <p className="max-w-[44ch] pt-1 pb-7 text-[13.5px] leading-[1.5] text-pretty text-muted">
        Write the first prompt of this branch below. It sees the conversation above, and nothing from other branches.
      </p>
    );
  }
  return (
    <div className="py-7">
      <Label>Empty thread</Label>
      <p className="mt-2 max-w-[44ch] text-[13.5px] leading-[1.5] text-pretty text-muted">Write the first prompt below.</p>
    </div>
  );
}
