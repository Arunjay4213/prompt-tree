import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Thread } from "../../shared/api";
import { askEach, branchFromLastTurn, branchOff, continueHere, selectModels, selectOpenConversation, setDraft, useStore } from "../store";
import { answerOptions, refersToEach } from "../text";
import * as tree from "../tree";
import { ModelPicker } from "./ModelPicker";
import { Button, LiveDot } from "./ui";

// What the composer can do for the selected thread.
// first:     an empty thread; one "Send" button.
// open:      "Send", "New branch", and "Ask each" when the last answer has options.
// busy:      an answer of this thread is in flight; the box is disabled.
// blocked:   the last turn failed; it must be retried or removed first.
// splitting: "Ask each" is rewriting the question for each option; the box is disabled.
type ComposerMode = "first" | "open" | "busy" | "blocked" | "splitting";

const BLOCKED_REASON: Record<ComposerMode, string | null> = {
  first: null,
  open: null,
  busy: "Waiting for the answer",
  blocked: "Retry or remove the failed message first",
  splitting: "Splitting the question across the options",
};

const NO_OPTIONS: string[] = [];

// The share of the panel height the textarea may grow to before it scrolls.
const MAX_HEIGHT_SHARE = 0.4;
// The narrowest the model picker gets before the buttons give up their key hints.
const PICKER_MIN = 56;

// The last focus request (composerFocusTick) a composer has handled. The composer remounts for
// every thread; without this it would take focus again for an old request on each switch, and
// keys meant for the canvas would land in the box.
let handledFocusTick = 0;

// What the composer needs from the thread, as plain values, so streamed text does not re-render it.
type ComposerFacts = { mode: ComposerMode; branchReason: string | null; isBranch: boolean; options: string[] };

const NO_THREAD: ComposerFacts = { mode: "busy", branchReason: "Thread not found", isBranch: false, options: NO_OPTIONS };

function composerFacts(thread: Thread | undefined, splitting: boolean): ComposerFacts {
  if (!thread) return NO_THREAD;
  const last = thread.turns.at(-1);
  const mode: ComposerMode = splitting
    ? "splitting"
    : tree.threadInFlight(thread)
      ? "busy"
      : last?.status === "failed"
        ? "blocked"
        : thread.turns.length === 0
          ? "first"
          : "open";
  const branchable = last !== undefined && tree.canBranchFrom(last);
  const branchReason = BLOCKED_REASON[mode] ?? (branchable ? null : "The last answer has no text to branch from");
  // Options only from a finished answer: the options of a streaming answer are not parsed.
  const options = mode === "open" && branchable && last ? answerOptions(last.answer) : NO_OPTIONS;
  return { mode, branchReason, isBranch: thread.parent !== null, options };
}

function placeholder(mode: ComposerMode, isBranch: boolean): string {
  if (mode === "busy") return "Waiting for the answer...";
  if (mode === "blocked") return "Retry or remove the failed message above first.";
  if (mode === "splitting") return "Splitting your question across the options...";
  return mode === "first" && isBranch ? "First message of this branch..." : "Write a message...";
}

// How much the button row gives up to stay on one line: 0 everything, 1 no key hint on Ask each,
// 2 none on New branch either, 3 no key hints at all, 4 also the small button size.
type Squeeze = 0 | 1 | 2 | 3 | 4;

