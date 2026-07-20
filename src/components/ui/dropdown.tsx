"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { CheckIcon, ChevronDownIcon } from "@/components/ui/icons";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A small single-select dropdown, prettier than the system one: the closed
 * control looks like a quiet tag; the open menu floats on the inverse
 * surface (dark over light, light over dark) with a check beside the
 * current choice. Listbox semantics — arrow keys move, Enter/Space picks,
 * Escape closes, focus stays on the trigger throughout.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  className = "",
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name for the control, e.g. "Change Bob's role". */
  label: string;
  disabled?: boolean;
  /** Extra classes for the trigger button. */
  className?: string;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const pick = (option: DropdownOption<T>) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  // click-away closes without stealing the click
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        pick(options[activeIndex]!);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const current = options[selectedIndex];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`flex cursor-pointer items-center gap-1 rounded-md border border-transparent py-1 pl-2 pr-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary transition-colors hover:border-border hover:text-ink focus-visible:border-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-50 ${
          open ? "border-border text-ink" : ""
        } ${className}`}
      >
        {current?.label}
        <ChevronDownIcon aria-hidden className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-1 min-w-max rounded-xl border border-menu-border bg-menu p-1.5 shadow-raised"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => pick(option)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-2 pr-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-menu-fg transition-colors ${
                index === activeIndex ? "bg-menu-fg/15" : ""
              }`}
            >
              <CheckIcon
                aria-hidden
                className={`size-3 ${option.value === value ? "" : "invisible"}`}
              />
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
