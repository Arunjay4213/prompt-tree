import { ChevronDown } from "lucide-react";
import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectOpenConversation, useStore } from "../../store";
import { plainPreview, plural } from "../../text";
import * as tree from "../../tree";
import { ICON } from "../ui";

const NO_TURNS: never[] = [];

// The ancestor turns this thread's model context starts with. Collapsed to one row by default;
// expanded, each turn in a condensed form with the path number of the card it comes from.
// Hidden for the root thread. Subscribes to its own data, so a streaming answer below never
// re-renders it.
export const InheritedContext = memo(function InheritedContext({ threadId }: { threadId: string }) {
  const [view, setView] = useState<"collapsed" | "expanded">("collapsed");
  const turns = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      return conv ? tree.inheritedContext(conv, threadId).map((x) => x.turn) : NO_TURNS;
    }),
  );
  const numbers = useStore(
    useShallow((s) => {
      const conv = selectOpenConversation(s);
      if (!conv) return NO_TURNS;
      const all = tree.pathNumbers(conv);
      return tree.inheritedContext(conv, threadId).map((x) => all[x.thread.id] ?? "");
    }),
  );
  if (turns.length === 0) return null;
  const expanded = view === "expanded";

  return (
    <div className="mt-6 border-y border-line-soft">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex h-10 w-full items-center justify-between gap-4 text-left text-[13.5px] font-medium text-muted transition-colors hover:text-fg"
        onClick={() => setView(expanded ? "collapsed" : "expanded")}
      >
        <span className="truncate">
          Inherited context · {plural(turns.length, "message")}
        </span>
        <ChevronDown {...ICON} className={`shrink-0 transition-transform duration-200 ease-out-expo ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <ol className="pb-2">
          {turns.map((turn, i) => (
            <li key={turn.id} className="grid grid-cols-[40px_minmax(0,1fr)] border-t border-line-soft py-3">
              <span className="label-sm num pt-[2px] text-muted">{numbers[i]}</span>
              <div className="min-w-0">
                <p className="line-clamp-2 text-[13.5px] leading-[1.4] font-medium tracking-[-0.005em] [overflow-wrap:anywhere] text-fg">
                  {turn.prompt}
                </p>
                <p className="mt-1 line-clamp-3 text-[13px] leading-[1.5] [overflow-wrap:anywhere] text-muted">
                  {plainPreview(turn.answer) || (turn.status === "failed" ? "No answer (failed)" : "No answer")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
