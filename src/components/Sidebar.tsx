import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { memo, useEffect, useState, useSyncExternalStore } from "react";
import {
  deleteConversation,
  newConversation,
  openConversation,
  reloadList,
  selectIsLive,
  selectOpenConversation,
  useStore,
} from "../store";
import { relativeTime } from "../text";
import * as tree from "../tree";
import { Button, ConfirmDialog, IconButton, Label, LabelSm, LiveDot, Skeleton, Tip } from "./ui";

// closed keeps the last title, so the dialog can fade out with its text still in it.
type DeleteAsk = { kind: "closed"; title: string } | { kind: "asking"; id: string; title: string };

const SIDEBAR_WIDTH = 248;
// The canvas column never gets narrower than this because of the sidebar.
const MAIN_MIN_WIDTH = 400;

// How the sidebar is drawn.
// shown:     the user wants it and there is room.
// collapsed: the user collapsed it.
// no-room:   the user wants it, but with it the canvas column would be narrower than MAIN_MIN_WIDTH
//            (a narrow window with a wide panel). It is drawn collapsed until there is room again;
//            the user's choice is kept.
export type SidebarDisplay = "shown" | "collapsed" | "no-room";

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useSidebarDisplay(): SidebarDisplay {
  const view = useStore((s) => s.sidebar);
  const windowWidth = useSyncExternalStore(subscribeResize, () => window.innerWidth);
  const panelWidth = useStore((s) => s.panelWidth);
  // The right panel is hidden only while a blank conversation shows its start box (see RightPanel).
  const panelHidden = useStore((s) => {
    const conv = selectOpenConversation(s);
    return conv !== undefined && tree.isBlank(conv);
  });
  const room = windowWidth - SIDEBAR_WIDTH - (panelHidden ? 0 : panelWidth) >= MAIN_MIN_WIDTH;
  if (view === "collapsed") return "collapsed";
  return room ? "shown" : "no-room";
}

export function Sidebar() {
  const view = useSidebarDisplay();
  const [ask, setAsk] = useState<DeleteAsk>({ kind: "closed", title: "" });

  return (
    <aside
      aria-label="Conversations"
      inert={view !== "shown"}
      className={`shrink-0 overflow-hidden transition-[width] duration-250 ease-out-expo ${view === "shown" ? "w-[248px]" : "w-0"}`}
    >
      <div className="flex h-full w-[248px] flex-col border-r border-line bg-bg">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <TreeMark />
          <span className="text-[15px] font-medium tracking-[-0.01em]">prompt-tree</span>
        </div>
        <div className="shrink-0 p-4">
          <Button variant="primary" icon={Plus} keyHint="Alt+N" className="w-full" data-focus-target="new-conversation" onClick={newConversation}>
            New conversation
          </Button>
        </div>
        <div className="shrink-0 px-4 pb-2">
          <Label>Conversations</Label>
        </div>
        <ConversationList
          onAskDelete={(id, title) => setAsk({ kind: "asking", id, title })}
        />
      </div>
      <ConfirmDialog
        open={ask.kind === "asking"}
        onOpenChange={(open) => {
          if (!open) setAsk((a) => ({ kind: "closed", title: a.title }));
        }}
        title="Delete this conversation?"
        body={
          <>
            <span className="text-fg">{ask.title}</span> and every branch and clip in it
            will be deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        focusFallback="new-conversation"
        onConfirm={() => {
          if (ask.kind === "asking") void deleteConversation(ask.id);
        }}
      />
    </aside>
  );
}

// The prompt-tree mark: one dot on the left, right-angled lines to three dots, the middle one orange.
function TreeMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className="shrink-0">
      <path d="M3 9h6M9 3.75v10.5M9 3.75h6M9 9h6M9 14.25h6" className="stroke-fg" strokeWidth="1.5" />
      <circle cx="3" cy="9" r="2" className="fill-fg" />
      <circle cx="15" cy="3.75" r="2" className="fill-fg" />
      <circle cx="15" cy="9" r="2" className="fill-accent" />
      <circle cx="15" cy="14.25" r="2" className="fill-fg" />
    </svg>
  );
}

