"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { TrashIcon } from "@/components/ui/icons";

import { DeleteProjectDialog } from "./delete-project-dialog";

/**
 * The quiet ✕ of a project: a trash icon that only appears on card hover,
 * guarded by the shared confirm dialog — deleting a project destroys its
 * content and history for the whole team, so it should be one deliberate
 * step more than a click.
 */
export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

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
        <DeleteProjectDialog
          projectId={projectId}
          name={name}
          onClose={() => setConfirming(false)}
          onDeleted={() => {
            setConfirming(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
