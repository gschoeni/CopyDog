"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

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
    <Modal label={`Delete page ${title}`} onClose={onClose} dismissible={!busy}>
      <h2 className="text-lg font-semibold tracking-tight">Delete “{title}”?</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
        {subpages > 0 && <>This also deletes {subpages === 1 ? "its subpage" : `all ${subpages} of its subpages`}. </>}
        Every copy version and the wireframe go with it. The page stays in your teammates’ view until you publish.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {/* deliberately not autofocused: the dialog itself takes focus, so a
            stray Enter right after opening can't delete the page */}
        <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
          {busy ? "Deleting…" : "Delete page"}
        </Button>
      </div>
    </Modal>
  );
}
