import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Canvas } from "./components/Canvas";
import { ConflictBar } from "./components/ConflictBar";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { StartBox } from "./components/StartBox";
import { TopBar } from "./components/TopBar";
import { Button, Label, Skeleton, TipProvider, Toast } from "./components/ui";
import { boot, flushSavesOnHide, leavingLosesWork, newConversation, retryOpen, selectOpenConversation, useStore } from "./store";
import * as tree from "./tree";

export function App() {
  useEffect(() => {
    void boot();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
        e.preventDefault();
        newConversation();
      }
    };
    // Hidden (another tab, minimized) or closing: pending saves run now instead of after their delay.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushSavesOnHide();
    };
    // Leaving would lose this tab's version (a conflict, or a failed save): ask the browser to confirm.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!leavingLosesWork()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("pagehide", flushSavesOnHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pagehide", flushSavesOnHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <TipProvider>
      <div className="flex h-full w-full overflow-hidden bg-bg text-fg">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <ConflictBar />
          <div className="relative min-h-0 flex-1">
            <CenterView />
            <Toast />
          </div>
        </main>
        <RightPanel />
      </div>
    </TipProvider>
  );
}

// The middle column: the start box, the canvas, a loading skeleton, or the load failure.
function CenterView() {
  const conv = useStore(selectOpenConversation);
  const openState = useStore((s) => s.openState);
  if (conv) return tree.isBlank(conv) ? <StartBox key={conv.id} /> : <Canvas key={conv.id} />;
  if (openState.kind === "failed") return <LoadFailed reason={openState.reason} />;
  return <CanvasSkeleton />;
}

function LoadFailed({ reason }: { reason: string }) {
  return (
    <div className="grid-surface flex h-full items-center justify-center p-6">
      <div className="w-full max-w-[420px] rounded-cell border border-line bg-bg p-6">
        <Label className="text-fail">Could not open this conversation</Label>
        <p className="mt-2 text-[15px] leading-[1.5] text-pretty text-fg">{reason}</p>
        <p className="mt-1 text-[13.5px] leading-[1.5] text-muted">Check that the server is running, then try again.</p>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" icon={RotateCcw} onClick={retryOpen}>
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

// Where the root card will appear, drawn as surface bars while the conversation loads.
function CanvasSkeleton() {
  return (
    <div className="grid-surface h-full p-12" aria-busy="true" aria-label="Loading the conversation">
      <div className="w-(--card-width) rounded-cell border border-line bg-bg">
        <div className="flex h-10 items-center gap-3 border-b border-line-soft px-3">
          <Skeleton className="h-3 w-9" />
          <Skeleton className="h-3 w-40" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2 border-b border-line-soft px-3 py-3 pl-9 last:border-b-0">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
