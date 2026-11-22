import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Thread } from "../../shared/api";
import { branchOff, continueHere, selectOpenConversation, setDraft, useStore } from "../store";
import * as tree from "../tree";
import { Button } from "./ui";

// What the composer can do for the selected thread.
// first:   an empty thread; one "Send" button.
// open:    "Continue" and "Branch off".
// busy:    an answer of this thread is in flight; the box is disabled.
// blocked: the last turn failed; it must be retried or removed first.
type ComposerMode = "first" | "open" | "busy" | "blocked";

function composerMode(thread: Thread): ComposerMode {
  if (tree.threadInFlight(thread)) return "busy";
  if (thread.turns.at(-1)?.status === "failed") return "blocked";
  return thread.turns.length === 0 ? "first" : "open";
}

const HINT: Record<ComposerMode, string> = {
  first: "Shift+Enter new line",
  open: "Shift+Enter new line",
  busy: "Waiting for the answer",
  blocked: "Retry or remove the failed turn first",
};

const BLOCKED_REASON: Record<ComposerMode, string | null> = {
  first: null,
  open: null,
  busy: "Waiting for the answer",
  blocked: "Retry or remove the failed turn first",
};

// When the row label has no room to say why the box is disabled, the placeholder says it instead.
function placeholder(mode: ComposerMode, isBranch: boolean, hint: Fit): string {
  if (mode === "busy" && hint === "dropped") return "Waiting for the answer...";
  if (mode === "blocked" && hint === "dropped") return "Retry or remove the failed turn above first.";
  return mode === "first" && isBranch ? "First prompt of this branch..." : "Continue this thread...";
}

// Whether the row label fits on one line next to the buttons.
type Fit = "fits" | "dropped";

// The last focus request (composerFocusTick) a composer has handled. The composer remounts for
// every thread; without this it would take focus again for an old request on each switch, and
// keys meant for the canvas would land in the box.
let handledFocusTick = 0;

// The share of the panel height the textarea may grow to before it scrolls.
const MAX_HEIGHT_SHARE = 0.4;

// What the composer needs from the thread, as plain values, so streamed text does not re-render it.
type ComposerFacts = { mode: ComposerMode; branchReason: string | null; isBranch: boolean };

const NO_THREAD: ComposerFacts = { mode: "busy", branchReason: "Thread not found", isBranch: false };

function composerFacts(thread: Thread | undefined): ComposerFacts {
  if (!thread) return NO_THREAD;
  const mode = composerMode(thread);
  const last = thread.turns.at(-1);
  const branchReason = BLOCKED_REASON[mode] ?? (last && !tree.canBranchFrom(last) ? "The last answer has no text to branch from" : null);
  return { mode, branchReason, isBranch: thread.parent !== null };
}

export const Composer = memo(function Composer({ threadId }: { threadId: string }) {
  const draft = useStore((s) => s.drafts[threadId] ?? "");
  const focusTick = useStore((s) => s.composerFocusTick);
  const { mode, branchReason, isBranch } = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      return composerFacts(conv && tree.findThread(conv, threadId));
    }),
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  const [hintFit, setHintFit] = useState<Fit>("fits");
  const blocked = BLOCKED_REASON[mode];
  const empty = draft.trim() === "";

  // Grows with the text up to 40% of the panel height, then scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const panel = el.closest("aside");
    const max = Math.max(48, Math.round((panel?.clientHeight ?? window.innerHeight) * MAX_HEIGHT_SHARE));
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? "auto" : "hidden";
  }, [draft]);

  // Focus requests from the store (Branch, Enter on the canvas, a new branch), each handled once.
  useEffect(() => {
    if (focusTick <= handledFocusTick) return;
    handledFocusTick = focusTick;
    const el = ref.current;
    if (!el || el.disabled) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusTick]);

  // Sending disables the textarea, which drops its focus. When the answer arrives, focus returns
  // if the prompt was sent from the keyboard or a button while the box had focus.
  const [refocus, setRefocus] = useState<"no" | "yes">("no");
  const disabled = mode === "busy" || mode === "blocked";
  useEffect(() => {
    if (!disabled && refocus === "yes") {
      // Only when focus has not moved somewhere else in the meantime.
      if (document.activeElement === document.body) ref.current?.focus();
      setRefocus("no");
    }
  }, [disabled, refocus]);

  const send = (action: "continue" | "branch") => {
    const prompt = draft.trim();
    if (!prompt || blocked) return;
    if (document.activeElement === ref.current) setRefocus("yes");
    if (mode === "first" || action === "continue") continueHere(threadId, prompt);
    else if (branchReason === null) branchOff(threadId, prompt);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send(e.ctrlKey || e.metaKey ? "branch" : "continue");
  };

  return (
    <div data-testid="composer" className="shrink-0 overflow-hidden border-t border-line px-6 py-4 [scrollbar-gutter:stable]">
      <div className="rounded-cell border border-line transition-colors focus-within:border-fg has-[textarea:disabled]:bg-surface/40">
        <textarea
          ref={ref}
          data-testid="composer-input"
          value={draft}
          onChange={(e) => setDraft(threadId, e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          aria-label="Prompt"
          placeholder={placeholder(mode, isBranch, hintFit)}
          className="block min-h-[46px] w-full resize-none bg-transparent px-3 py-3 text-[15px] leading-[1.5] text-fg outline-none placeholder:text-faint disabled:cursor-not-allowed"
        />
      </div>
      {/* Too narrow for the label, both buttons and their key hints (below 330px): the label is
          dropped first (FitLabel), then the CTRL+ENTER hint. Nothing wraps and no text is cut. */}
      <div className="@container mt-3 flex items-center gap-3">
        <FitLabel text={HINT[mode]} tone={mode === "busy" || mode === "blocked" ? "fg" : "faint"} fit={hintFit} onFit={setHintFit} />
        {mode === "first" ? (
          <Button variant="primary" keyHint="Enter" data-testid="composer-continue" disabledReason={empty ? "Write a prompt first" : null} onClick={() => send("continue")}>
            Send
          </Button>
        ) : (
          <>
            <Button
              keyHint="Ctrl+Enter"
              data-testid="composer-branch"
              className="@max-[329px]:[&_.key-hint]:hidden"
              tip="Send it as a new branch card"
              disabledReason={branchReason ?? (empty ? "Write a prompt first" : null)}
              onClick={() => send("branch")}
            >
              Branch off
            </Button>
            <Button
              variant="primary"
              keyHint="Enter"
              data-testid="composer-continue"
              tip="Add it to this card"
              disabledReason={blocked ?? (empty ? "Write a prompt first" : null)}
              onClick={() => send("continue")}
            >
              Continue
            </Button>
          </>
        )}
      </div>
    </div>
  );
});

// The label at the left of the button row. It takes the room the buttons leave and is dropped
// (kept invisible, so nothing moves) when it does not fit on one line, instead of being cut.
function FitLabel({ text, tone, fit, onFit }: { text: string; tone: "faint" | "fg"; fit: Fit; onFit: (fit: Fit) => void }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      onFit(inner.current.offsetWidth <= outer.current.clientWidth ? "fits" : "dropped");
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    return () => observer.disconnect();
  }, [text, onFit]);

  return (
    <span ref={outer} className="min-w-0 flex-1 overflow-hidden" aria-hidden={fit === "dropped" || undefined}>
      <span
        ref={inner}
        data-testid="composer-hint"
        className={`label-sm inline-block whitespace-nowrap ${tone === "fg" ? "text-fg" : ""} ${fit === "dropped" ? "invisible" : ""}`}
      >
        {text}
      </span>
    </span>
  );
}
