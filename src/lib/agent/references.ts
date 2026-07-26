import { z } from "zod";

import type { DraftView } from "@/lib/content/store";
import { referencePath } from "@/lib/content/site";
import { serializeElements } from "@/lib/copy/markdown";
import { extractSectionsFromHtml } from "@/lib/import/extract";
import { fetchImportResource, ImportFetchError } from "@/lib/import/fetch-url";
import type { LlmContentPart } from "@/lib/llm/client";
import { OxenError, type OxenClient } from "@/lib/oxen/client";

import { MAX_UPLOAD_BYTES, uploadMedia, type ReferenceContextRef } from "./context";

/**
 * Reference material the user attaches to the assistant: a screenshot, a PDF,
 * or a URL to build a page from. Everything resolves at attach time into one
 * of three shapes the inference API understands — pixels, a document, or
 * extracted prose — so the rest of the system never branches on "was this a
 * file or a link".
 *
 * Storage: one JSON file per reference in the user's draft workspace, under
 * `refs/{conversationId}/`. Binaries are held as `data:` URLs, which is
 * exactly the form the API wants, so reading costs no conversion. That prefix
 * is pruned before every publish (see `content/store.ts`), so references are
 * private scratch input — versioned enough to survive the conversation, never
 * part of the site's history.
 */

/** Extracted page copy is truncated here — a reference, not an archive. */
const MAX_REFERENCE_TEXT = 60_000;

export const storedReferenceSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(64),
  media: z.enum(["image", "pdf", "text"]),
  label: z.string().min(1).max(120),
  mime: z.string().max(120),
  byteSize: z.number().int().nonnegative(),
  sourceUrl: z.string().max(2000).nullable(),
  /** image / pdf: `data:{mime};base64,…`, ready to hand to the model. */
  dataUrl: z.string().nullable(),
  /** text: copy extracted from a fetched HTML page. */
  text: z.string().nullable(),
});

export type StoredReference = z.infer<typeof storedReferenceSchema>;

/** A reference the user attached was rejected — the message is user-facing. */
export class ReferenceAttachError extends Error {}

// -- resolution ------------------------------------------------------------

/** Turns an uploaded file into a stored reference. Throws `ReferenceAttachError`. */
export function resolveUploadedReference(upload: {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}): StoredReference {
  const mime = upload.mime.split(";")[0]!.trim().toLowerCase();
  const media = uploadMedia(mime);
  if (media === null) {
    throw new ReferenceAttachError("Attach a PNG, JPG, WEBP, GIF, or PDF.");
  }
  if (upload.bytes.byteLength === 0) {
    throw new ReferenceAttachError("That file is empty.");
  }
  if (upload.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ReferenceAttachError(uploadTooLargeMessage());
  }
  return {
    version: 1,
    id: newReferenceId(),
    media,
    label: cleanLabel(upload.filename) || (media === "pdf" ? "document.pdf" : "image"),
    mime,
    byteSize: upload.bytes.byteLength,
    sourceUrl: null,
    dataUrl: toDataUrl(mime, upload.bytes),
    text: null,
  };
}

/**
 * Fetches a URL and turns it into a stored reference: an HTML page becomes
 * extracted copy (deterministically — no inference key needed to attach), an
 * image or PDF becomes something the model can look at directly.
 */
