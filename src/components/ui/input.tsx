import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return (
      <input
        ref={ref}
        className={
          "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink " +
          "placeholder:text-ink-tertiary transition-shadow " +
          "focus:border-border-strong focus:outline-2 focus:outline-offset-1 focus:outline-accent " +
          className
        }
        {...props}
      />
    );
  },
);