export const Composer = memo(function Composer({ threadId }: { threadId: string }) {
  const draft = useStore((s) => s.drafts[threadId] ?? "");
  const focusTick = useStore((s) => s.composerFocusTick);
  // While "Ask each" runs, its options come from the split (the composer is not "open" then).
  const splitOptions = useStore((s) => s.splits[threadId]?.options ?? NO_OPTIONS);
  const splitting = splitOptions.length > 0;
  const { mode, branchReason, isBranch, options: openOptions } = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      return composerFacts(conv && tree.findThread(conv, threadId), splitting);
    }),
  );
  const options = splitting ? splitOptions : openOptions;
  const ref = useRef<HTMLTextAreaElement>(null);
  const pickerShown = useStore((s) => selectModels(s).length > 1);
  const blocked = BLOCKED_REASON[mode];
  const empty = draft.trim() === "";
  const canAskEach = mode === "open" || mode === "splitting" ? options.length >= 2 : false;
  // A question that refers to every option makes "Ask each" the primary action, as a hint.
  const eachFirst = canAskEach && refersToEach(draft);
  const disabled = mode === "busy" || mode === "blocked" || mode === "splitting";

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
  useEffect(() => {
    if (!disabled && refocus === "yes") {
      // Only when focus has not moved somewhere else in the meantime.
      if (document.activeElement === document.body) ref.current?.focus();
      setRefocus("no");
    }
  }, [disabled, refocus]);

  // The button row stays on one line: it gives up key hints, then size, one step at a time.
  const rowRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => setRowWidth(row.clientWidth));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  // The level belongs to one layout (row width and buttons); a new layout starts again from 0.
  const layoutKey = `${rowWidth}|${mode}|${canAskEach}|${eachFirst}|${pickerShown}|${options.length}|${splitting}`;
  const [fitted, setFitted] = useState<{ key: string; squeeze: Squeeze }>({ key: "", squeeze: 0 });
  const squeeze: Squeeze = fitted.key === layoutKey ? fitted.squeeze : 0;
  useLayoutEffect(() => {
    const row = rowRef.current;
    const right = rightRef.current;
    if (!row || !right) return;
    // The picker keeps its full name (up to 40% of the row) until every key hint is gone; only then
    // may it shrink to its minimum.
    const name = row.querySelector<HTMLElement>('[data-testid="model-picker"] span');
    const natural = name ? Math.min(name.scrollWidth + 37, row.clientWidth * 0.4) : 0;
    // The splitting label is read in full: the buttons give up their hints and size for it first.
    const status = row.querySelector<HTMLElement>('[data-testid="composer-splitting"] .truncate');
    const leftNeed = status
      ? Math.min(status.scrollWidth + 14, row.clientWidth * 0.5)
      : !pickerShown
        ? 0
        : squeeze >= 3
          ? PICKER_MIN
          : natural;
    if (right.offsetWidth + 12 + leftNeed > row.clientWidth && squeeze < 4) setFitted({ key: layoutKey, squeeze: (squeeze + 1) as Squeeze });
  });

  const send = (action: "send" | "branch" | "each") => {
    if (blocked) return;
    const prompt = draft.trim();
    if (action === "branch" && mode === "open" && branchReason === null && !prompt) {
      branchFromLastTurn(threadId);
      return;
    }
    if (!prompt) return;
    if (document.activeElement === ref.current) setRefocus("yes");
    if (action === "each") {
      if (canAskEach) askEach(threadId, prompt);
    } else if (mode === "first" || action === "send") continueHere(threadId, prompt);
    else if (branchReason === null) branchOff(threadId, prompt);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const command = e.ctrlKey || e.metaKey;
    if (e.shiftKey && !command) return; // Shift+Enter: a new line
    e.preventDefault();
    send(command && e.shiftKey ? "each" : command ? "branch" : "send");
  };

  const size = squeeze >= 4 ? "sm" : "md";
  const hint = (step: Squeeze, text: string) => (squeeze >= step ? undefined : text);
  const askTip = `Asks this question about every option, each in its own card: ${options.join("; ")}`;

  return (
    <div data-testid="composer" className="shrink-0 overflow-hidden border-t border-line px-6 py-4 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-[760px]">
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
            placeholder={placeholder(mode, isBranch)}
            className="block min-h-[48px] w-full resize-none bg-transparent px-3 py-3 text-[16px] leading-[1.5] text-fg outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
        </div>
        <div ref={rowRef} className="@container mt-3 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center">
            {mode === "splitting" ? (
              <span data-testid="composer-splitting" className="label-sm flex min-w-0 items-center gap-2 text-fg">
                <LiveDot />
                <span className="truncate">Splitting across {options.length} options</span>
              </span>
            ) : (
              pickerShown && <ModelPicker className="-ml-2 max-w-[min(100%,40cqw)]" />
            )}
          </div>
          <div ref={rightRef} className="flex shrink-0 items-center gap-2">
            {mode === "first" ? (
              <Button
                variant="primary"
                size={size}
                keyHint={hint(3, "Enter")}
                data-testid="composer-continue"
                tip="Adds your message to this card."
                disabledReason={empty ? "Type a message first" : null}
                onClick={() => send("send")}
              >
                Send
              </Button>
            ) : (
              <>
                {canAskEach && (
                  <Button
                    variant={eachFirst ? "primary" : "secondary"}
                    size={size}
                    keyHint={hint(1, "Ctrl+Shift+Enter")}
                    data-testid="composer-ask-each"
                    tip={askTip}
                    disabledReason={blocked ?? (empty ? "Type a question first" : null)}
                    onClick={() => send("each")}
                  >
                    Ask each <span className="num text-[12px]">{options.length}</span>
                  </Button>
                )}
                <Button
                  size={size}
                  keyHint={hint(2, "Ctrl+Enter")}
                  data-testid="composer-branch"
                  tip={empty ? "Starts a new empty card from here. This card stays as it is." : "Starts a new card from here with this message. This card stays as it is."}
                  disabledReason={branchReason}
                  onClick={() => send("branch")}
                >
                  New branch
                </Button>
                <Button
                  variant={eachFirst ? "secondary" : "primary"}
                  size={size}
                  keyHint={hint(3, "Enter")}
                  data-testid="composer-continue"
                  tip="Adds your message to this card."
                  disabledReason={blocked ?? (empty ? "Type a message first" : null)}
                  onClick={() => send("send")}
                >
                  Send
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
