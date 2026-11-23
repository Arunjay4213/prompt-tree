// One thread drawn as one card on the canvas. The card measures itself (its height and the y of
// every port) and reports it to the canvas, which places all cards with layoutTree.
// Ports, edges and the card position are drawn by the canvas; the card only draws its face.

import { useViewportStore } from "@xyflow/react";
import { ChevronDown, GitBranch, Paperclip } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { Clip, Thread, Turn } from "../../shared/api";
import { branchFromTurn, goToThread, selectOpenConversation, toggleAnswerClip, toggleBranchesView, toggleCardView, useStore } from "../store";
import { plainPreview, plural, promptPreview } from "../text";
import * as tree from "../tree";
import { MIN_ZOOM, zoomBucket } from "./canvas/geometry";
import { IconButton, LabelSm, LiveDot } from "./ui";

// How a card relates to the selected card. The path back to the root is what the model sees.
export type PathState = "selected" | "path" | "normal";

// "empty": a new branch without turns yet. "turns": everything else.
type CardKind = "empty" | "turns";

// The port of a turn sits on the first line of its prompt: the row padding (10) plus half a
// prompt line (9), measured from the top of the row, plus the card's top border (1).
const PORT_IN_ROW = 20;

const NO_CLIPS: Clip[] = [];

// The overview look of an open card: padding, label row, gap and a title of two 17px lines, in
// screen pixels. An open card is never shorter than that at the smallest zoom (plus its border),
// so every overview card has room for two title lines.
const OVERVIEW_STACKED_HEIGHT = 8 + 15 + 4 + 2 * 17 + 8;
const MIN_OPEN_CARD_HEIGHT = Math.ceil(OVERVIEW_STACKED_HEIGHT / MIN_ZOOM) + 2;

type Props = {
  threadId: string;
  pathState: PathState;
  pathNumber: string;
  hiddenCount: number;
  height: number | null; // the last measured height, for the overview look
  onMeasure: (threadId: string, size: tree.CardSize | null) => void;
};

export const ThreadCard = memo(function ThreadCard({ threadId, pathState, pathNumber, hiddenCount, height, onMeasure }: Props) {
  const thread = useStore((s) => {
    const conv = selectOpenConversation(s);
    return conv ? tree.findThread(conv, threadId) : undefined;
  });
  const clips = useStore(useShallow((s) => selectOpenConversation(s)?.clips.filter((c) => c.threadId === threadId) ?? NO_CLIPS));
  const rootRef = useRef<HTMLElement>(null);

  // The card reports its height and port offsets only when they can have changed:
  // - when its structure changes (turns added, moved or removed, folded or opened), measured right
  //   after that render, because ports can move even when the height stays the same;
  // - when its size changes (an answer grows by a line, fonts load), from the ResizeObserver.
  // Both run after layout and before paint, and flushSync makes the canvas place the cards and
  // edges in that same frame. Plain re-renders while text streams within a line measure nothing.
  const measureRef = useRef(() => {});
  measureRef.current = () => {
    const root = rootRef.current;
    if (!root || !thread) return;
    const ports: Record<string, number> = {};
    if (thread.cardView === "folded") {
      for (const turn of thread.turns) ports[turn.id] = tree.HEADER_HEIGHT / 2;
    } else {
      for (const row of root.querySelectorAll<HTMLElement>("[data-turn-row]")) {
        ports[row.dataset.turnRow!] = row.offsetTop + PORT_IN_ROW;
      }
    }
    onMeasure(threadId, { height: root.offsetHeight, ports });
  };
  const structure = `${thread?.cardView}|${thread?.turns.map((t) => t.id).join(",")}`;
  useLayoutEffect(() => measureRef.current(), [structure]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => flushSync(() => measureRef.current()));
    observer.observe(root);
    return () => {
      observer.disconnect();
      onMeasure(threadId, null);
    };
  }, [threadId, onMeasure]);

  if (!thread) return null;
  const kind: CardKind = thread.turns.length === 0 ? "empty" : "turns";
  const folded = thread.cardView === "folded";
  // An empty branch shows its title when it has one (an option's); only an untitled one says "New branch".
  const untitledEmpty = kind === "empty" && thread.title.trim() === "";
  const title = untitledEmpty ? "New branch" : tree.threadTitle(thread);

  return (
    <article
      ref={rootRef}
      data-testid={`card-${threadId}`}
      data-path-state={pathState}
      data-kind={kind}
      aria-label={`${pathNumber} ${title}`}
      aria-current={pathState === "selected" || undefined}
      className={`pt-card ${pathState === "selected" ? "ticks" : ""}`}
      style={kind === "turns" && !folded ? { minHeight: MIN_OPEN_CARD_HEIGHT } : undefined}
      onClick={() => goToThread(threadId)}
    >
      <div className="pt-face">
        <CardHeader thread={thread} kind={kind} pathNumber={pathNumber} hiddenCount={hiddenCount} clipCount={clips.length} />
        {!folded && (
          <div className="pt-body">
            {kind === "empty" && <p className="px-3 py-2.5 text-[13px] leading-[19px] text-muted">Write the first prompt in the panel.</p>}
            {thread.turns.map((turn, index) => (
              <TurnRow
                key={turn.id}
                threadId={thread.id}
                turn={turn}
                index={index}
                only={thread.turns.length === 1}
                clipped={clips.some((c) => c.kind === "answer" && c.turnId === turn.id)}
                excerpts={clips.filter((c) => c.kind === "excerpt" && c.turnId === turn.id).length}
              />
            ))}
          </div>
        )}
      </div>
      {height !== null && (
        <OverviewFace
          pathNumber={pathNumber}
          title={title}
          clipCount={clips.length}
          turnCount={thread.turns.length}
          live={tree.threadInFlight(thread)}
          innerHeight={height - 2}
        />
      )}
    </article>
  );
});

