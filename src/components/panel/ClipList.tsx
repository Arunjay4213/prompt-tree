import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { Clip, Conversation } from "../../../shared/api";
import { moveClipTo, removeClip, requestView, selectThread } from "../../store";
import { Markdown } from "../Markdown";
import * as tree from "../../tree";
import { ICON, IconButton, Tag, Tip } from "../ui";

// Dragged cells move up and down only.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// The clips in output order, as bordered cells. Reorder by dragging the handle (mouse or keyboard:
// focus the handle, Space to pick up, arrows to move, Space to drop) or with the Move buttons.
export function ClipList({ conv }: { conv: Conversation }) {
  const numbers = tree.pathNumbers(conv);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = conv.clips.findIndex((c) => c.id === over.id);
    if (to >= 0) moveClipTo(String(active.id), to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]} onDragEnd={onDragEnd}>
      <SortableContext items={conv.clips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ol className="border-y border-line">
          {conv.clips.map((clip, i) => (
            <ClipCell key={clip.id} conv={conv} clip={clip} index={i} count={conv.clips.length} pathNumber={numbers[clip.threadId] ?? ""} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

// Four lines of 13.5px text at line height 1.5.
const CLAMP_HEIGHT = 81;

// clamped: the text shows at most four lines. expanded: all of it.
type ClipView = "clamped" | "expanded";
// Whether the clamped text is longer than four lines (then SHOW MORE is offered).
type ClipOverflow = "fits" | "overflows";

function ClipCell({ conv, clip, index, count, pathNumber }: { conv: Conversation; clip: Clip; index: number; count: number; pathNumber: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });
  const [view, setView] = useState<ClipView>("clamped");
  const [overflow, setOverflow] = useState<ClipOverflow>("fits");
  const textRef = useRef<HTMLDivElement>(null);
  const thread = tree.findThread(conv, clip.threadId);
  const text = tree.clipText(conv, clip).trim();

  // Clamped: the clip shows the whole blocks (paragraphs, lists, code blocks) that fit in four
  // lines, so nothing is cut through the middle; a single taller first block shows four lines.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (view === "expanded") {
      el.style.maxHeight = "";
      return;
    }
    const measure = () => {
      const md = el.querySelector<HTMLElement>(".markdown");
      let cut = 0;
      for (const child of md?.children ?? []) {
        const block = child as HTMLElement;
        const bottom = block.offsetTop - (md?.offsetTop ?? 0) + block.offsetHeight;
        if (bottom > CLAMP_HEIGHT) break;
        cut = bottom;
      }
      const height = cut > 0 ? cut : CLAMP_HEIGHT;
      el.style.maxHeight = `${height}px`;
      setOverflow((md?.scrollHeight ?? el.scrollHeight) > height + 1 ? "overflows" : "fits");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [view, text]);

  const reveal = () => {
    selectThread(clip.threadId);
    requestView(clip.threadId, "reveal");
  };

  return (
    <li
      ref={setNodeRef}
      data-testid={`clip-${clip.id}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative flex gap-2 border-b border-line-soft bg-bg py-3 last:border-b-0 ${
        isDragging
          ? "z-10 before:pointer-events-none before:absolute before:-inset-x-2 before:inset-y-0 before:-z-10 before:rounded-cell before:border before:border-fg before:bg-bg"
          : ""
      }`}
    >
      <div className="flex h-7 shrink-0 items-center gap-1">
        <Tip content="Drag to reorder">
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Reorder clip ${index + 1}`}
            className={`-ml-1 flex h-7 w-5 items-center justify-center rounded-cell text-faint transition-colors hover:text-fg ${isDragging ? "cursor-grabbing text-fg" : "cursor-grab"}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical {...ICON} />
          </button>
        </Tip>
        <span className="label-sm num w-6 text-fg">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex h-7 items-center gap-2">
          <Tip content="Show this card on the canvas">
            <button type="button" onClick={reveal} className="label-sm flex min-w-0 items-center gap-2 text-left transition-colors hover:text-fg">
              <span className="num shrink-0 text-fg">{pathNumber}</span>
              <span className="min-w-0 truncate">{thread ? tree.threadTitle(thread) : "Unknown branch"}</span>
            </button>
          </Tip>
          {clip.kind === "excerpt" && <Tag>Excerpt</Tag>}
          <span className="flex-1" />
          <span className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <IconButton icon={ArrowUp} label="Move up" disabledReason={index === 0 ? "Already first" : null} onClick={() => moveClipTo(clip.id, index - 1)} />
            <IconButton icon={ArrowDown} label="Move down" disabledReason={index === count - 1 ? "Already last" : null} onClick={() => moveClipTo(clip.id, index + 1)} />
            <IconButton icon={X} label="Remove from output" tone="danger" onClick={() => removeClip(clip.id)} />
          </span>
        </div>
        {/* The clip as markdown (a clipped code block looks like code). Clamped: four lines high. */}
        <div ref={textRef} data-testid="clip-text" className={`clip-markdown mt-1 ${view === "clamped" ? "overflow-hidden" : ""}`}>
          {text ? <Markdown text={text} /> : <p className="text-[13.5px] leading-[1.5] text-faint">The answer is empty.</p>}
        </div>
        {(overflow === "overflows" || view === "expanded") && (
          <button type="button" className="label-sm mt-2 transition-colors hover:text-fg" onClick={() => setView(view === "clamped" ? "expanded" : "clamped")}>
            {view === "clamped" ? "Show more" : "Show less"}
          </button>
        )}
      </div>
    </li>
  );
}
