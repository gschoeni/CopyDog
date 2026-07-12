"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { closeProposalAction, mergeProposalAction } from "../actions";

export function ProposalActions({
  projectId,
  proposalId,
  changeCount,
}: {
  projectId: string;
  proposalId: string;
  changeCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"merge" | "close" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    setBusy("merge");
    setError(null);
    try {
      const result = await mergeProposalAction({ projectId, proposalId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    setBusy("close");
    try {
      await closeProposalAction({ projectId, proposalId });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={merge} disabled={busy !== null || changeCount === 0}>
        {busy === "merge" ? "Merging…" : "Merge into main"}
      </Button>
      <Button variant="ghost" onClick={close} disabled={busy !== null}>
        {busy === "close" ? "Closing…" : "Close without merging"}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
