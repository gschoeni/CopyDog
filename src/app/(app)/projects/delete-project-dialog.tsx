"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

import { deleteProjectAction } from "./actions";

/**
 * The one delete-project confirmation, shared by the projects-grid trash
 * and the settings danger zone — deleting a project destroys its content
 * and history for the whole team, so both entry points must warn with the
 * same words. The caller owns where to go afterwards via onDeleted.
 */
export function DeleteProjectDialog({
  projectId,
  name,
  onClose,
  onDeleted,
}: {
  projectId: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
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
      onDeleted();
    } catch {
      setError("Couldn't delete the project. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label={`Delete project ${name}`} onClose={onClose} dismissible={!busy}>
      <h2 className="text-lg font-semibold tracking-tight">Delete “{name}”?</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
        This deletes the project for everyone on it — every page, every copy version, and the whole wireframe
        history. There is no undo.
      </p>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
          {busy ? "Deleting…" : "Delete project"}
        </Button>
      </div>
    </Modal>
  );
}