function CardHeader({
  thread,
  kind,
  pathNumber,
  hiddenCount,
  clipCount,
}: {
  thread: Thread;
  kind: CardKind;
  pathNumber: string;
  hiddenCount: number;
  clipCount: number;
}) {
  const folded = thread.cardView === "folded";
  return (
    <header className={`flex items-center gap-2 pr-1.5 pl-3 ${folded ? "h-[38px]" : "h-[39px] border-b border-line-soft"}`}>
      <LabelSm className="num shrink-0">{pathNumber}</LabelSm>
      {kind === "empty" && thread.title.trim() === "" ? (
        <LabelSm className="min-w-0 flex-1 truncate text-muted">New branch</LabelSm>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[18px] font-medium tracking-[-0.005em] text-fg" data-card-title>
          {tree.threadTitle(thread)}
        </span>
      )}
      {folded && clipCount > 0 && (
        <span className="flex shrink-0 items-center gap-1.5" aria-label={`${clipCount} in the output`}>
          <span className="size-1.5 bg-accent" aria-hidden />
          <LabelSm className="num text-accent">{clipCount}</LabelSm>
        </span>
      )}
      {folded && tree.threadInFlight(thread) && <LiveDot />}
      {kind === "turns" && <LabelSm className="num shrink-0">{thread.turns.length}</LabelSm>}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="nopan tag pt-hidden-tag"
          onClick={(e) => {
            e.stopPropagation();
            toggleBranchesView(thread.id);
          }}
        >
          +{hiddenCount} hidden
        </button>
      )}
      <FoldButton threadId={thread.id} folded={folded} />
    </header>
  );
}

// Memoized on plain values, so a streaming card does not rebuild its fold button on every text update.
const FoldButton = memo(function FoldButton({ threadId, folded }: { threadId: string; folded: boolean }) {
  return (
    <IconButton
      icon={ChevronDown}
      label={folded ? "Open card" : "Fold card"}
      data-testid="card-fold"
      className={`nopan pt-chevron ${folded ? "" : "rotate-180"}`}
      onClick={(e) => {
        e.stopPropagation();
        toggleCardView(threadId);
      }}
    />
  );
});

