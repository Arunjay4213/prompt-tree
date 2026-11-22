import { ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, Merge, Trash2 } from "lucide-react";
import { Fragment, memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Conversation, Thread } from "../../../shared/api";
import { deleteThread, goToThread, mergeIntoParent, renameThread, selectOpenConversation, toggleBranchesView, toggleCardView, useStore } from "../../store";
import { plural } from "../../text";
import * as tree from "../../tree";
import { Button, ConfirmDialog, LabelSm, Tip } from "../ui";

// What the header shows, as plain values, so streamed answer text never re-renders it.
type HeaderFacts = {
  title: string; // as stored; "" for an untitled branch
  number: string; // path number
  cardView: Thread["cardView"];
  branchesView: Thread["branchesView"];
  isRoot: boolean;
  hasBranches: boolean;
  merge: string | null; // null: allowed; otherwise why not
  below: number; // cards below this one
};

function headerFacts(conv: Conversation, thread: Thread): HeaderFacts {
  const merge = tree.mergeAllowed(conv, thread.id);
  return {
    title: thread.title,
    number: tree.pathNumbers(conv)[thread.id] ?? "",
    cardView: thread.cardView,
    branchesView: thread.branchesView,
    isRoot: thread.parent === null,
    hasBranches: tree.childThreads(conv, thread.id).length > 0,
    merge: merge.ok ? null : merge.reason,
    below: tree.subtreeIds(conv, thread.id).size - 1,
  };
}

const NONE: never[] = [];

type State = Parameters<typeof selectOpenConversation>[0];

// The ancestors of a thread (root first), one plain list per field.
function ancestorField(s: State, threadId: string, field: (t: Thread, numbers: Record<string, string>) => string): string[] {
  const conv = selectOpenConversation(s);
  if (!conv) return NONE;
  const numbers = tree.pathNumbers(conv);
  return tree.ancestorPath(conv, threadId).slice(0, -1).map((t) => field(t, numbers));
}

// The fixed top of the Thread tab: breadcrumb, editable title, and the card actions.
export const ThreadHeader = memo(function ThreadHeader({ threadId }: { threadId: string }) {
  const facts = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      const thread = conv && tree.findThread(conv, threadId);
      return conv && thread ? headerFacts(conv, thread) : null;
    }),
  );
  const ids = useStore(useShallow((s) => ancestorField(s, threadId, (t) => t.id)));
  const numbers = useStore(useShallow((s) => ancestorField(s, threadId, (t, n) => n[t.id] ?? "")));
  const titles = useStore(useShallow((s) => ancestorField(s, threadId, (t) => tree.threadTitle(t))));
  if (!facts) return null;
  const crumbs = ids.map((id, i) => ({ id, number: numbers[i] ?? "", title: titles[i] ?? "" }));
  return (
    <header className="shrink-0 overflow-hidden border-b border-line-soft px-6 pt-4 pb-4 [scrollbar-gutter:stable]">
      <Breadcrumb crumbs={crumbs} number={facts.number} />
      <ThreadTitle key={threadId} threadId={threadId} title={facts.title} />
      <Actions threadId={threadId} facts={facts} />
    </header>
  );
});

type Crumb = { id: string; number: string; title: string };

const CRUMB_CHARS = 18;

function shortTitle(title: string): string {
  return title.length > CRUMB_CHARS ? `${title.slice(0, CRUMB_CHARS - 1).trimEnd()}…` : title;
}

// ROOT / 1 PRICING / 1.2 - each ancestor is a link. A deep path keeps the root and the two nearest
// ancestors and shows the ones between as "…". The row never wraps; items truncate if they must.
function Breadcrumb({ crumbs, number }: { crumbs: Crumb[]; number: string }) {
  const [root, ...middle] = crumbs;
  const skipped = middle.length > 2 ? middle.slice(0, -2) : [];
  const near = middle.length > 2 ? middle.slice(-2) : middle;
  const separator = <span className="label-sm shrink-0 text-line">/</span>;

  return (
    <nav aria-label="Path to the root" className="flex h-5 min-w-0 items-center gap-2 overflow-hidden">
      {root && (
        <>
          <button type="button" className="label-sm num shrink-0 transition-colors hover:text-fg" onClick={() => goToThread(root.id)}>
            ROOT
          </button>
          {separator}
        </>
      )}
      {skipped.length > 0 && (
        <>
          <Tip content={skipped.map((c) => `${c.number} ${c.title}`).join(" / ")}>
            <span tabIndex={0} className="label-sm shrink-0 outline-none">
              …
            </span>
          </Tip>
          {separator}
        </>
      )}
      {near.map((c) => (
        <Fragment key={c.id}>
          <button
            type="button"
            className="label-sm flex min-w-0 items-center gap-2 transition-colors hover:text-fg"
            onClick={() => goToThread(c.id)}
          >
            <span className="num shrink-0">{c.number}</span>
            <span className="min-w-0 truncate">{shortTitle(c.title)}</span>
          </button>
          {separator}
        </Fragment>
      ))}
      <span className="label-sm num shrink-0 text-fg" aria-current="page">
        {number}
      </span>
    </nav>
  );
}

