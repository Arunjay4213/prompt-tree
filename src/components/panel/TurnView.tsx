import { Check, ChevronDown, ChevronRight, Copy, CornerDownRight, GitBranch, Paperclip, RotateCcw, Square, X, type LucideIcon } from "lucide-react";
import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Turn } from "../../../shared/api";
import {
  branchAllOptions,
  branchForOption,
  branchFromTurn,
  copyWithToast,
  dismissTip,
  goToThread,
  removeTurn,
  retryTurn,
  selectOpenConversation,
  splitOff,
  stopTurn,
  toggleAnswerClip,
  useStore,
} from "../../store";
import { modelName, offeredOptions, plural, splitQuote } from "../../text";
import * as tree from "../../tree";
import { Markdown, useStreamText } from "../Markdown";
import { MenuItem, MoreMenu } from "../Menu";
import { Button, ICON, IconButton, LabelSm, LiveDot, Skeleton, Tag, Tip } from "../ui";

// What a turn needs from the rest of the conversation, as plain values, so the turn re-renders
// only when one of them changes (not on every streamed chunk of another turn).
type TurnFacts = {
  clipped: boolean;
  excerpts: number;
  split: string | null; // null: allowed; otherwise why not
  retry: string | null;
  remove: string | null;
  tip: boolean; // the first-use tip goes under this turn
};

const NO_FACTS: TurnFacts = { clipped: false, excerpts: 0, split: "Turn not found", retry: "Turn not found", remove: "Turn not found", tip: false };
const NONE: never[] = [];

function reason(allowed: tree.Allowed): string | null {
  return allowed.ok ? null : allowed.reason;
}

// own:     a turn of the open thread, with every action.
// earlier: a turn the open branch inherited from an ancestor, for reading and collecting only.
export type TurnRole = "own" | "earlier";

