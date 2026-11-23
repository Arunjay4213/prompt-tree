import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Thread, Turn } from "../../../shared/api";
import { goToThread, selectOpenConversation, useStore } from "../../store";
import { plural } from "../../text";
import * as tree from "../../tree";
import { MENU_CONTENT } from "../Menu";
import { ICON, Tip } from "../ui";
import { TurnView } from "./TurnView";

// One thread on the path of the open thread, as plain values. The last one is the open thread.
export type Generation = { id: string; number: string; title: string; count: number };

type State = Parameters<typeof selectOpenConversation>[0];
const NONE: never[] = [];

function generationField<T>(s: State, threadId: string, field: (g: { thread: Thread; turns: Turn[] }, numbers: Record<string, string>) => T): T[] {
  const conv = selectOpenConversation(s);
  if (!conv) return NONE;
  const numbers = tree.pathNumbers(conv);
  return tree.generations(conv, threadId).map((g) => field(g, numbers));
}

// The generations of a thread, root first. One plain list per field, so streamed answer text
// never changes the result; the array keeps its identity until a field changes.
export function useGenerations(threadId: string): Generation[] {
  const ids = useStore(useShallow((s) => generationField(s, threadId, (g) => g.thread.id)));
  const numbers = useStore(useShallow((s) => generationField(s, threadId, (g, n) => n[g.thread.id] ?? "")));
  const titles = useStore(useShallow((s) => generationField(s, threadId, (g) => tree.threadTitle(g.thread))));
  const counts = useStore(useShallow((s) => generationField(s, threadId, (g) => g.turns.length)));
  return useMemo(
    () => ids.map((id, i) => ({ id, number: numbers[i] ?? "", title: titles[i] ?? "", count: counts[i] ?? 0 })),
    [ids, numbers, titles, counts],
  );
}

// The row that starts a generation in the body. "ancestor" offers to open that card;
// "current" is the open branch itself.
export function GenerationHeader({ generation, kind }: { generation: Generation; kind: "ancestor" | "current" }) {
  return (
    <div data-testid="generation-header" className="flex h-12 min-w-0 items-center gap-3">
      <span className="label-sm num shrink-0 text-fg">{generation.number}</span>
      <span className="min-w-0 truncate text-[13.5px] font-medium text-fg">{generation.title}</span>
      {kind === "current" && <span className="shrink-0 text-[13px] text-muted">This branch</span>}
      <span className="shrink-0 text-[13px] text-muted">{plural(generation.count, "message")}</span>
      <span className="flex-1" />
      {kind === "ancestor" && (
        <button
          type="button"
          data-testid="generation-open"
          onClick={() => goToThread(generation.id)}
          className="-mr-2 flex h-[30px] shrink-0 items-center rounded-cell px-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface hover:text-fg"
        >
          Open card
        </button>
      )}
    </div>
  );
}

// Every ancestor generation in full: its header, then each of its messages as an "earlier" turn.
// Subscribes to its own data, so a streaming answer in the open branch never re-renders it.
export const EarlierGenerations = memo(function EarlierGenerations({ threadId, generations }: { threadId: string; generations: Generation[] }) {
  const turns = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      return conv ? tree.inheritedContext(conv, threadId).map((x) => x.turn) : NONE;
    }),
  );
  let start = 0;
  return generations.slice(0, -1).map((g) => {
    const own = turns.slice(start, start + g.count);
    start += g.count;
    return (
      <section key={g.id} data-generation={g.id} className="border-b border-line-soft">
        <GenerationHeader generation={g} kind="ancestor" />
        {/* threadId is the generation's own thread, so a clip records the thread that owns the turn. */}
        {own.map((turn, index) => (
          <TurnView key={turn.id} role="earlier" threadId={g.id} turn={turn} index={index} isLast={false} />
        ))}
      </section>
    );
  });
});

// The fixed control above the body for a branch: the generation being read, and a menu of all
// generations; choosing one scrolls the body to it.
export const GenerationPicker = memo(function GenerationPicker({
  generations,
  inView,
  onChoose,
}: {
  generations: Generation[];
  inView: string;
  onChoose: (threadId: string) => void;
}) {
  const current = generations.find((g) => g.id === inView) ?? generations.at(-1);
  if (!current) return null;
  const lastId = generations.at(-1)?.id;
  return (
    <Menu.Root>
      <Tip content="Choose which part of the conversation to read">
        <Menu.Trigger asChild>
          <button
            type="button"
            data-testid="generation-picker"
            data-in-view={current.id}
            className="-ml-2 inline-flex h-[30px] max-w-full min-w-0 items-center gap-2 rounded-cell px-2 text-[13.5px] font-medium text-fg transition-colors duration-150 ease-out-expo hover:bg-surface data-[state=open]:bg-surface"
          >
            <span className="label-sm num shrink-0 text-fg">{current.number}</span>
            <span data-testid="generation-picker-title" className="min-w-0 truncate">
              {current.title}
            </span>
            <ChevronDown {...ICON} className="shrink-0 text-muted" />
          </button>
        </Menu.Trigger>
      </Tip>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} collisionPadding={8} data-testid="generation-menu" className={MENU_CONTENT}>
          <Menu.RadioGroup value={current.id} onValueChange={onChoose}>
            {generations.map((g) => (
              <Menu.RadioItem
                key={g.id}
                value={g.id}
                data-testid={`generation-option-${g.id}`}
                className="flex h-[34px] cursor-pointer items-center gap-2 rounded-cell px-2 text-[13.5px] text-fg outline-none select-none data-[highlighted]:bg-surface"
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <Menu.ItemIndicator>
                    <Check {...ICON} />
                  </Menu.ItemIndicator>
                </span>
                <span className="label-sm num shrink-0 text-fg">{g.number}</span>
                <span className="min-w-0 flex-1 truncate">{g.title}</span>
                {g.id === lastId && <span className="shrink-0 text-[13px] text-muted">This branch</span>}
                <span className="num shrink-0 text-[13px] text-muted">{g.count}</span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
});
