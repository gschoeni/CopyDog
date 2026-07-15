"use client";

import { Button } from "@/components/ui/button";

/**
 * The app-segment error boundary. Its most important job is honesty about
 * infrastructure: when the content store (Oxen) is down or misconfigured,
 * every project page used to collapse into a misleading 404 — now it lands
 * here with a hint at the real cause instead.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const storeDown = error.name === "ContentStoreUnavailableError" || error.message.includes("content store");
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-ink-tertiary">
          {storeDown ? "Content store unreachable" : "Something went wrong"}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {storeDown ? "CopyDog can't reach its content store" : "This page hit an error"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          {storeDown
            ? "Your copy is safe — it's versioned in Oxen, and this app just can't reach it right now. Check that the Oxen server is running (and pointed at the right data directory), then try again."
            : "Your draft autosaves as you type, so nothing is lost. Try again — and if it keeps happening, check the server logs."}
        </p>
        {error.digest && <p className="mt-2 text-xs text-ink-tertiary">Error digest: {error.digest}</p>}
        <Button className="mt-8" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
