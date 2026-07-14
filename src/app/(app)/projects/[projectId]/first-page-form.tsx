"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { addPageAction } from "./pages/[pageSlug]/actions";

export function FirstPageForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = (new FormData(event.currentTarget).get("title") as string)?.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { slug } = await addPageAction({ projectId, title });
      router.push(`/projects/${projectId}/pages/${slug}`);
    } catch {
      setError("Couldn't create the page — try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input name="title" placeholder="Home" autoFocus required maxLength={80} disabled={busy} aria-label="First page name" />
      <Button type="submit" disabled={busy} className="shrink-0">
        {busy ? "Creating…" : "Create page"}
      </Button>
    </form>
  );
}
