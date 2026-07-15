"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TrashIcon } from "@/components/ui/icons";

import { deleteProjectAction } from "./actions";

/**
 * The quiet ✕ of a project: a trash icon that only appears on card hover,
 * guarded by a confirm dialog — deleting a project destroys its content
 * and history for the whole team, so it should be one deliberate step
 * more than a click.
 */
export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteProjectAction(projectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Couldn't delete the project. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Delete project ${name}`}
        title="Delete project"
        onClick={() => setConfirming(true)}
        className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-ink-tertiary opacity-0 transition-opacity hover:bg-surface-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon />
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Delete project ${name}`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setConfirming(false);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-raised">
            <h2 className="text-lg font-semibold tracking-tight">Delete “{name}”?</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              This deletes the project for everyone on it — every page, every copy version, and the whole wireframe
              history. There is no undo.
            </p>
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
                {busy ? "Deleting…" : "Delete project"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
