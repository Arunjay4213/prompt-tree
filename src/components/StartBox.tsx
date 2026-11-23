import { CornerDownRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { selectOpenConversation, sendFirstPrompt, setDraft, useStore } from "../store";
import { ModelPicker } from "./ModelPicker";
import { Button, ICON, Label, LabelSm } from "./ui";

const STEPS = [
  { n: "01", name: "Ask", text: "Start with one question." },
  { n: "02", name: "Branch", text: "Follow side questions in their own cards. Each branch only sees its own path." },
  { n: "03", name: "Collect", text: "Pick the best parts from any branch and combine them." },
];

// The start screen of a blank conversation: one question starts the tree.
// Its text is the root thread's draft, so it survives switching away and back (and a reload).
export function StartBox() {
  const rootId = useStore((s) => selectOpenConversation(s)?.threads[0]?.id ?? "");
  const text = useStore((s) => s.drafts[rootId] ?? "");
  const setText = (value: string) => setDraft(rootId, value);
  const focusTick = useStore((s) => s.composerFocusTick);
  // Demo mode only: the recorded sample's first question, which replays a real answer.
  const suggested = useStore((s) => (s.health.kind === "ready" ? s.health.health.demo?.suggestedPrompt : undefined));
  const ref = useRef<HTMLTextAreaElement>(null);
  const empty = text.trim() === "";

  useEffect(() => {
    ref.current?.focus();
  }, [focusTick]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 264)}px`;
  }, [text]);

  const send = () => {
    if (!empty) sendFirstPrompt(text.trim());
  };

  return (
    <div className="grid-surface scroll-y h-full">
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-12">
        <div className="ticks w-full max-w-[640px] rounded-cell border border-line bg-bg">
          <div className="px-6 pt-6 pb-4">
            <Label>New conversation</Label>
            <h1 className="mt-3 text-[44px] leading-[1.05] font-normal tracking-[-0.04em]">What do you want to explore?</h1>
            <textarea
              ref={ref}
              value={text}
              rows={3}
              aria-label="First question"
              placeholder="Start with a question or a task"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              className="scroll-y mt-6 block w-full resize-none bg-transparent text-[15px] leading-[1.5] text-fg outline-none placeholder:text-muted"
            />
            {suggested && (
              <button
                type="button"
                data-testid="start-suggestion"
                title={suggested}
                onClick={() => sendFirstPrompt(suggested)}
                className="action-btn -ml-2 mt-3 max-w-[calc(100%+16px)]"
              >
                <CornerDownRight {...ICON} className="shrink-0" />
                <span className="truncate">Try: {suggested}</span>
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line-soft px-6 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <ModelPicker className="-ml-2 max-w-[260px]" />
              <LabelSm className="truncate">Enter to start · Shift+Enter new line</LabelSm>
            </div>
            <Button variant="primary" disabledReason={empty ? "Write a question first" : null} onClick={send}>
              Start
            </Button>
          </div>
        </div>
        <ol className="mt-8 grid w-full max-w-[640px] grid-cols-3 border-t border-line">
          {STEPS.map((step) => (
            <li key={step.n} className="border-l border-line-soft pt-4 pr-4 pl-6 first:border-l-0">
              <Label>
                <span className="num text-fg">{step.n}</span>
                <span className="ml-3">{step.name}</span>
              </Label>
              <p className="mt-2 text-[13.5px] leading-[1.5] text-pretty text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
