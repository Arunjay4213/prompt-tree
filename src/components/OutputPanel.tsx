import { Copy, Download, Paperclip, Square, TextSelect } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { Conversation, FinalOutput } from "../../shared/api";
import { combine, copyWithToast, selectOpenConversation, setOutputInstruction, stopCombine, useStore } from "../store";
import { downloadText, plural } from "../text";
import * as tree from "../tree";
import { Markdown, useStreamText } from "./Markdown";
import { ClipList } from "./panel/ClipList";
import { Button, ICON, IconButton, Label, LabelSm, LiveDot, Skeleton } from "./ui";


// The Output tab: the clips in order, the Combine step, and the combined document.
export function OutputPanel() {
  const conv = useStore(selectOpenConversation);
  if (!conv) return null;
  const clips = conv.clips.length;

  return (
    <div className="scroll-y min-h-0 flex-1 overflow-x-hidden" data-testid="output-body">
      <div className="px-6 pt-6 pb-12">
        <div className="flex h-5 items-center justify-between gap-4">
          <Label>Final output</Label>
          {clips > 0 && <LabelSm className="num">{plural(clips, "clip")}</LabelSm>}
        </div>
        {clips === 0 ? (
          <EmptyOutput />
        ) : (
          <>
            <div className="mt-4">
              <ClipList conv={conv} />
            </div>
            <Button size="sm" icon={Copy} className="mt-4" data-testid="copy-clips" onClick={() => copyWithToast(tree.clipsAsMarkdown(conv))}>
              Copy clips
            </Button>
            <Combine output={conv.output} />
          </>
        )}
        {conv.output.status !== "empty" && <CombinedDocument conv={conv} />}
      </div>
    </div>
  );
}

function EmptyOutput() {
  return (
    <div className="mt-4 border-y border-line-soft py-6">
      <h2 className="text-[18px] leading-[1.3] font-medium tracking-[-0.01em]">Nothing collected yet</h2>
      <p className="mt-3 text-[13.5px] leading-[1.6] text-pretty text-muted">
        Press <Paperclip {...ICON} className="inline-block align-[-3px] text-fg" /> on a card, or <span className="label-sm text-fg">Add to output</span> under
        an answer, to collect the whole answer.
      </p>
      <p className="mt-2 text-[13.5px] leading-[1.6] text-pretty text-muted">
        Select text <TextSelect {...ICON} className="inline-block align-[-3px] text-fg" /> inside an answer to collect just that part as an excerpt.
      </p>
    </div>
  );
}

function Combine({ output }: { output: FinalOutput }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const running = tree.outputInFlight(output);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 200)}px`;
    el.style.overflowY = el.scrollHeight + 2 > 200 ? "auto" : "hidden";
  }, [output.instruction]);

  return (
    <section className="mt-8">
      <Label>Combine</Label>
      <div className="mt-3 rounded-cell border border-line transition-colors focus-within:border-fg">
        <textarea
          ref={ref}
          value={output.instruction}
          onChange={(e) => setOutputInstruction(e.target.value)}
          rows={1}
          aria-label="How to combine"
          placeholder="Optional: how should these be combined?"
          className="block min-h-[46px] w-full resize-none bg-transparent px-3 py-3 text-[15px] leading-[1.5] text-fg outline-none placeholder:text-faint"
        />
      </div>
      <div className="mt-3 flex justify-end">
        {running ? (
          <Button icon={Square} data-testid="combine-stop" onClick={stopCombine}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" data-testid="combine-run" onClick={combine}>
            Combine into one document
          </Button>
        )}
      </div>
    </section>
  );
}

function fileName(conv: Conversation): string {
  const base = conv.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/, "");
  return base || "prompt-tree-output";
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// The status next to COMBINED DOCUMENT.
function OutputState({ output }: { output: FinalOutput }) {
  switch (output.status) {
    case "waiting":
      return (
        <LabelSm className="flex items-center gap-2 text-fg">
          <LiveDot />
          Thinking
        </LabelSm>
      );
    case "streaming":
      return (
        <LabelSm className="flex items-center gap-2 text-fg">
          <LiveDot />
          Writing
        </LabelSm>
      );
    case "complete":
      return <LabelSm className="num">{plural(wordCount(output.text), "word")}</LabelSm>;
    case "truncated":
      return <LabelSm>Cut off</LabelSm>;
    case "stopped":
      return <LabelSm className="text-fg">Stopped</LabelSm>;
    case "failed":
      return <LabelSm className="text-fail">Failed</LabelSm>;
    case "empty":
      return null;
  }
}

function CombinedDocument({ conv }: { conv: Conversation }) {
  const output = conv.output;
  const hasText = output.text.trim() !== "";
  const failed = output.status === "failed";
  const text = useStreamText(output.text, tree.outputInFlight(output));

  return (
    <section className="mt-8">
      <div className="flex h-7 items-center gap-3">
        <Label className="shrink-0">Combined document</Label>
        <OutputState output={output} />
        <span className="flex-1" />
        <span className="-mr-1.5 flex shrink-0">
          <IconButton
            icon={Copy}
            label="Copy as markdown"
            data-testid="output-copy"
            disabledReason={hasText ? null : "Nothing to copy yet"}
            onClick={() => copyWithToast(output.text)}
          />
          <IconButton
            icon={Download}
            label="Download as .md"
            data-testid="output-download"
            disabledReason={hasText ? null : "Nothing to download yet"}
            onClick={() => downloadText(`${fileName(conv)}.md`, output.text)}
          />
        </span>
      </div>
      <div data-testid="output-document" className={`ticks mt-3 rounded-cell border p-5 ${failed ? "border-fail" : "border-line"}`}>
        {output.status === "waiting" && (
          <div className="space-y-3 py-1" aria-label="Waiting for the document">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        )}
        {failed && (
          <div role="alert">
            <p className="text-[13.5px] leading-[1.5] [overflow-wrap:anywhere] text-fg">{output.error ?? "The request failed."}</p>
            <p className="mt-1 text-[13px] leading-[1.5] text-muted">Press Combine into one document to try again.</p>
          </div>
        )}
        {hasText && !failed && <Markdown text={text} />}
        {output.status === "stopped" && !hasText && <p className="text-[13.5px] leading-[1.5] text-muted">Stopped before any text arrived.</p>}
        {output.status === "truncated" && (
          <p className="mt-4 border-t border-line-soft pt-3 text-[13px] leading-[1.5] text-muted">
            The document reached the model's length limit and was cut off here.
          </p>
        )}
      </div>
    </section>
  );
}