const TurnRow = memo(function TurnRow({
  threadId,
  turn,
  index,
  only,
  clipped,
  excerpts,
}: {
  threadId: string;
  turn: Turn;
  index: number;
  only: boolean; // the card's only turn
  clipped: boolean;
  excerpts: number;
}) {
  const branchReason = branchDisabledReason(turn);
  const clipReason = tree.isInFlight(turn) ? "Wait for the answer to finish" : turn.answer.trim() === "" ? "There is no answer to clip" : null;
  return (
    <div data-turn-row={turn.id} data-testid={`turn-${turn.id}`} data-clipped={clipped} className="pt-row group/row">
      {clipped && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" aria-hidden />}
      <LabelSm className={`num w-6 shrink-0 leading-[18px] ${clipped ? "text-accent" : ""}`}>{String(index + 1).padStart(2, "0")}</LabelSm>
      <div className="min-w-0 flex-1">
        {/* pr-14 keeps the two row buttons' place free on the prompt's lines, so no text is ever under them. */}
        <p className="line-clamp-2 pr-14 text-[13px] leading-[18px] font-medium text-fg [overflow-wrap:anywhere]">{promptPreview(turn.prompt)}</p>
        <TurnAnswer turn={turn} excerpts={excerpts} only={only} />
      </div>
      <RowActions threadId={threadId} turnId={turn.id} clipped={clipped} clipReason={clipReason} branchReason={branchReason} />
    </div>
  );
});

// The branch and clip buttons of a turn row. Memoized on plain values, so a row whose answer is
// streaming does not rebuild its buttons (and their tooltips) on every piece of text.
const RowActions = memo(function RowActions({
  threadId,
  turnId,
  clipped,
  clipReason,
  branchReason,
}: {
  threadId: string;
  turnId: string;
  clipped: boolean;
  clipReason: string | null;
  branchReason: string | null;
}) {
  return (
    <div className="pt-row-actions">
      <IconButton
        icon={GitBranch}
        label="Branch from here"
        disabledReason={branchReason}
        data-testid="card-branch"
        className="nopan pt-row-action"
        onClick={(e) => {
          e.stopPropagation();
          branchFromTurn(threadId, turnId);
        }}
      />
      <IconButton
        icon={Paperclip}
        label={clipped ? "Remove answer from output" : "Add answer to output"}
        tone="accent"
        active={clipped}
        disabledReason={clipReason}
        data-testid="card-clip"
        className={`nopan pt-row-action ${clipped ? "pt-row-action-pinned" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnswerClip(threadId, turnId);
        }}
      />
    </div>
  );
});

function branchDisabledReason(turn: Turn): string | null {
  if (tree.canBranchFrom(turn)) return null;
  switch (turn.status) {
    case "waiting":
    case "streaming":
      return "Wait for the answer to finish";
    case "failed":
      return "A failed turn has no answer to branch from";
    default:
      return "This turn has no answer to branch from";
  }
}

// The answer part of a turn row: a designed look for every turn status.
// The preview shows four lines, or six as the only turn of a card: the card's minimum height
// (MIN_OPEN_CARD_HEIGHT) has room for them, so the card ends near its text instead of with a blank band.
function TurnAnswer({ turn, excerpts, only }: { turn: Turn; excerpts: number; only: boolean }) {
  const preview = useMemo(() => (turn.status === "streaming" ? "" : plainPreview(turn.answer)), [turn.answer, turn.status]);
  const excerptTag = excerpts > 0 && (
    <span className="tag tag-output h-5 px-1.5">
      {excerpts} {excerpts === 1 ? "excerpt" : "excerpts"}
    </span>
  );
  const previewText = preview !== "" && <p className={`pt-preview mt-1 ${only ? "line-clamp-6" : "line-clamp-4"}`}>{preview}</p>;
  switch (turn.status) {
    case "waiting":
      return (
        <div className="mt-1 flex h-[19px] items-center gap-1.5">
          <LabelSm>Thinking</LabelSm>
          <span className="pt-thinking" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
      );
    case "streaming":
      return (
        <>
          <StreamingTail answer={turn.answer} />
          <Meta>
            <LabelSm className="flex items-center gap-1.5 text-fg">
              <LiveDot /> Writing
            </LabelSm>
          </Meta>
        </>
      );
    case "complete":
      return (
        <>
          {previewText}
          {excerptTag && <Meta>{excerptTag}</Meta>}
        </>
      );
    case "truncated":
    case "stopped":
      return (
        <>
          {previewText}
          <Meta>
            <LabelSm>{turn.status === "truncated" ? "Cut off" : "Stopped"}</LabelSm>
            {excerptTag}
          </Meta>
        </>
      );
    case "failed":
      return (
        <>
          <Meta>
            <LabelSm className="text-fail">Failed</LabelSm>
          </Meta>
          <p className="pt-preview mt-1 line-clamp-2">{turn.error ?? "The request failed"}</p>
        </>
      );
  }
}

function Meta({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex min-h-[15px] items-center gap-2">{children}</div>;
}

// While an answer streams, the row shows the last four lines of its text.
function StreamingTail({ answer }: { answer: string }) {
  // The whole answer is converted, then cut: a cut inside a code block would confuse the converter.
  const tail = plainPreview(answer).slice(-600);
  if (tail === "") return null;
  return (
    <div className="pt-tail mt-1">
      <p className="pt-preview">{tail}</p>
    </div>
  );
}

// Below the overview zoom the card shows its title in large type instead of its turns. The face
// is drawn at screen size and scaled up by 1 / zoom, so the title reads like 13px on screen.
const OverviewFace = memo(function OverviewFace({
  pathNumber,
  title,
  clipCount,
  turnCount,
  live,
  innerHeight,
}: {
  pathNumber: string;
  title: string;
  clipCount: number;
  turnCount: number;
  live: boolean;
  innerHeight: number;
}) {
  const zoom = useViewportStore((s) => zoomBucket(s.transform[2]));
  const available = innerHeight * zoom; // screen pixels
  // "stacked": a label row (path number, clips, live dot) above a title of up to two lines.
  // "inline": one row, for cards too short on screen for that (folded cards and new empty branches).
  const look: "stacked" | "inline" = available >= OVERVIEW_STACKED_HEIGHT ? "stacked" : "inline";
  const inlineLine = Math.min(17, Math.floor(available));
  // "3 TURNS", or only "3" when the row is too narrow for the path number and the word. A mono
  // character of the 11px label is about 7.1px wide; the row has two 8px gaps around its spacer,
  // and the clip mark and the live dot take about 32 and 14px with their gaps.
  const rowWidth = (tree.CARD_WIDTH - 2) * zoom - 24;
  const wordFits =
    (pathNumber.length + plural(turnCount, "turn").length) * 7.1 + 16 + (clipCount > 0 ? 32 : 0) + (live ? 14 : 0) <= rowWidth;
  const turnLabel = wordFits ? plural(turnCount, "turn") : String(turnCount);
  const box = {
    width: (tree.CARD_WIDTH - 2) * zoom,
    height: available,
    transform: `scale(${1 / zoom})`,
    transformOrigin: "0 0",
  };
  const marks = (
    <>
      {clipCount > 0 && (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="size-1.5 bg-accent" />
          <span className="num text-[11px] leading-[15px] text-accent">{clipCount}</span>
        </span>
      )}
      {live && <LiveDot />}
    </>
  );
  return (
    <div className="pt-overview" aria-hidden>
      {look === "stacked" ? (
        <div className="flex flex-col gap-1 px-3 py-2" style={box}>
          <div className="flex h-[15px] items-center gap-2">
            <span className="num shrink-0 text-[11px] leading-[15px] text-faint uppercase">{pathNumber}</span>
            <span className="flex-1" />
            {marks}
            {turnCount > 0 && <span className="num shrink-0 text-[11px] leading-[15px] text-faint uppercase">{turnLabel}</span>}
          </div>
          <span
            className="text-[13px] leading-[17px] font-medium tracking-[-0.005em] break-words text-fg"
            style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}
          >
            {title}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3" style={box}>
          <span className="num shrink-0 text-[11px] text-faint uppercase" style={{ lineHeight: `${inlineLine}px` }}>
            {pathNumber}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-medium tracking-[-0.005em] text-fg"
            style={{ fontSize: Math.min(13, inlineLine / 1.3), lineHeight: `${inlineLine}px` }}
          >
            {title}
          </span>
          {marks}
        </div>
      )}
    </div>
  );
});
