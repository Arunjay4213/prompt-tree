import { Check, CornerDownRight, RotateCcw, Square, X } from "lucide-react";
import { memo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Turn } from "../../../shared/api";
import {
  branchFromTurn,
  copyWithToast,
  goToThread,
  removeTurn,
  retryTurn,
  selectOpenConversation,
  splitOff,
  stopTurn,
  toggleAnswerClip,
  useStore,
} from "../../store";
import { plural } from "../../text";
import * as tree from "../../tree";
import { Markdown, useStreamText } from "../Markdown";
import { Button, ICON, LabelSm, LiveDot, Skeleton, Tag, Tip } from "../ui";

// What a turn needs from the rest of the conversation, as plain values, so the turn re-renders
// only when one of them changes (not on every streamed chunk of another turn).
type TurnFacts = {
  clipped: boolean;
  excerpts: number;
  split: string | null; // null: allowed; otherwise why not
  retry: string | null;
  remove: string | null;
};

const NO_FACTS: TurnFacts = { clipped: false, excerpts: 0, split: "Turn not found", retry: "Turn not found", remove: "Turn not found" };
const NONE: never[] = [];

function reason(allowed: tree.Allowed): string | null {
  return allowed.ok ? null : allowed.reason;
}

// One turn in the Thread tab: the prompt, the answer, and what can be done with it.
export const TurnView = memo(function TurnView({ threadId, turn, index, isLast }: { threadId: string; turn: Turn; index: number; isLast: boolean }) {
  const facts = useStore(
    useShallow((s): TurnFacts => {
      const conv = selectOpenConversation(s);
      if (!conv) return NO_FACTS;
      return {
        clipped: tree.answerClip(conv, turn.id) !== undefined,
        excerpts: conv.clips.filter((c) => c.kind === "excerpt" && c.turnId === turn.id).length,
        split: reason(tree.splitAllowed(conv, threadId, turn.id)),
        retry: reason(tree.retryAllowed(conv, turn.id)),
        remove: reason(tree.removeAllowed(conv, turn.id)),
      };
    }),
  );
  const branches = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      return conv ? tree.childrenOfTurn(conv, turn.id) : NONE;
    }),
  );
  const branchNumbers = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      if (!conv || branches.length === 0) return NONE;
      const numbers = tree.pathNumbers(conv);
      return tree.childrenOfTurn(conv, turn.id).map((t) => numbers[t.id] ?? "");
    }),
  );

  const inFlight = tree.isInFlight(turn);
  const answer = useStreamText(turn.answer, inFlight);
  const hasAnswer = turn.answer.trim() !== "";
  const copy = () => copyWithToast(turn.answer);

  return (
    <section data-testid={`turn-panel-${turn.id}`} data-last={isLast} className="turn border-b border-line-soft py-7 last:border-b-0">
      <span data-turn-start className="label-sm flex items-center gap-2">
        <span className="num text-fg">{String(index + 1).padStart(2, "0")}</span>
        You
      </span>
      <p className="mt-2 text-[15px] leading-[1.5] font-medium tracking-[-0.005em] [overflow-wrap:anywhere] whitespace-pre-wrap text-fg">
        {turn.prompt}
      </p>

      <div className="mt-5 flex h-7 items-center gap-3">
        <LabelSm>Luna</LabelSm>
        <TurnState turn={turn} />
        <span className="flex-1" />
        {inFlight && (
          <Button size="sm" icon={Square} data-testid="turn-stop" onClick={() => stopTurn(turn.id)}>
            Stop
          </Button>
        )}
        {turn.status === "stopped" && isLast && (
          <>
            <Button size="sm" icon={RotateCcw} data-testid="turn-retry" disabledReason={facts.retry} onClick={() => retryTurn(turn.id)}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" icon={X} data-testid="turn-remove" disabledReason={facts.remove} onClick={() => removeTurn(turn.id)}>
              Remove
            </Button>
          </>
        )}
      </div>

      <div className="mt-1">
        {turn.status === "waiting" && <WaitingLines />}
        {turn.status === "failed" && <FailedBox message={turn.error} turnId={turn.id} retry={facts.retry} remove={facts.remove} />}
        {hasAnswer && turn.status !== "failed" && (
          <div data-answer-turn={turn.id}>
            <Markdown text={answer} />
          </div>
        )}
        {turn.status === "stopped" && !hasAnswer && (
          <p className="text-[13.5px] leading-[1.5] text-muted">Stopped before any text arrived.</p>
        )}
        {turn.status === "truncated" && (
          <p className="mt-4 text-[13px] leading-[1.5] text-pretty text-muted">
            The answer reached the model's length limit and was cut off here. Continue the thread to get the rest.
          </p>
        )}
      </div>

      {!inFlight && turn.status !== "failed" && (
        <div className="mt-4 -ml-2 flex items-center gap-1">
          {facts.clipped ? (
            <Tip content="Remove from the output">
              <button type="button" data-testid="turn-clip" className="tag tag-output ml-2 cursor-pointer transition-colors hover:border-fg" onClick={() => toggleAnswerClip(threadId, turn.id)}>
                <Check {...ICON} />
                In output
              </button>
            </Tip>
          ) : (
            <TurnAction testId="turn-clip" disabledReason={hasAnswer ? null : "There is no answer to add"} onClick={() => toggleAnswerClip(threadId, turn.id)}>
              Add to output
            </TurnAction>
          )}
          <TurnAction
            testId="turn-branch"
            tip="A new card that continues from this answer"
            disabledReason={tree.canBranchFrom(turn) ? null : "Branching needs an answer with text"}
            onClick={() => branchFromTurn(threadId, turn.id)}
          >
            Branch
          </TurnAction>
          {index > 0 && (
            <TurnAction
              testId="turn-split"
              tip="Move this turn and the ones after it into a new card"
              disabledReason={facts.split}
              onClick={() => splitOff(threadId, turn.id)}
            >
              Split off
            </TurnAction>
          )}
          <TurnAction testId="turn-copy" disabledReason={hasAnswer ? null : "There is no answer to copy"} onClick={copy}>
            Copy
          </TurnAction>
        </div>
      )}

      {facts.excerpts > 0 && (
        <Tag variant="output" className="mt-3">
          <span className="num">{plural(facts.excerpts, "excerpt")}</span> in output
        </Tag>
      )}

      {branches.length > 0 && (
        <ul className="mt-3" aria-label="Branches from this turn">
          {branches.map((b, i) => (
            <li key={b.id}>
              <button
                type="button"
                data-testid="turn-branch-link"
                onClick={() => goToThread(b.id)}
                className="group -mx-2 flex h-8 w-[calc(100%+16px)] items-center gap-2 rounded-cell px-2 text-left transition-colors hover:bg-surface"
              >
                <CornerDownRight {...ICON} className="shrink-0 text-faint" />
                <span className="label-sm num shrink-0 text-fg">{branchNumbers[i]}</span>
                <span className="min-w-0 truncate text-[13.5px] text-muted transition-colors group-hover:text-fg">{tree.threadTitle(b)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});

// The live state next to LUNA.
function TurnState({ turn }: { turn: Turn }) {
  switch (turn.status) {
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
    case "truncated":
      return <LabelSm>Cut off</LabelSm>;
    case "stopped":
      return <LabelSm className="text-fg">Stopped</LabelSm>;
    case "failed":
    case "complete":
      return null;
  }
}

// Placeholder lines at the reading rhythm while the first text is on its way.
function WaitingLines() {
  return (
    <div aria-label="Waiting for the answer" className="space-y-3 pt-2 pb-1">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

function FailedBox({ message, turnId, retry, remove }: { message: string | null; turnId: string; retry: string | null; remove: string | null }) {
  return (
    <div className="rounded-cell border border-fail px-4 py-3" role="alert">
      <LabelSm className="text-fail">Failed</LabelSm>
      <p className="mt-1 text-[13.5px] leading-[1.5] [overflow-wrap:anywhere] text-fg">{message ?? "The request failed."}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" icon={RotateCcw} data-testid="turn-retry" disabledReason={retry} onClick={() => retryTurn(turnId)}>
          Retry
        </Button>
        <Button size="sm" variant="ghost" icon={X} data-testid="turn-remove" disabledReason={remove} onClick={() => removeTurn(turnId)}>
          Remove
        </Button>
      </div>
    </div>
  );
}

// A small mono text button in the action row under an answer.
function TurnAction({
  testId,
  tip,
  disabledReason,
  onClick,
  children,
}: {
  testId: string;
  tip?: string;
  disabledReason: string | null;
  onClick: () => void;
  children: ReactNode;
}) {
  const disabled = disabledReason !== null;
  return (
    <Tip content={disabled ? disabledReason : tip}>
      <button type="button" data-testid={testId} aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick} className="turn-action">
        {children}
      </button>
    </Tip>
  );
}
