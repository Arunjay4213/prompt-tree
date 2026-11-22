import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { ICON, Tip } from "./ui";

// The menu box shared by the model picker, the thread header's menu and a turn's menu:
// background bg, 1px line border, radius 6, no shadow, its own scroll past 320px.
export const MENU_CONTENT =
  "z-50 max-h-[320px] max-w-[360px] min-w-[220px] overflow-y-auto rounded-cell border border-line bg-bg p-1 outline-none data-[state=open]:animate-[rise-in_150ms_var(--ease-out-expo)]";

// A `...` button that opens a menu of items.
export function MoreMenu({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <Tip content={label}>
        <DropdownMenu.Trigger asChild>
          <button type="button" aria-label={label} data-testid={testId} className="icon-btn h-[30px] w-[30px] data-[state=open]:bg-surface data-[state=open]:text-fg">
            <MoreHorizontal {...ICON} />
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={8} className={MENU_CONTENT}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// One menu item: what it does in sentence case, and under it one plain sentence that explains it.
// A disabled item shows the reason it cannot be used as that sentence.
export function MenuItem({
  label,
  description,
  disabledReason,
  tone = "default",
  testId,
  onSelect,
}: {
  label: string;
  description: string;
  disabledReason?: string | null;
  tone?: "default" | "danger";
  testId?: string;
  onSelect: () => void;
}) {
  const disabled = disabledReason !== undefined && disabledReason !== null;
  return (
    <DropdownMenu.Item
      disabled={disabled}
      data-testid={testId}
      onSelect={onSelect}
      className={`flex cursor-pointer flex-col gap-0.5 rounded-cell px-3 py-2 outline-none select-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-surface ${
        disabled ? "text-muted" : tone === "danger" ? "text-fail" : "text-fg"
      }`}
    >
      <span className="text-[13.5px] leading-[1.3] font-medium">{label}</span>
      <span className="text-[12.5px] leading-[1.4] text-muted">{disabled ? disabledReason : description}</span>
    </DropdownMenu.Item>
  );
}
