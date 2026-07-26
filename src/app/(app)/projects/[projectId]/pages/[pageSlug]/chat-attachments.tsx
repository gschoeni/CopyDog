"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { createXXHash128 } from "hash-wasm";

import {
  UPLOAD_ACCEPT,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_LIMITS,
  tooLargeMessage,
  uploadMedia,
  type ReferenceContextRef,
  type ReferenceMedia,
} from "@/lib/agent/context";
import { Button } from "@/components/ui/button";
import { DocumentIcon, GlobeIcon, ImageIcon, PaperclipIcon } from "@/components/ui/icons";

/**
 * Attaching reference material to the assistant: a screenshot, a PDF, or a
 * link to build a page from. The upload resolves server-side into whatever
 * the model can read, and the browser only ever holds the descriptor that
 * comes back — no megabytes in React state, no data URLs in the transcript.
 */

/** The chip icon per reference kind — pixels, a document, or a fetched page. */
export function ReferenceMediaIcon({ media, className }: { media: ReferenceMedia; className?: string }) {
  if (media === "pdf") return <DocumentIcon className={className} />;
  if (media === "text") return <GlobeIcon className={className} />;
  return <ImageIcon className={className} />;
}

export interface AttachTarget {
  projectId: string;
  pageSlug: string;
  conversationId: string;
}

/**
 * Uploads a file and attaches it as a reference.
 *
 * A route handler can only take 4.5 MB per request, so the file goes to Oxen
 * the way `oxen push` sends large files: hash the whole thing (XXH3-128),
 * slice it, PUT each slice with its byte offset, then ask the server to
 * reassemble. Oxen re-hashes what it assembled and refuses anything that
 * doesn't match, so a dropped chunk fails loudly instead of silently
 * corrupting a reference. Size is bounded by what the model accepts, not by
 * what an HTTP request can carry.
 */
export async function attachFile(
  target: AttachTarget,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<ReferenceContextRef> {
  const media = uploadMedia(file.type);
  if (media === null) throw new Error("Attach a PNG, JPG, WEBP, GIF, or PDF.");
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > UPLOAD_LIMITS[media]) throw new Error(tooLargeMessage(media));

  const hash = await hashFile(file);
  const base = `/projects/${target.projectId}/pages/${target.pageSlug}/chat/references`;

  let numChunks = 0;
  for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
    const slice = file.slice(offset, Math.min(offset + UPLOAD_CHUNK_BYTES, file.size));
    const res = await fetch(`${base}/upload?hash=${hash}&offset=${offset}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: slice,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "Upload failed — please try again.");
    }
    numChunks++;
    onProgress?.(Math.min(1, (offset + slice.size) / file.size));
  }

  return attach(target, {
    upload: { hash, filename: file.name, mime: file.type, byteSize: file.size, numChunks },
  });
}

/** Attaches a URL; the server fetches and classifies it (SSRF-guarded). */
export async function attachUrl(target: AttachTarget, url: string): Promise<ReferenceContextRef> {
  return attach(target, { url });
}

async function attach(target: AttachTarget, body: object): Promise<ReferenceContextRef> {
  const res = await fetch(`/projects/${target.projectId}/pages/${target.pageSlug}/chat/references`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, conversationId: target.conversationId }),
  });
  const data = (await res.json().catch(() => null)) as
    | { reference?: ReferenceContextRef; error?: string }
    | null;
  if (!res.ok || !data?.reference) {
    throw new Error(data?.error ?? "Couldn't attach that. Please try again.");
  }
  return data.reference;
}

/**
 * The file's XXH3-128, which is the id Oxen stores it under. Hashed in slices
 * so a large PDF never sits in memory twice, and formatted the way Oxen does
 * (Rust's `{:x}` on a u128 — no leading zeros).
 */
async function hashFile(file: File): Promise<string> {
  const hasher = await createXXHash128();
  hasher.init();
  for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
    const slice = file.slice(offset, Math.min(offset + UPLOAD_CHUNK_BYTES, file.size));
    hasher.update(new Uint8Array(await slice.arrayBuffer()));
  }
  return hasher.digest("hex").replace(/^0+/, "");
}

/**
 * The composer's paperclip: a popover offering the two ways in. Files are the
 * common case and sit first; the link field is right there rather than behind
 * another step, because pasting a competitor's URL is the other half of this.
 */
export function AttachReferenceButton({
  disabled,
  busy,
  onAttachFile,
  onAttachUrl,
}: {
  disabled: boolean;
  busy: boolean;
  onAttachFile: (file: File) => void;
  onAttachUrl: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setUrl("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (open) window.requestAnimationFrame(() => urlRef.current?.focus());
  }, [open]);

  const submitUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    close();
    onAttachUrl(trimmed);
  };

  const onUrlKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitUrl();
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-label="Attach a reference"
        aria-expanded={open}
        title="Attach an image, PDF, or link"
        className="flex size-8 items-center justify-center rounded-lg text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-expanded:bg-surface-hover aria-expanded:text-ink"
      >
        {busy ? <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" /> : <PaperclipIcon />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Attach a reference"
          className="absolute bottom-10 left-0 z-30 w-72 rounded-xl border border-border bg-surface p-3 shadow-raised"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">Build from a reference</p>

          <label className="mt-2.5 flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-sm text-ink-secondary transition-colors hover:border-accent hover:text-accent">
            <ImageIcon className="size-4 shrink-0" />
            <span>
              <span className="block font-medium">Upload an image or PDF</span>
              <span className="block text-[11px] text-ink-tertiary">A screenshot, a design, a brand deck</span>
            </span>
            <input
              type="file"
              accept={UPLOAD_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = ""; // re-picking the same file must still fire
                if (!file) return;
                close();
                onAttachFile(file);
              }}
            />
          </label>

          <div className="mt-2.5">
            <label htmlFor="reference-url" className="block text-[11px] font-medium text-ink-tertiary">
              …or paste a link
            </label>
            <div className="mt-1 flex gap-1.5">
              <input
                id="reference-url"
                ref={urlRef}
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={onUrlKeyDown}
                placeholder="https://a-site-you-like.com"
                className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
              />
              <Button size="sm" onClick={submitUrl} disabled={url.trim().length === 0}>
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
