import { closeDeletedConversation, keepThisVersion, loadOtherVersion, selectOpenSaveState, useStore } from "../store";
import { Button, LabelSm } from "./ui";

// Shown at the top of the canvas column when a save found a newer version on the server (another
// tab or window saved it) or found it deleted there. Saving is stopped until the user chooses.
export function ConflictBar() {
  const openId = useStore((s) => s.openId);
  const save = useStore(selectOpenSaveState);
  if (openId === null || save.kind !== "conflict") return null;
  const deleted = save.currentUpdatedAt === null;

  return (
    <div role="alert" data-testid="conflict-bar" className="flex min-h-12 shrink-0 items-center gap-4 border-b border-fail bg-bg px-4 py-2">
      <span className="dot shrink-0 bg-fail" aria-hidden />
      <div className="min-w-0 flex-1">
        <LabelSm className="block text-fail">Not saved</LabelSm>
        <p className="text-[13.5px] leading-[1.4] text-fg">
          {deleted
            ? "This conversation was deleted in another tab or window."
            : "This conversation was changed in another tab or window."}
        </p>
      </div>
      {deleted ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="danger" data-testid="conflict-close" onClick={() => closeDeletedConversation(openId)}>
            Close it
          </Button>
          <Button size="sm" variant="primary" data-testid="conflict-keep" tip="Save this tab's copy again" onClick={() => keepThisVersion(openId)}>
            Keep it
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" data-testid="conflict-load" tip="Replace this tab's copy with the saved one" onClick={() => void loadOtherVersion(openId)}>
            Load the other version
          </Button>
          <Button size="sm" variant="primary" data-testid="conflict-keep" tip="Save this tab's copy over the other one" onClick={() => keepThisVersion(openId)}>
            Keep this tab's version
          </Button>
        </div>
      )}
    </div>
  );
}
