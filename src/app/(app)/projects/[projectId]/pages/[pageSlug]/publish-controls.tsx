"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ProposeIcon, PublishIcon, SyncIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";

import { proposeAction, publishAction, syncPageFromMainAction } from "./actions";

/**
 * Publish (drafts → your branch, visible to the team) and Propose
 * (your branch → review → main). Publishing is frequent and light;
 * proposing is the deliberate "make this the copy" moment.
 */
export function PublishControls({
  projectId,
  pageSlug,
  dirty,
  onPublished,
}: {
  projectId: string;
  pageSlug: string;
  dirty: boolean;
  onPublished: () => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"publish" | "propose" | "sync" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish(message: string) {
    setBusy(true);
    setError(null);
    try {
      await publishAction({ projectId, message: message || undefined });
      onPublished();
      setDialog(null);
    } catch {
      setError("Publish failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function propose(title: string, description: string) {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { proposalId } = await proposeAction({ projectId, title: title.trim(), description: description.trim() });
      onPublished();
      setDialog(null);
      router.push(`/projects/${projectId}/proposals/${proposalId}`);
    } catch {
      setError("Couldn't open the proposal — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      await syncPageFromMainAction({ projectId, pageSlug });
      setDialog(null);
      router.refresh();
    } catch {
      setError("Couldn't update from main — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setDialog("sync")}
        aria-label="Update from main"
        title="Update from main"
      >
        <SyncIcon />
      </Button>
      <Button
        variant="secondary"
        size="icon"
        onClick={() => setDialog("publish")}
        className="relative"
        aria-label="Publish"
        title="Publish"
      >
        <PublishIcon />
        {dirty && <span aria-label="Unpublished changes" className="absolute -right-1 -top-1 size-2 rounded-full bg-accent" />}
      </Button>
      <Button variant="secondary" size="icon" onClick={() => setDialog("propose")} aria-label="Propose" title="Propose">
        <ProposeIcon />
      </Button>

      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setDialog(null);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-raised">
            {dialog === "publish" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void publish(new FormData(e.currentTarget).get("message") as string);
                }}
              >
                <h2 className="text-base font-semibold tracking-tight">Publish your drafts</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-tertiary">
                  Commits your edits to your branch so teammates can see and adopt your versions. Main is untouched.
                </p>
                <Input name="message" placeholder="What changed? (optional)" className="mt-4" autoFocus disabled={busy} />
                {error && <p className="mt-2 text-xs text-danger">{error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDialog(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={busy}>
                    {busy ? "Publishing…" : "Publish"}
                  </Button>
                </div>
              </form>
            )}

            {dialog === "propose" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void propose(form.get("title") as string, form.get("description") as string);
                }}
              >
                <h2 className="text-base font-semibold tracking-tight">Propose your draft</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-tertiary">
                  Publishes your edits and opens a proposal to make them the team&apos;s copy on main. Anyone can
                  review the diff and merge.
                </p>
                <Input name="title" placeholder="Proposal title" className="mt-4" autoFocus required maxLength={120} disabled={busy} />
                <textarea
                  name="description"
                  placeholder="Why this copy? (optional)"
                  disabled={busy}
                  className="mt-2 h-20 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
                />
                {error && <p className="mt-2 text-xs text-danger">{error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDialog(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={busy}>
                    {busy ? "Opening…" : "Open proposal"}
                  </Button>
                </div>
              </form>
            )}

            {dialog === "sync" && (
              <div>
                <h2 className="text-base font-semibold tracking-tight">Update this page from main?</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-tertiary">
                  Replaces <span className="font-medium text-ink-secondary">{pageSlug}</span> in your draft with the
                  team&apos;s published copy. Your unpublished edits to this page will be overwritten.
                </p>
                {error && <p className="mt-2 text-xs text-danger">{error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDialog(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void sync()} disabled={busy}>
                    {busy ? "Updating…" : "Replace my page"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