export async function resolveUrlReference(
  rawUrl: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<StoredReference> {
  let resource;
  try {
    resource = await fetchImportResource(rawUrl, { fetchImpl: options.fetchImpl });
  } catch (err) {
    throw err instanceof ImportFetchError ? new ReferenceAttachError(err.message) : err;
  }

  const url = new URL(rawUrl);
  const base = {
    version: 1 as const,
    id: newReferenceId(),
    byteSize: resource.bytes.byteLength,
    mime: resource.contentType,
    sourceUrl: url.toString(),
  };

  if (resource.kind === "html") {
    const html = new TextDecoder().decode(resource.bytes);
    const text = extractedCopy(html);
    if (!text) throw new ReferenceAttachError("No copy found on that page — is it a content page?");
    return { ...base, media: "text", label: url.hostname.replace(/^www\./, ""), dataUrl: null, text };
  }

  return {
    ...base,
    media: resource.kind,
    label: cleanLabel(decodeURIComponent(url.pathname.split("/").pop() ?? "")) || url.hostname,
    dataUrl: toDataUrl(resource.contentType, resource.bytes),
    text: null,
  };
}

/** The page's copy as markdown sections — the same extractor page import uses. */
function extractedCopy(html: string): string {
  const sections = extractSectionsFromHtml(html);
  const text = sections
    .map((section) => `## ${section.title}\n\n${serializeElements(section.elements)}`)
    .join("\n\n")
    .trim();
  return text.length > MAX_REFERENCE_TEXT ? `${text.slice(0, MAX_REFERENCE_TEXT)}\n\n…(truncated)` : text;
}

// -- storage ---------------------------------------------------------------

export async function saveReference(
  oxen: OxenClient,
  view: DraftView,
  conversationId: string,
  reference: StoredReference,
): Promise<void> {
  await oxen.writeWorkspaceFile(
    view.repo,
    view.workspaceId,
    referencePath(conversationId, reference.id),
    JSON.stringify(reference),
  );
}

/** The stored reference, or null when it never existed or a publish pruned it. */
export async function loadReference(
  oxen: OxenClient,
  view: DraftView,
  conversationId: string,
  referenceId: string,
): Promise<StoredReference | null> {
  let raw: string;
  try {
    raw = await oxen.readWorkspaceFile(view.repo, view.workspaceId, referencePath(conversationId, referenceId));
  } catch (err) {
    if (err instanceof OxenError && err.status === 404) return null;
    throw err;
  }
  const parsed = storedReferenceSchema.safeParse(JSON.parse(raw) as unknown);
  return parsed.success ? parsed.data : null;
}

/**
 * Reads references for one conversation. Bound to a conversation at
 * construction so tools only ever name an id — they can't reach across
 * threads, and the agent loop stays free of storage details.
 */
export interface ReferenceLibrary {
  load(referenceId: string): Promise<StoredReference | null>;
  /** Loads several, silently dropping ids that no longer resolve. */
  loadMany(referenceIds: string[]): Promise<StoredReference[]>;
}

export function createReferenceLibrary(
  oxen: OxenClient,
  view: DraftView,
  conversationId: string,
): ReferenceLibrary {
  const load = (referenceId: string) => loadReference(oxen, view, conversationId, referenceId);
  return {
    load,
    async loadMany(referenceIds) {
      const loaded = await Promise.all([...new Set(referenceIds)].map(load));
      return loaded.filter((reference): reference is StoredReference => reference !== null);
    },
  };
}

// -- model serialization ---------------------------------------------------

/**
 * The message parts that carry a reference to the model. Documents and images
 * come first by construction — the provider is explicit that they belong
 * before text — so callers can safely append their own prose after these.
 */
export function referenceContentParts(references: StoredReference[]): LlmContentPart[] {
  const media: LlmContentPart[] = [];
  const text: LlmContentPart[] = [];
  for (const reference of references) {
    if (reference.media === "image" && reference.dataUrl) {
      media.push({ type: "image_url", image_url: { url: reference.dataUrl } });
    } else if (reference.media === "pdf" && reference.dataUrl) {
      media.push({ type: "file", file: { filename: reference.label, file_data: reference.dataUrl } });
    } else if (reference.text) {
      text.push({ type: "text", text: `Reference "${reference.label}" — copy from that page:\n\n${reference.text}` });
    }
  }
  return [...media, ...text];
}

/** The client-safe descriptor stored on the chat message and shown as a chip. */
export function referenceDescriptor(reference: StoredReference): ReferenceContextRef {
  return {
    kind: "reference",
    id: reference.id,
    media: reference.media,
    label: reference.label,
    sourceUrl: reference.sourceUrl,
  };
}

// -- helpers ---------------------------------------------------------------

/** One wording for the size ceiling, wherever it's hit. */
export function uploadTooLargeMessage(): string {
  return `Uploads up to ${Math.round(MAX_UPLOAD_BYTES / 1_000_000)} MB — link to bigger files instead.`;
}

function toDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Filenames become labels and path segments — keep them boring. */
function cleanLabel(filename: string): string {
  return filename
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\w.\-() ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function newReferenceId(): string {
  return `ref_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
