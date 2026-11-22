import { ChevronsDownUp, ChevronsUpDown, Maximize, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  renameConversation,
  requestFit,
  selectOpenConversation,
  selectOpenSaveState,
  setAllCardViews,
  toggleSidebar,
  useStore,
  type SaveState,
} from "../store";
import { plural } from "../text";
import * as tree from "../tree";
import { serverMode, type ServerMode } from "./serverMode";
import { useSidebarDisplay } from "./Sidebar";
import { IconButton, Label, LabelSm, Tag, Tip } from "./ui";

// How much the bar shows, from roomiest to tightest. It is chosen from the bar's measured width,
// because that depends on the sidebar and the panel, not on the window.
// full:      title, counts, mode tag, save state
// no-counts: the counts label is dropped
// short-tag: the mode tag shrinks to its dot and one word (the full text is in its tooltip)
// save-dot:  the save state shrinks to a colored dot with a tooltip
// no-tag:    the mode tag is dropped (only when the title would get narrower than 120px)
// bare:      the save dot is dropped too
// The sidebar toggle and the three view buttons are always shown.
type BarFit = "full" | "no-counts" | "short-tag" | "save-dot" | "no-tag" | "bare";
const FITS: BarFit[] = ["full", "no-counts", "short-tag", "save-dot", "no-tag", "bare"];

const TITLE_MIN = 120;
const GAP = 8; // gap-2
const PAD = 8 + 12; // pl-2, pr-3
const TOGGLE = 28;
const SPACER_MIN = 16;
const SAVE_DOT = 6;

export function TopBar() {
  const sidebar = useSidebarDisplay();
  // Narrow slices: the bar must not redraw while answer text streams in.
  const convId = useStore((s) => s.openId);
  const hasConv = useStore((s) => selectOpenConversation(s) !== undefined);
  const blank = useStore((s) => {
    const conv = selectOpenConversation(s);
    return conv ? tree.isBlank(conv) : true;
  });
  const title = useStore((s) => {
    const conv = selectOpenConversation(s);
    return conv ? tree.conversationTitle(conv) : "";
  });
  const rawTitle = useStore((s) => selectOpenConversation(s)?.title ?? "");
  const counts = useStore((s) => {
    const conv = selectOpenConversation(s);
    return conv ? `${plural(conv.threads.length, "thread")} · ${plural(tree.turnCount(conv), "turn")}` : "";
  });
  const mode = useMode();
  const save = useStore(selectOpenSaveState);
  const noTree = !hasConv ? "No conversation is open" : blank ? "Ask a first question to start the tree" : null;
  const showTree = hasConv && !blank;

  const barRef = useRef<HTMLElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<BarFit>("full");
  const chooseFit = useRef(() => {});
  chooseFit.current = () => {
    const bar = barRef.current;
    const sizer = sizerRef.current;
    const right = rightRef.current;
    if (!bar || !sizer || !right) return;
    const width = (name: string) => sizer.querySelector<HTMLElement>(`[data-size="${name}"]`)?.offsetWidth ?? 0;
    const need = (f: BarFit) => {
      const level = FITS.indexOf(f);
      const items = [TOGGLE, TITLE_MIN, SPACER_MIN, right.offsetWidth];
      if (showTree && level < 1) items.push(width("counts"));
      if (mode && level < 4) items.push(width(level < 2 ? "tag-full" : "tag-short"));
      if (showTree && level < 3) items.push(width("save"));
      else if (showTree && level < 5) items.push(SAVE_DOT);
      return PAD + items.reduce((a, b) => a + b, 0) + GAP * (items.length - 1);
    };
    const available = bar.clientWidth;
    const next = FITS.find((f) => need(f) <= available) ?? "bare";
    setFit((prev) => (prev === next ? prev : next));
  };
  useLayoutEffect(() => chooseFit.current());
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => chooseFit.current());
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const level = FITS.indexOf(fit);

  return (
    <header ref={barRef} data-fit={fit} className="relative flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg pr-3 pl-2">
      <IconButton
        icon={sidebar === "shown" ? PanelLeftClose : PanelLeftOpen}
        label={sidebar === "shown" ? "Hide sidebar" : "Show sidebar"}
        disabledReason={sidebar === "no-room" ? "No room for the sidebar: make the window wider or the panel narrower" : null}
        onClick={toggleSidebar}
      />
      {showTree && convId ? (
        <>
          <TitleEditor key={convId} title={title} rawTitle={rawTitle} />
          {level < 1 && (
            <span data-testid="topbar-counts" className="inline-flex shrink-0">
              <Label className="whitespace-nowrap">
                <span className="num">{counts}</span>
              </Label>
            </span>
          )}
        </>
      ) : (
        <span className="min-w-0 truncate px-2 text-[14px] font-medium tracking-[-0.005em] text-muted">{title}</span>
      )}
      <div className="min-w-4 flex-1" />
      {mode && level < 4 && <ModeTag mode={mode} short={level >= 2} />}
      {showTree && level < 5 && <SaveState save={save} dot={level >= 3} />}
      <div ref={rightRef} className="flex shrink-0 items-center gap-2">
        <span className="mx-1 h-4 w-px shrink-0 bg-line-soft" aria-hidden />
        <IconButton icon={ChevronsDownUp} label="Fold all cards" disabledReason={noTree} onClick={() => setAllCardViews("folded")} />
        <IconButton icon={ChevronsUpDown} label="Open all cards" disabledReason={noTree} onClick={() => setAllCardViews("open")} />
        <IconButton icon={Maximize} label="Fit view" disabledReason={noTree} onClick={requestFit} />
      </div>
      {/* Invisible copies of the parts that can shrink, so their full widths can be measured. */}
      <div ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex w-0 items-start gap-2 overflow-hidden">
        <span data-size="counts" className="inline-flex shrink-0">
          <Label className="whitespace-nowrap">
            <span className="num">{counts}</span>
          </Label>
        </span>
        {mode && (
          <>
            <span data-size="tag-full" className="inline-flex shrink-0">
              <Tag dot={mode.dot === "bg-fail" ? "fail" : "accent"}>{mode.tag}</Tag>
            </span>
            <span data-size="tag-short" className="inline-flex shrink-0">
              <Tag dot={mode.dot === "bg-fail" ? "fail" : "accent"}>{mode.short}</Tag>
            </span>
          </>
        )}
        <span data-size="save" className="inline-flex shrink-0">
          <LabelSm className="whitespace-nowrap">{SAVE_LABEL[save.kind]}</LabelSm>
        </span>
      </div>
    </header>
  );
}

