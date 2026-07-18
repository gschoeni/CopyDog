"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Panel resizing, shared by every resizable surface (project sidebar,
 * copy/wireframe split, assistant panel).
 *
 * usePanelSize owns one persisted number — a px width or a percent —
 * restored after hydration (SSR can't see localStorage). ResizeHandle is
 * the draggable divider between panes: the WAI-ARIA window-splitter
 * pattern with pointer-captured drags, arrow-key steps, and double-click
 * reset. During a drag the owner applies sizes straight to the DOM
 * (onPreview) so nothing re-renders per pointer move; the final size is
 * committed once on release.
 */

export function usePanelSize({
  storageKey,
  defaultSize,
  min,
  max,
}: {
  storageKey: string;
  defaultSize: number;
  min: number;
  max: number;
}) {
  const [size, setSize] = useState(defaultSize);

  // restore after hydration commit — SSR can't see localStorage (same
  // pattern as the sidebar/view-mode restores)
  useEffect(() => {
    const stored = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored > 0) {
      queueMicrotask(() => setSize(Math.min(max, Math.max(min, stored))));
    }
  }, [storageKey, min, max]);

  const commit = useCallback(
    (next: number) => {
      const clamped = Math.min(max, Math.max(min, next));
      setSize(clamped);
      localStorage.setItem(storageKey, String(clamped));
    },
    [storageKey, min, max],
  );

  const reset = useCallback(() => {
    localStorage.removeItem(storageKey);
    setSize(defaultSize);
  }, [storageKey, defaultSize]);

  return { size, commit, reset };
}

export function ResizeHandle({
  label,
  value,
  min,
  max,
  step = 16,
  invertKeyboard = false,
  sizeAt,
  onPreview,
  onCommit,
  onReset,
  className = "",
}: {
  /** accessible name, e.g. "Resize assistant panel" */
  label: string;
  /** the committed size (px or percent — one consistent unit per handle) */
  value: number;
  min: number;
  max: number;
  /** arrow-key increment, in the same unit as value */
  step?: number;
  /** set when the panel grows as the divider moves LEFT (right-edge panels) */
  invertKeyboard?: boolean;
  /** map a pointer clientX to a size in the value's unit */
  sizeAt: (clientX: number) => number;
  /** apply a size live during the drag (write styles directly, no state) */
  onPreview: (size: number) => void;
  /** persist the final size */
  onCommit: (size: number) => void;
  /** restore the default size (double-click) */
  onReset: () => void;
  /** positioning classes from the owner (absolute strip or in-flow) */
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const lastSizeRef = useRef(value);
  const lastDownRef = useRef({ time: 0, x: 0 });

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const endDrag = () => {
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onCommit(lastSizeRef.current);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // preventDefault suppresses the compatibility dblclick event (and
    // PointerEvent.detail is unreliable across browsers) — detect the
    // second press of a double-click ourselves
    const previous = lastDownRef.current;
    lastDownRef.current = { time: event.timeStamp, x: event.clientX };
    if (event.timeStamp - previous.time < 400 && Math.abs(event.clientX - previous.x) < 6) {
      onReset();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    lastSizeRef.current = value;
    setDragging(true);
    // the pointer leaves the strip while captured — keep the affordance
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const size = clamp(sizeAt(event.clientX));
    lastSizeRef.current = size;
    onPreview(size);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    endDrag();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = invertKeyboard ? -1 : 1;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = value - step * direction;
    else if (event.key === "ArrowRight") next = value + step * direction;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    if (next === null) return;
    event.preventDefault();
    onCommit(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={`${label} — drag, arrow keys, or double-click to reset`}
      data-dragging={dragging || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      className={`group cursor-col-resize touch-none outline-none ${className}`}
    >
      <div
        aria-hidden
        className={`mx-auto h-full w-0.5 rounded-full transition-colors duration-150 ${
          dragging ? "bg-accent" : "bg-transparent group-hover:bg-border-strong group-focus-visible:bg-accent"
        }`}
      />
    </div>
  );
}
