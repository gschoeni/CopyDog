"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { deletePageAction } from "./actions";

/**
 * Confirms a page delete before it happens. A page carries every version of
 * its copy and its wireframe — and, when it has subpages, theirs too — so the
 * dialog names what goes and says plainly that the loss is staged in the
 * user's own draft until they publish.
 */
export function DeletePageDialog({
  projectId,
  slug,
  title,
  subpages,
  onClose,
  onDeleted,
}: {
  projectId: string;
  slug: string;
  title: string;
  /** Pages nested under this one, all of which go with it. */
  subpages: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape backs out — the sidebar is a keyboard surface, and a modal you can
  // only leave with the mouse is a trap
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const result = await deletePageAction({ projectId, slug });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDeleted();
    } catch {
      setError("Couldn't delete the page. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Delete page ${title}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-raised">
        <h2 className="text-lg font-semibold tracking-tight">Delete “{title}”?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          {subpages > 0 && (
            <>
              This also deletes {subpages === 1 ? "its subpage" : `all ${subpages} of its subpages`}.{" "}
            </>
          )}
          Every copy version and the wireframe go with it. The page stays in your teammates’ view until you publish.
        </p>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy} autoFocus>
            {busy ? "Deleting…" : "Delete page"}
          </Button>
        </div>
      </div>
    </div>
  );
}
