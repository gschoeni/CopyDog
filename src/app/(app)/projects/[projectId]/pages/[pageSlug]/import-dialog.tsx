"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { importPageAction } from "./actions";

type SourceKind = "url" | "html" | "image";

/**
 * Import an existing page — paste a URL, raw HTML, or drop in a screenshot.
 * Replaces this page's copy and wireframe with the extracted result.
 */
export function ImportDialog({
  projectId,
  pageSlug,
  onClose,
  onImported,
}: {
  projectId: string;
  pageSlug: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [kind, setKind] = useState<SourceKind>("url");
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canImport =
    (kind === "url" && url.trim().length > 0) ||
    (kind === "html" && html.trim().length > 0) ||
    (kind === "image" && imageDataUrl !== null);

  async function runImport() {
    if (!canImport || busy) return;
    setBusy(true);
    setError(null);
    try {
      const source =
        kind === "url"
          ? ({ kind: "url", url: url.trim() } as const)
          : kind === "html"
            ? ({ kind: "html", html } as const)
            : ({ kind: "image", dataUrl: imageDataUrl! } as const);
      const result = await importPageAction({ projectId, pageSlug, source });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onImported();
    } catch {
      setError("Import failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function pickImage(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > 8_000_000) {
      setError("Images up to 8 MB, please.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Import page content"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-base font-semibold tracking-tight">Import into this page</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-tertiary">
          Bring in an existing site or design. This replaces the page&apos;s current copy and wireframe.
        </p>

        <div role="tablist" aria-label="Import source" className="mt-4 flex rounded-lg border border-border bg-surface-sunken p-0.5">
          {(
            [
              { value: "url", label: "Website URL" },
              { value: "html", label: "Paste HTML" },
              { value: "image", label: "Screenshot" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={kind === tab.value}
              onClick={() => {
                setKind(tab.value);
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                kind === tab.value ? "bg-surface text-ink shadow-soft" : "text-ink-tertiary hover:text-ink-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-28">
          {kind === "url" && (
            <div>
              <Input
                type="url"
                placeholder="https://your-site.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label="Website URL"
                autoFocus
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runImport();
                }}
              />
              <p className="mt-2 text-xs text-ink-tertiary">
                We&apos;ll read the page and pull its copy into editable sections.
              </p>
            </div>
          )}
          {kind === "html" && (
            <textarea
              placeholder="<html>…paste the page source…</html>"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              aria-label="Raw HTML"
              disabled={busy}
              className="h-28 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
            />
          )}
          {kind === "image" && (
            <div>
              <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong text-sm text-ink-secondary transition-colors hover:border-accent hover:text-accent">
                {imageName ? <span className="font-medium">{imageName}</span> : <span>Choose a JPG or PNG…</span>}
                <span className="text-xs text-ink-tertiary">A full-page screenshot works best</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => pickImage(e.target.files?.[0])}
                />
              </label>
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={runImport} disabled={!canImport || busy}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
