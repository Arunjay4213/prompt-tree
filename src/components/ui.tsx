// The shared primitives. Their look comes from the component classes in index.css
// (.btn, .icon-btn, .tag, .label, .label-sm, .ticks, .skeleton, .live-dot).
// Disabled buttons use aria-disabled instead of the disabled attribute, so their tooltip
// (the reason) still shows on hover and focus.

import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { useStore } from "../store";

// Size and stroke for every lucide icon: <Icon {...ICON} />.
export const ICON = { size: 15, strokeWidth: 1.5, "aria-hidden": true } as const;

// The last key or pointer press anywhere on the page, so a Tip can tell focus moved by Tab
// (a keyboard user looking for the tooltip) from focus moved by a script.
// tab:   the last press was Tab or Shift+Tab.
// other: any other key, or a pointer press.
type LastInput = "tab" | "other";
let lastInput: LastInput = "other";

// Wrap the whole app once; gives every Tip the 400 ms open delay.
// The content is not hoverable: it closes as soon as the pointer leaves the trigger, so a tooltip
// drawn over another control never keeps itself open or catches that control's clicks.
export function TipProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => (lastInput = e.key === "Tab" ? "tab" : "other");
    const onPointerDown = () => (lastInput = "other");
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200} disableHoverableContent>
      {children}
    </Tooltip.Provider>
  );
}

// A tooltip on any element that accepts a ref (buttons, links, focusable spans). No content: no tooltip.
// It opens on pointer hover, and on focus only when the focus came from Tab. Focus that a closing
// menu or dialog gives back to its button must not open it, and :focus-visible cannot tell those
// apart (after any typing, Chrome marks that returned focus as visible). Preventing the focus event's
// default stops Radix from opening the tooltip for it.
export function Tip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactElement;
}) {
  if (content === null || content === undefined || content === "") return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        asChild
        onFocus={(e) => {
          if (lastInput !== "tab") e.preventDefault();
        }}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="tooltip pointer-events-none z-50 max-w-[280px] rounded-cell bg-fg px-2 py-[5px] font-mono text-[10.5px] leading-[1.45] tracking-[0.08em] text-bg uppercase"
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm"; // md: 34px high, sm: 28px for rows of small actions
  icon?: LucideIcon;
  keyHint?: string; // shown after the text as a mono small label, for example "ENTER"
  tip?: string; // tooltip while enabled
  disabledReason?: string | null; // set: the button is disabled and this is its tooltip
};

// A text button. primary for the one main action, secondary for the rest, danger for deleting,
// ghost for quiet actions in rows.
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  keyHint,
  tip,
  disabledReason,
  className = "",
  type = "button",
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const disabled = disabledReason !== undefined && disabledReason !== null;
  return (
    <Tip content={disabled ? disabledReason : tip}>
      <button
        type={type}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${className}`}
        {...rest}
      >
        {Icon && <Icon {...ICON} />}
        {children}
        {keyHint && <span className="label-sm key-hint">{keyHint}</span>}
      </button>
    </Tip>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "children"> & {
  icon: LucideIcon;
  label: string; // the tooltip and the accessible name
  active?: boolean; // a toggle that is on; omit for plain buttons
  tone?: "default" | "accent" | "danger"; // accent: active color is orange (clip toggle); danger: red on hover
  disabledReason?: string | null;
};

// A 28 by 28 icon-only button with a tooltip.
export function IconButton({
  icon: Icon,
  label,
  active,
  tone = "default",
  disabledReason,
  className = "",
  onClick,
  ...rest
}: IconButtonProps) {
  const disabled = disabledReason !== undefined && disabledReason !== null;
  return (
    <Tip content={disabled ? disabledReason : label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled || undefined}
        data-active={active}
        data-tone={tone}
        onClick={disabled ? undefined : onClick}
        className={`icon-btn ${className}`}
        {...rest}
      >
        <Icon {...ICON} />
      </button>
    </Tip>
  );
}

// A small bordered mono tag. "output" marks something that is in the final output.
export function Tag({
  variant = "default",
  dot,
  className = "",
  children,
}: {
  variant?: "default" | "output";
  dot?: "accent" | "fail";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`tag ${variant === "output" ? "tag-output" : ""} ${className}`}>
      {dot && <span className={`dot ${DOT_COLOR[dot]}`} aria-hidden />}
      {children}
    </span>
  );
}

const DOT_COLOR = { accent: "bg-accent", fail: "bg-fail" } as const;

// Mono uppercase label (11px) for section names and metadata.
export function Label({ className = "", children }: { className?: string; children: ReactNode }) {
  return <span className={`label ${className}`}>{children}</span>;
}

// The smaller mono label (10.5px) used inside cards, rows and buttons.
export function LabelSm({ className = "", children }: { className?: string; children: ReactNode }) {
  return <span className={`label-sm ${className}`}>{children}</span>;
}

// The pulsing 6px accent dot: something is being written right now.
export function LiveDot() {
  return <span className="dot live-dot" aria-hidden />;
}

// A surface-colored bar shown while something loads. Size it with classes.
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} aria-hidden />;
}

// A confirm dialog for destructive actions. Controlled: the caller owns `open`.
// Where focus goes when a dialog closes and the element that opened it is gone (for example the
// delete button of the card or conversation that was just deleted). Elements mark themselves with
// data-focus-target="canvas" or data-focus-target="new-conversation".
export type FocusFallback = "canvas" | "new-conversation";

function isFocusable(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0 && el.closest("[inert]") === null;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  focusFallback = "canvas",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  focusFallback?: FocusFallback;
}) {
  // The element that had focus when the dialog opened (usually the button that opened it). This
  // layout effect runs before the dialog moves focus into itself.
  const opener = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement;
  }, [open]);
  // On close (Escape, Cancel or confirm) focus goes back to the opener, or to the fallback when the
  // opener no longer exists, never to the page body.
  const restoreFocus = (e: Event) => {
    e.preventDefault();
    const target = isFocusable(opener.current) ? opener.current : document.querySelector(`[data-focus-target="${focusFallback}"]`);
    if (isFocusable(target)) target.focus({ preventScroll: true });
    opener.current = null;
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 grid place-items-center bg-overlay p-6">
          <Dialog.Content
            onCloseAutoFocus={restoreFocus}
            className="dialog-content ticks w-full max-w-[420px] rounded-panel border border-fg bg-bg p-6 outline-none"
          >
            <Dialog.Title className="text-[18px] leading-[1.3] font-medium tracking-[-0.01em]">{title}</Dialog.Title>
            <Dialog.Description className="mt-2 text-[14px] leading-[1.5] text-pretty text-muted">{body}</Dialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button
                variant="danger"
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Renders the store's toast (showToast). Place it once inside a positioned container.
export function Toast() {
  const toast = useStore((s) => s.toast);
  const shown = toast.kind === "shown";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`label pointer-events-none absolute bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-cell bg-fg px-3 py-2 whitespace-nowrap text-bg transition-[opacity,translate] duration-300 ease-out-expo ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      {toast.text}
    </div>
  );
}