// viewing: the title as one line with an ellipsis; a click starts editing.
// editing: an input with the draft; Enter or leaving saves, Escape cancels.
type TitleEdit = { kind: "viewing" } | { kind: "editing"; draft: string };

function ThreadTitle({ threadId, title }: { threadId: string; title: string }) {
  const [edit, setEdit] = useState<TitleEdit>({ kind: "viewing" });
  const box = "mt-2 -mx-2 block h-9 w-[calc(100%+16px)] rounded-cell border px-2 text-[22px] font-medium tracking-[-0.02em]";
  const startEditing = () => setEdit({ kind: "editing", draft: title });
  // An empty title cancels the rename and keeps the old one.
  const save = (draft: string) => {
    const next = draft.trim();
    if (next !== "" && next !== title.trim()) renameThread(threadId, next);
    setEdit({ kind: "viewing" });
  };

  if (edit.kind === "editing") {
    return (
      <input
        autoFocus
        value={edit.draft}
        placeholder={tree.UNTITLED_THREAD}
        aria-label="Thread title"
        onChange={(e) => setEdit({ kind: "editing", draft: e.target.value })}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => save(edit.draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) save(edit.draft);
          if (e.key === "Escape") setEdit({ kind: "viewing" });
        }}
        className={`${box} border-fg bg-bg leading-[1.2] text-fg outline-none placeholder:text-faint`}
      />
    );
  }
  const untitled = title.trim() === "";
  return (
    <Tip content="Rename">
      <button
        type="button"
        data-testid="thread-title"
        onClick={startEditing}
        className={`${box} truncate border-transparent text-left leading-[34px] transition-colors hover:bg-surface ${untitled ? "text-faint" : "text-fg"}`}
      >
        {untitled ? tree.UNTITLED_THREAD : title}
      </button>
    </Tip>
  );
}

// Container widths (the header without its padding) where the action labels give way to icons:
// below WIDE, Fold and Delete become icon buttons; below NARROW, all four do.
// Tailwind needs the literal class names, so the widths are written into them.
const ICON_BELOW_WIDE = "@max-[447px]:w-7 @max-[447px]:px-0";
const TEXT_FROM_WIDE = "hidden @min-[448px]:inline";
const ICON_BELOW_NARROW = "@max-[339px]:w-7 @max-[339px]:px-0";
const TEXT_FROM_NARROW = "hidden @min-[340px]:inline";

function Actions({ threadId, facts }: { threadId: string; facts: HeaderFacts }) {
  const [confirm, setConfirm] = useState<"closed" | "open">("closed");
  const folded = facts.cardView === "folded";
  const hidden = facts.branchesView === "hidden";
  const below = facts.below;
  const foldName = folded ? "Open" : "Fold";
  const branchesName = hidden ? "Show branches" : "Hide branches";

  return (
    <div className="@container mt-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          icon={folded ? ChevronsUpDown : ChevronsDownUp}
          aria-label={foldName}
          tip={folded ? "Open this card on the canvas" : "Fold this card to one line on the canvas"}
          className={ICON_BELOW_WIDE}
          onClick={() => toggleCardView(threadId)}
        >
          <span className={TEXT_FROM_WIDE}>{foldName}</span>
        </Button>
        <Button
          size="sm"
          icon={hidden ? Eye : EyeOff}
          aria-label={branchesName}
          tip={hidden ? "Show the cards below this one" : "Hide the cards below this one"}
          disabledReason={facts.hasBranches ? null : "This card has no branches"}
          className={ICON_BELOW_NARROW}
          onClick={() => toggleBranchesView(threadId)}
        >
          <span className={TEXT_FROM_NARROW}>{branchesName}</span>
        </Button>
        <Button
          size="sm"
          icon={Merge}
          aria-label="Merge into parent"
          tip="Append these turns to the parent card"
          disabledReason={facts.merge}
          className={ICON_BELOW_NARROW}
          onClick={() => mergeIntoParent(threadId)}
        >
          <span className={TEXT_FROM_NARROW}>Merge into parent</span>
        </Button>
        <Button
          variant="danger"
          size="sm"
          icon={Trash2}
          aria-label="Delete card"
          tip="Delete this card and the cards below it"
          disabledReason={facts.isRoot ? "The root card cannot be deleted" : null}
          className={`ml-auto ${ICON_BELOW_WIDE}`}
          onClick={() => setConfirm("open")}
        >
          <span className={TEXT_FROM_WIDE}>Delete</span>
        </Button>
      </div>
      <ConfirmDialog
        open={confirm === "open"}
        onOpenChange={(open) => setConfirm(open ? "open" : "closed")}
        title="Delete this card?"
        body={
          <>
            <LabelSm className="num mr-2 text-fg">{facts.number}</LabelSm>
            {`"${facts.title.trim() || tree.UNTITLED_THREAD}"${below > 0 ? ` and the ${plural(below, "card")} below it` : ""} will be deleted, with their clips.`}
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => deleteThread(threadId)}
      />
    </div>
  );
}
