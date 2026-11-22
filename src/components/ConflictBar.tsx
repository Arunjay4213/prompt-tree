import { closeDeletedConversation, keepThisVersion, loadOtherVersion, selectOpenSaveState, useStore } from "../store";
import { Button, LabelSm } from "./ui";

// Shown at the top of the canvas column when a save found a newer version on the server (another
// tab or window saved it) or found it deleted there. Saving is stopped until the user chooses.
export function ConflictBar() {
  const openId = useStore((s) => s.openId);
  const save = useStore(selectOpenSaveState);
  if (openId === null || save.kind !== "conflict") return null;
  const deleted = save.currentUpdatedAt === null;

  // The bar lays itself out from its own width (container rules), not the window's: on a narrow
  // canvas column the message runs across the full width with the buttons on a row below; on a
  // wide one the message is on the left and the buttons on the right. The "changed" buttons are
  // wider, so that case switches later.
  // Written out in full: Tailwind only generates classes it finds as whole words in the source.
  const layout = deleted
    ? "@min-[520px]:flex-row @min-[520px]:items-center @min-[520px]:gap-4"
    : "@min-[700px]:flex-row @min-[700px]:items-center @min-[700px]:gap-4";
  return (
    <div role="alert" data-testid="conflict-bar" className="@container shrink-0 border-b border-fail bg-bg">
      <div className={`flex flex-col gap-2 px-4 py-2.5 ${layout}`}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="dot mt-[5px] shrink-0 bg-fail" aria-hidden />
          <div className="min-w-0">
            <LabelSm className="block text-fail">Not saved</LabelSm>
            <p className="text-[13.5px] leading-[1.4] text-pretty text-fg">
              {deleted
                ? "This conversation was deleted in another tab or window."
                : "This conversation was changed in another tab or window."}
            </p>
          </div>
        </div>
        {deleted ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[18px] @min-[520px]:pl-0">
            <Button size="sm" variant="danger" data-testid="conflict-close" onClick={() => closeDeletedConversation(openId)}>
              Close it
            </Button>
            <Button size="sm" variant="primary" data-testid="conflict-keep" tip="Save this tab's copy again" onClick={() => keepThisVersion(openId)}>
              Keep it
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[18px] @min-[700px]:pl-0">
            <Button size="sm" data-testid="conflict-load" tip="Replace this tab's copy with the saved one" onClick={() => void loadOtherVersion(openId)}>
              Load the other version
            </Button>
            <Button size="sm" variant="primary" data-testid="conflict-keep" tip="Save this tab's copy over the other one" onClick={() => keepThisVersion(openId)}>
              Keep this tab's version
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