// One turn in the Thread tab: the prompt, the answer, and what can be done with it.
// `threadId` is always the thread that owns the turn, also for an earlier turn.
export const TurnView = memo(function TurnView({
  role,
  threadId,
  turn,
  index,
  isLast,
}: {
  role: TurnRole;
  threadId: string;
  turn: Turn;
  index: number;
  isLast: boolean;
}) {
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
        tip: role === "own" && s.tip.kind === "pending" && s.tip.conversationId === conv.id && tree.rootThread(conv).turns[0]?.id === turn.id,
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
  const finished = !inFlight && tree.canBranchFrom(turn);
  // Parsed once per answer text (memoized), and never while the answer streams.
  const options = finished && role === "own" ? offeredOptions(turn.prompt, turn.answer) : NONE;
  const [look, setLookState] = useState<OptionLook>(() => chosenLooks.get(turn.id) ?? "expanded");
  const setLook = (next: OptionLook) => {
    chosenLooks.set(turn.id, next);
    setLookState(next);
  };
  // The branch of each option, as the expanded options block links them. Those branches are left
  // out of the list of branches under the action row, so no card is listed twice.
  const optionBranches = options.length >= 2 ? options.map((title) => branches.findIndex((b) => b.title.trim() === title.trim())) : NONE;
  const listed = look === "expanded" ? branches.filter((_, i) => !optionBranches.includes(i)) : branches;
  const copy = () => copyWithToast(turn.answer);
  const clip = () => toggleAnswerClip(threadId, turn.id);
  const branch = () => branchFromTurn(threadId, turn.id);

  return (
    <section data-testid={`turn-panel-${turn.id}`} data-last={isLast} data-role={role} className="turn border-b border-line-soft py-7 last:border-b-0">
      <span data-turn-start className="label-sm flex items-center gap-2">
        <span className="num text-fg">{String(index + 1).padStart(2, "0")}</span>
        You
      </span>
      <Prompt text={turn.prompt} />

      {/* The sticky label row and the answer share this box, so the row stops sticking when the
          answer's last lines leave, before the action row under the answer reaches the top. */}
      <div>
        <AnswerLabelRow>
          <span data-testid="turn-model" className="label-sm min-w-0 truncate">
            {modelName(turn.model)}
          </span>
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
          {finished && <RowActions role={role} clipped={facts.clipped} onClip={clip} onBranch={branch} />}
        </AnswerLabelRow>

        <div className="mt-1">
          {turn.status === "waiting" && <WaitingLines />}
          {turn.status === "failed" && <FailedBox message={turn.error} turnId={turn.id} retry={facts.retry} remove={facts.remove} />}
          {hasAnswer && turn.status !== "failed" && (
            <div data-answer-turn={turn.id} data-answer-thread={threadId} data-answer-role={role}>
              <Markdown text={answer} />
            </div>
          )}
          {turn.status === "stopped" && !hasAnswer && <p className="text-[14px] leading-[1.5] text-muted">Stopped before any text arrived.</p>}
          {turn.status === "truncated" && (
            <p className="mt-4 text-[14px] leading-[1.5] text-pretty text-muted">
              The answer reached the model's length limit and was cut off here. Send a message to get the rest.
            </p>
          )}
        </div>
      </div>

      {options.length >= 2 && (
        <OptionBlock
          threadId={threadId}
          turnId={turn.id}
          options={options}
          optionBranches={optionBranches}
          branches={branches}
          branchNumbers={branchNumbers}
          look={look}
          setLook={setLook}
        />
      )}

      {!inFlight && turn.status !== "failed" && (
        <div className="mt-4 -ml-2 flex items-center gap-1">
          <Tip content={facts.clipped ? "Takes this answer out of the final output." : hasAnswer ? "Adds this answer to the final output." : null}>
            <button
              type="button"
              data-testid="turn-clip"
              aria-disabled={!hasAnswer || undefined}
              onClick={hasAnswer ? clip : undefined}
              className={`action-btn ${facts.clipped ? "action-btn-on" : ""}`}
            >
              {facts.clipped ? <Check {...ICON} /> : <Paperclip {...ICON} />}
              {facts.clipped ? "In output" : "Add to output"}
            </button>
          </Tip>
          {role === "own" && (
            <ActionButton
              icon={GitBranch}
              testId="turn-branch"
              tip="Starts a new card that continues from this answer."
              disabledReason={tree.canBranchFrom(turn) ? null : "Branching needs an answer with text"}
              onClick={branch}
            >
              Branch
            </ActionButton>
          )}
          <ActionButton icon={Copy} testId="turn-copy" tip="Copies this answer as markdown." disabledReason={hasAnswer ? null : "There is no answer to copy"} onClick={copy}>
            Copy
          </ActionButton>
          {role === "own" && (
            <MoreMenu label="More actions" testId="turn-more">
              <MenuItem
                label="Move to a new branch"
                description="Moves this message and the ones after it into their own card."
                disabledReason={facts.split}
                testId="turn-split"
                onSelect={() => splitOff(threadId, turn.id)}
              />
            </MoreMenu>
          )}
        </div>
      )}

      {facts.excerpts > 0 && (
        <Tag variant="output" className="mt-3">
          <span className="num">{plural(facts.excerpts, "excerpt")}</span> in output
        </Tag>
      )}

      {role === "own" && listed.length > 0 && (
        <ul className="mt-3" aria-label="Branches from this turn">
          {listed.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                data-testid="turn-branch-link"
                onClick={() => goToThread(b.id)}
                className="group -mx-2 flex h-8 w-[calc(100%+16px)] items-center gap-2 rounded-cell px-2 text-left text-muted transition-colors hover:bg-surface hover:text-fg"
              >
                <CornerDownRight {...ICON} className="shrink-0" />
                <span className="label-sm num shrink-0 text-fg">{branchNumbers[branches.indexOf(b)]}</span>
                <span className="min-w-0 truncate text-[14px]">{tree.threadTitle(b)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {facts.tip && finished && <FirstUseTip />}
    </section>
  );
});

// The prompt as typed. Leading quoted lines (a quoted selection or option) are drawn as a quote
// block, the person's own text after them in the prompt style; nothing else is read as markdown.
function Prompt({ text }: { text: string }) {
  const { quote, own } = splitQuote(text);
  const style = "text-[16px] leading-[1.55] font-medium tracking-[-0.005em] [overflow-wrap:anywhere] whitespace-pre-wrap text-fg";
  if (!quote) return <p className={`mt-2 ${style}`}>{text}</p>;
  return (
    <div className="mt-2">
      <blockquote data-testid="prompt-quote" className="border-l-2 border-fg pl-4 text-[15px] leading-[1.55] [overflow-wrap:anywhere] whitespace-pre-wrap text-muted">
        {quote}
      </blockquote>
      {own && <p className={`mt-2 ${style}`}>{own}</p>}
    </div>
  );
}

// The two actions on the sticky label row: words and icons when the panel has room (560px and
// more), icons with tooltips when it is narrower, so the row never wraps.
// An earlier turn gets only Add to output.
function RowActions({ role, clipped, onClip, onBranch }: { role: TurnRole; clipped: boolean; onClip: () => void; onBranch: () => void }) {
  const wide = useStore((s) => s.panelWidth >= 560);
  if (!wide) {
    return (
      <span className="-mr-1.5 flex shrink-0 items-center">
        <IconButton
          icon={Paperclip}
          label={clipped ? "In output. Click to take it out" : "Add this answer to the output"}
          active={clipped}
          tone="accent"
          data-testid="turn-clip-icon"
          onClick={onClip}
        />
        {role === "own" && <IconButton icon={GitBranch} label="Branch: a new card that continues from this answer" data-testid="turn-branch-icon" onClick={onBranch} />}
      </span>
    );
  }
  return (
    <span className="-mr-2 flex shrink-0 items-center gap-1">
      <Tip content={clipped ? "Takes this answer out of the final output." : "Adds this answer to the final output."}>
        <button type="button" data-testid="turn-clip-icon" onClick={onClip} className={`action-btn action-btn-row ${clipped ? "action-btn-on" : ""}`}>
          {clipped ? <Check {...ICON} /> : <Paperclip {...ICON} />}
          {clipped ? "In output" : "Add to output"}
        </button>
      </Tip>
      {role === "own" && (
        <Tip content="Starts a new card that continues from this answer.">
          <button type="button" data-testid="turn-branch-icon" onClick={onBranch} className="action-btn action-btn-row">
            <GitBranch {...ICON} />
            Branch
          </button>
        </Tip>
      )}
    </span>
  );
}

// The label row over an answer. It sticks to the top of the scrolling body while its answer is in
// view, so the answer's actions stay in reach; while stuck it has a hairline under it.
type Stuck = "resting" | "stuck";

function AnswerLabelRow({ children }: { children: ReactNode }) {
  const sentinel = useRef<HTMLSpanElement>(null);
  const [stuck, setStuck] = useState<Stuck>("resting");
  useLayoutEffect(() => {
    const el = sentinel.current;
    const root = el?.closest<HTMLElement>('[data-testid="thread-body"]');
    if (!el || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const above = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
        setStuck(!entry.isIntersecting && above ? "stuck" : "resting");
      },
      { root, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <span ref={sentinel} aria-hidden className="block h-px" />
      <div
        data-answer-row
        data-stuck={stuck}
        className={`sticky top-0 z-10 -mx-6 mt-4 flex h-[38px] items-center gap-3 border-b bg-bg px-6 ${stuck === "stuck" ? "border-line-soft" : "border-transparent"}`}
      >
        {children}
      </div>
    </>
  );
}

// "Branch per option": the options of the answer, each a row that creates its branch (or links to
// the branch it already has), and "Branch all".
// collapsed: one quiet row with the count. expanded: the option rows and "Branch all".
type OptionLook = "collapsed" | "expanded";
// A look the person chose, per turn, kept while the page is open (not saved).
const chosenLooks = new Map<string, OptionLook>();

function OptionBlock({
  threadId,
  turnId,
  options,
  optionBranches,
  branches,
  branchNumbers,
  look,
  setLook,
}: {
  threadId: string;
  turnId: string;
  options: string[];
  optionBranches: number[];
  branches: { id: string }[];
  branchNumbers: string[];
  look: OptionLook;
  setLook: (next: OptionLook) => void;
}) {
  if (look === "collapsed") {
    return (
      <div data-testid="option-block" data-look="collapsed" className="mt-5 border-y border-line-soft py-1">
        <button
          type="button"
          data-testid="options-toggle"
          aria-expanded={false}
          onClick={() => setLook("expanded")}
          className="-mx-2 flex h-[30px] w-[calc(100%+16px)] items-center gap-2 rounded-cell px-2 text-left text-[13px] font-medium text-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <ChevronRight {...ICON} className="shrink-0" />
          Branch per option
          <span className="num text-[12px]">{options.length}</span>
        </button>
      </div>
    );
  }
  const existing = optionBranches.map((i) => (i >= 0 ? { id: branches[i]!.id, number: branchNumbers[i] ?? "" } : null));
  const missing = existing.filter((e) => e === null).length;
  return (
    <div data-testid="option-block" data-look="expanded" className="mt-5 border-y border-line-soft py-2">
      <div className="flex h-[34px] items-center gap-3">
        <Tip content="Hide the options">
          <button
            type="button"
            data-testid="options-toggle"
            aria-expanded={true}
            onClick={() => setLook("collapsed")}
            className="-ml-2 flex h-[30px] items-center gap-2 rounded-cell px-2 text-muted transition-colors hover:bg-surface hover:text-fg"
          >
            <ChevronDown {...ICON} className="shrink-0" />
            <LabelSm className="text-muted">Branch per option</LabelSm>
          </button>
        </Tip>
        <span className="flex-1" />
        <Button
          size="sm"
          data-testid="options-branch-all"
          tip={`Creates a card for each option (${options.length}) and selects the first.`}
          disabledReason={missing === 0 ? "Every option already has its card" : null}
          onClick={() => branchAllOptions(threadId, turnId, options)}
        >
          Branch all
        </Button>
      </div>
      <ul>
        {options.map((title, i) => {
          const has = existing[i];
          return (
            <li key={title}>
              <Tip content={has ? "Go to the card for this option" : "A new card for this option, with the option quoted in its box"}>
                <button
                  type="button"
                  data-testid={`option-${i}`}
                  data-has-branch={has ? "yes" : "no"}
                  onClick={() => (has ? goToThread(has.id) : branchForOption(threadId, turnId, title))}
                  className="group -mx-2 flex h-[34px] w-[calc(100%+16px)] items-center gap-2 rounded-cell px-2 text-left text-muted transition-colors hover:bg-surface hover:text-fg"
                >
                  <CornerDownRight {...ICON} className="shrink-0" />
                  <span className="label-sm num w-8 shrink-0 text-fg">{has ? has.number : String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 truncate text-[14px]">{title}</span>
                </button>
              </Tip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Under the first finished answer of the first conversation, until dismissed.
function FirstUseTip() {
  return (
    <div data-testid="first-use-tip" className="mt-5 rounded-cell bg-surface p-4">
      <p className="text-[14px] leading-[1.55] text-fg">
        <strong className="font-medium">Send</strong> adds your message to this card. <strong className="font-medium">New branch</strong> starts a new card from here,
        so you can follow a side question without losing your place. Select any text in an answer to branch from it or save it to the final output.
      </p>
      <div className="mt-3 flex justify-end">
        <Button size="sm" data-testid="tip-dismiss" onClick={dismissTip}>
          Got it
        </Button>
      </div>
    </div>
  );
}

// The live state next to the model name.
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
      return <LabelSm className="text-muted">Cut off</LabelSm>;
    case "stopped":
      return <LabelSm className="text-fg">Stopped</LabelSm>;
    case "failed":
    case "complete":
      return null;
  }
}

// Grey bars at the reading rhythm while the first text is on its way.
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
      <p className="mt-1 text-[14px] leading-[1.5] [overflow-wrap:anywhere] text-fg">{message ?? "The request failed."}</p>
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

// A button in the action row under an answer: an icon and a sentence-case label, always fully visible.
function ActionButton({
  icon: Icon,
  testId,
  tip,
  disabledReason,
  onClick,
  children,
}: {
  icon: LucideIcon;
  testId: string;
  tip: string;
  disabledReason: string | null;
  onClick: () => void;
  children: ReactNode;
}) {
  const disabled = disabledReason !== null;
  return (
    <Tip content={disabled ? disabledReason : tip}>
      <button type="button" data-testid={testId} aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick} className="action-btn">
        <Icon {...ICON} />
        {children}
      </button>
    </Tip>
  );
}
