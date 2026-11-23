import { GitBranchPlus } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Conversation, Thread } from "../../../shared/api";
import {
  branchFromSameMessage,
  deleteThread,
  mergeIntoParent,
  renameThread,
  selectOpenConversation,
  toggleBranchesView,
  toggleCardView,
  useStore,
} from "../../store";
import { plural } from "../../text";
import * as tree from "../../tree";
import { MenuItem, MoreMenu } from "../Menu";
import { Button, ConfirmDialog, LabelSm, Tip } from "../ui";
import { GenerationPicker, type Generation } from "./Generations";

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

// The fixed top of the Thread tab: for a branch the generation picker (the root shows its path
// label), the editable title with one menu of card actions, and for a branch the button for
// another branch from the same message.
export const ThreadHeader = memo(function ThreadHeader({
  threadId,
  generations,
  inView,
  onChoose,
}: {
  threadId: string;
  generations: Generation[];
  inView: string;
  onChoose: (threadId: string) => void;
}) {
  const facts = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      const thread = conv && tree.findThread(conv, threadId);
      return conv && thread ? headerFacts(conv, thread) : null;
    }),
  );
  if (!facts) return null;
  return (
    <header className="shrink-0 overflow-hidden border-b border-line-soft px-6 pt-3 pb-4 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-[760px]">
        <div className="flex h-[30px] min-w-0 items-center">
          {facts.isRoot ? (
            <span className="label-sm num text-fg" aria-current="page">
              {facts.number}
            </span>
          ) : (
            <GenerationPicker generations={generations} inView={inView} onChoose={onChoose} />
          )}
        </div>
        <TitleRow key={threadId} threadId={threadId} facts={facts} />
        {!facts.isRoot && (
          <Button
            size="sm"
            icon={GitBranchPlus}
            data-testid="sibling-branch"
            tip="Starts another empty card from the same message this one came from."
            className="mt-3"
            onClick={() => branchFromSameMessage(threadId)}
          >
            Another branch from the same message
          </Button>
        )}
      </div>
    </header>
  );
});

// viewing: the title as one line with an ellipsis; a click starts editing.
// editing: an input with the draft; Enter or leaving saves, Escape cancels.
type TitleEdit = { kind: "viewing" } | { kind: "editing"; draft: string };
// The delete confirmation.
type Confirm = "closed" | "open";

function TitleRow({ threadId, facts }: { threadId: string; facts: HeaderFacts }) {
  const title = facts.title;
  const [edit, setEditState] = useState<TitleEdit>({ kind: "viewing" });
  // The same state, readable at once by the blur that follows Enter or Escape (React has not
  // re-rendered yet then): a blur saves only while the editor is still "editing".
  const current = useRef<TitleEdit>(edit);
  const setEdit = (next: TitleEdit) => {
    current.current = next;
    setEditState(next);
  };
  const [confirm, setConfirm] = useState<Confirm>("closed");
  // "Rename" from the menu: the input takes focus once the menu has closed and given focus back.
  const [renameAsked, setRenameAsked] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renameAsked === 0) return;
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [renameAsked]);

  const box = "block h-10 min-w-0 flex-1 rounded-cell border px-2 text-[22px] font-medium tracking-[-0.02em]";
  const startEditing = () => setEdit({ kind: "editing", draft: title });
  // An empty title cancels the rename and keeps the old one.
  const save = (draft: string) => {
    const next = draft.trim();
    if (next !== "" && next !== title.trim()) renameThread(threadId, next);
    setEdit({ kind: "viewing" });
  };
  const folded = facts.cardView === "folded";
  const hidden = facts.branchesView === "hidden";
  const below = facts.below;
  const name = facts.title.trim() || tree.UNTITLED_THREAD;

  return (
    <div className="-ml-2 flex min-w-0 items-center gap-2">
      {edit.kind === "editing" ? (
        <input
          ref={input}
          autoFocus
          value={edit.draft}
          placeholder={tree.UNTITLED_THREAD}
          aria-label="Thread title"
          onChange={(e) => setEdit({ kind: "editing", draft: e.target.value })}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => {
            if (current.current.kind === "editing") save(current.current.draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) save(edit.draft);
            if (e.key === "Escape") setEdit({ kind: "viewing" });
          }}
          className={`${box} border-fg bg-bg leading-[1.2] text-fg outline-none placeholder:text-muted`}
        />
      ) : (
        <Tip content="Click to rename">
          <button
            type="button"
            data-testid="thread-title"
            onClick={startEditing}
            className={`${box} truncate border-transparent text-left leading-[38px] transition-colors hover:bg-surface ${title.trim() === "" ? "text-muted" : "text-fg"}`}
          >
            {name}
          </button>
        </Tip>
      )}
      <MoreMenu label="Card actions" testId="header-menu">
        <MenuItem
          label="Rename"
          description="Gives this card a new title."
          testId="header-rename"
          onSelect={() => {
            startEditing();
            setRenameAsked((n) => n + 1);
          }}
        />
        <MenuItem
          label={folded ? "Expand card" : "Collapse card"}
          description={folded ? "Shows this card's messages on the map again." : "Shows only the title of this card on the map."}
          testId="header-fold"
          onSelect={() => toggleCardView(threadId)}
        />
        <MenuItem
          label={hidden ? "Show branches" : "Hide branches"}
          description={hidden ? "Shows every card that comes from this one again." : "Hides every card that comes from this one."}
          disabledReason={facts.hasBranches ? null : "This card has no branches yet."}
          testId="header-branches"
          onSelect={() => toggleBranchesView(threadId)}
        />
        <MenuItem
          label="Merge into parent"
          description="Puts these messages back into the card they came from."
          disabledReason={facts.merge === null ? null : `${facts.merge}.`}
          testId="header-merge"
          onSelect={() => mergeIntoParent(threadId)}
        />
        <MenuItem
          label="Delete branch"
          description="Deletes this card, the cards that come from it, and their clips."
          disabledReason={facts.isRoot ? "The first card of a conversation cannot be deleted." : null}
          tone="danger"
          testId="header-delete"
          onSelect={() => setConfirm("open")}
        />
      </MoreMenu>
      <ConfirmDialog
        open={confirm === "open"}
        onOpenChange={(open) => setConfirm(open ? "open" : "closed")}
        title="Delete this card?"
        body={
          <>
            <LabelSm className="num mr-2 text-fg">{facts.number}</LabelSm>
            {below > 0 ? `"${name}", the ${plural(below, "card")} below it, and their clips will be deleted.` : `"${name}" and its clips will be deleted.`}
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => deleteThread(threadId)}
      />
    </div>
  );
}