// viewing: the title is shown as a button.
// editing: the title is an input holding the draft.
// Leaving editing is one of two named steps: save (Enter, or the field losing focus) renames when
// the draft is not empty and differs; cancel (Escape) never renames. Once the editor is back in
// viewing, a late blur from the removed input finds nothing to save.
type TitleMode = { kind: "viewing" } | { kind: "editing"; draft: string };
const VIEWING: TitleMode = { kind: "viewing" };

function TitleEditor({ title, rawTitle }: { title: string; rawTitle: string }) {
  const [mode, setModeState] = useState<TitleMode>(VIEWING);
  // The same state, readable at once by the event that follows a change (the blur after Escape).
  const current = useRef<TitleMode>(VIEWING);
  const setMode = (next: TitleMode) => {
    current.current = next;
    setModeState(next);
  };
  const startEditing = () => setMode({ kind: "editing", draft: rawTitle });
  const save = () => {
    const m = current.current;
    if (m.kind !== "editing") return;
    setMode(VIEWING);
    const draft = m.draft.trim();
    if (draft !== "" && draft !== rawTitle.trim()) renameConversation(draft);
  };
  const cancel = () => {
    if (current.current.kind === "editing") setMode(VIEWING);
  };

  if (mode.kind === "viewing") {
    return (
      <Tip content="Rename">
        <button
          type="button"
          className="h-8 min-w-[120px] shrink truncate rounded-cell px-2 text-left text-[14px] font-medium tracking-[-0.005em] transition-colors hover:bg-surface"
          onClick={startEditing}
        >
          {title}
        </button>
      </Tip>
    );
  }
  return (
    <input
      autoFocus
      aria-label="Conversation title"
      value={mode.draft}
      onChange={(e) => setMode({ kind: "editing", draft: e.target.value })}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") cancel();
      }}
      className="h-8 w-[min(480px,100%)] min-w-[120px] shrink rounded-cell border border-fg bg-bg px-2 text-[14px] font-medium tracking-[-0.005em] outline-none"
    />
  );
}

const SAVE_LABEL: Record<SaveState["kind"], string> = { saved: "Saved", saving: "Saving", failed: "Not saved", conflict: "Conflict" };
const SAVE_TIP: Record<SaveState["kind"], string> = {
  saved: "Saved",
  saving: "Saving",
  failed: "Not saved. The last save failed; it is tried again.",
  conflict: "Not saved. Another tab or window changed this conversation; choose a version above the canvas.",
};
const SAVE_DOT_COLOR: Record<SaveState["kind"], string> = { saved: "bg-pass", saving: "bg-faint", failed: "bg-fail", conflict: "bg-fail" };

// The save state as a label, or (when the bar is narrow) as a colored dot with a tooltip.
function SaveState({ save, dot }: { save: SaveState; dot: boolean }) {
  if (dot) {
    return (
      <Tip content={SAVE_TIP[save.kind]}>
        <span tabIndex={0} aria-label={SAVE_LABEL[save.kind]} data-testid="topbar-save" className="inline-flex shrink-0 rounded-cell p-0">
          <span className={`dot ${SAVE_DOT_COLOR[save.kind]}`} aria-hidden />
        </span>
      </Tip>
    );
  }
  const label = (
    <LabelSm className={`shrink-0 whitespace-nowrap ${save.kind === "failed" || save.kind === "conflict" ? "text-fail" : ""}`}>{SAVE_LABEL[save.kind]}</LabelSm>
  );
  if (save.kind !== "failed" && save.kind !== "conflict") return <span data-testid="topbar-save" className="inline-flex shrink-0">{label}</span>;
  return (
    <Tip content={SAVE_TIP[save.kind]}>
      <span tabIndex={0} data-testid="topbar-save" className="inline-flex shrink-0 rounded-cell">
        {label}
      </span>
    </Tip>
  );
}

// The server mode as a tag (demo, no key, offline), from the table in serverMode.ts. Null when the
// model is live or the mode is not known yet.
function useMode(): ServerMode | null {
  const health = useStore((s) => s.health);
  const mode = serverMode(health);
  return mode.tag === "" ? null : mode;
}

function ModeTag({ mode, short }: { mode: ServerMode; short: boolean }) {
  return (
    <Tip content={mode.tip}>
      <span tabIndex={0} data-testid="topbar-mode" className="inline-flex shrink-0 rounded-cell">
        <Tag dot={mode.dot === "bg-fail" ? "fail" : "accent"}>{short ? mode.short : mode.tag}</Tag>
      </span>
    </Tip>
  );
}