function ConversationList({ onAskDelete }: { onAskDelete: (id: string, title: string) => void }) {
  const list = useStore((s) => s.list);
  const listState = useStore((s) => s.listState);
  const openId = useStore((s) => s.openId);
  // Plain values only, so streamed text does not redraw the list.
  // A new conversation is listed once it is saved; until then it shows as an unsaved row on top.
  const unsavedTitle = useStore((s) => {
    const open = selectOpenConversation(s);
    return open && !s.list.some((c) => c.id === open.id) ? tree.conversationTitle(open) : null;
  });
  const now = useNow();

  if (listState.kind === "loading" && list.length === 0) {
    return (
      <div className="min-h-0 flex-1 border-t border-line-soft" aria-busy="true" aria-label="Loading conversations">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2 border-b border-line-soft px-4 py-3">
            <Skeleton className={`h-3 ${i % 2 === 0 ? "w-40" : "w-32"}`} />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto border-t border-line-soft">
      {listState.kind === "failed" && (
        <div className="border-b border-line-soft px-4 py-3">
          <LabelSm className="text-fail">Could not load the list</LabelSm>
          <p className="mt-1 text-[13px] leading-[1.45] text-muted">{listState.reason}</p>
          <Button size="sm" icon={RotateCcw} className="mt-2" onClick={() => void reloadList()}>
            Retry
          </Button>
        </div>
      )}
      {unsavedTitle !== null && openId !== null && <Row id={openId} title={unsavedTitle} meta="Not saved yet" active onOpen={NOOP} />}
      {list.map((c) => (
        <ListedRow key={c.id} summary={c} active={c.id === openId} now={now} onAskDelete={onAskDelete} />
      ))}
      {listState.kind === "ready" && list.length === 0 && unsavedTitle === null && (
        <p className="px-4 py-3 text-[13px] text-muted">Nothing saved yet.</p>
      )}
    </nav>
  );
}

const NOOP = () => undefined;

const ListedRow = memo(function ListedRow({
  summary,
  active,
  now,
  onAskDelete,
}: {
  summary: { id: string; title: string; updatedAt: number };
  active: boolean;
  now: number;
  onAskDelete: (id: string, title: string) => void;
}) {
  // A loaded conversation shows its current title, so a rename shows here at once.
  const title = useStore((s) => tree.conversationTitle(s.conversations[summary.id] ?? summary));
  const live = useStore(selectIsLive(summary.id));
  // A plain string, so the row does not redraw while text streams.
  const saveKind = useStore((s) => s.saveStates[summary.id]?.kind ?? "saved");
  const alert: RowAlert = saveKind === "conflict" ? "conflict" : saveKind === "failed" ? "not-saved" : "none";
  return (
    <Row
      id={summary.id}
      title={title}
      meta={relativeTime(summary.updatedAt, now)}
      alert={alert}
      live={live}
      active={active}
      onOpen={() => void openConversation(summary.id)}
      onDelete={() => onAskDelete(summary.id, title)}
    />
  );
});

// What a row says in place of its time when the conversation could not be saved.
// none:      the time is shown.
// conflict:  another tab saved a newer version (or deleted it); the user must choose.
// not-saved: a save failed for another reason; it is retried.
type RowAlert = "none" | "conflict" | "not-saved";
const ALERT_LABEL: Record<Exclude<RowAlert, "none">, string> = { conflict: "Conflict", "not-saved": "Not saved" };
const ALERT_TIP: Record<Exclude<RowAlert, "none">, string> = {
  conflict: "Changed in another tab. Open it to choose a version.",
  "not-saved": "The last save failed. It is tried again every 5 seconds.",
};

const Row = memo(function Row({
  id,
  title,
  meta,
  alert = "none",
  live = false,
  active,
  onOpen,
  onDelete,
}: {
  id: string;
  title: string;
  meta: string;
  alert?: RowAlert;
  live?: boolean;
  active: boolean;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      data-conversation-id={id}
      className={`group relative flex items-center border-b border-line-soft transition-colors ${active ? "bg-surface" : "hover:bg-surface"}`}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-fg" aria-hidden />}
      <Tip content={alert === "none" ? null : ALERT_TIP[alert]}>
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          className="min-w-0 flex-1 py-2.5 pr-2 pl-4 text-left outline-offset-[-2px]"
          onClick={onOpen}
        >
          <span className="block truncate text-[13.5px] leading-[1.3] font-medium tracking-[-0.005em]">{title}</span>
          {alert === "none" ? (
            <span className="label-sm mt-1 flex items-center gap-2">
              {live && <LiveDot />}
              {meta}
            </span>
          ) : (
            <span className="label-sm mt-1 flex items-center gap-2 text-fail" data-testid="row-alert">
              <span className="dot bg-fail" aria-hidden />
              {ALERT_LABEL[alert]}
            </span>
          )}
        </button>
      </Tip>
      {onDelete && (
        <IconButton
          icon={Trash2}
          label="Delete conversation"
          tone="danger"
          className="mr-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onDelete}
        />
      )}
    </div>
  );
});

// Re-render once a minute so relative times stay fresh.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  const list = useStore((s) => s.list);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [list]);
  return now;
}
