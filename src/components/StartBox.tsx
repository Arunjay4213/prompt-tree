import { useEffect, useRef, useState } from "react";
import { sendFirstPrompt, useStore } from "../store";
import { Button, Label, LabelSm } from "./ui";

const STEPS = [
  { n: "01", name: "Ask", text: "Start with one question." },
  { n: "02", name: "Branch", text: "Follow side questions in their own cards. Each branch only sees its own path." },
  { n: "03", name: "Collect", text: "Pick the best parts from any branch and combine them." },
];

// The start screen of a blank conversation: one question starts the tree.
export function StartBox() {
  const [text, setText] = useState("");
  const focusTick = useStore((s) => s.composerFocusTick);
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
              className="scroll-y mt-6 block w-full resize-none bg-transparent text-[15px] leading-[1.5] text-fg outline-none placeholder:text-faint"
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line-soft px-6 py-3">
            <LabelSm>Enter to start · Shift+Enter new line</LabelSm>
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
