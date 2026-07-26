"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** False while rendering on the server, true once mounted — a portal needs a DOM. */
const subscribe = () => () => {};

/**
 * The app's one modal shell. Render it conditionally — mounted means open.
 *
 * It portals to <body> on purpose. A modal written inline sits wherever its
 * trigger happens to live, and `position: fixed` only escapes to the viewport
 * while no ancestor has claimed it: `position: sticky`, `transform`, `filter`
 * and friends all create a stacking context that traps the overlay behind
 * neighbouring chrome. Both the pages sidebar (a sticky <aside>) and the
 * editor toolbar (sticky, z-10) did exactly that — the scrim covered the copy
 * pane but left the header and assistant panel bright on top of it. Portaling
 * puts every modal in the root stacking context, so no trigger's placement can
 * break it again.
 */
export function Modal({
  label,
  onClose,
  dismissible = true,
  size = "sm",
  children,
}: {
  /** Accessible name for the dialog — usually what the confirm button does. */
  label: string;
  onClose: () => void;
  /** False while work is in flight: Escape and backdrop clicks stop closing. */
  dismissible?: boolean;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!mounted) return;
    // focus moves into the dialog and comes back to the trigger on close, so
    // keyboard users aren't dropped at the top of the page afterwards
    const returnTo = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const autoFocus = card?.querySelector<HTMLElement>("[data-autofocus], [autofocus]");
    (autoFocus ?? card)?.focus();
    return () => returnTo?.focus?.();
  }, [mounted]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      // a modal that leaks focus to the page behind it isn't modal
      const card = cardRef.current;
      if (!card) return;
      const focusable = [
        ...card.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissible, onClose]);

  if (!mounted) return null;

  const width = size === "lg" ? "max-w-lg" : size === "md" ? "max-w-md" : "max-w-sm";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 backdrop-blur-sm"
      // mousedown, not click: a drag that starts inside the card and releases
      // on the backdrop shouldn't dismiss the work it just did
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`w-full ${width} rounded-xl border border-border bg-surface p-6 shadow-raised outline-none`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
