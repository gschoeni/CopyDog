import { z } from "zod";

import { referenceBlobPath, referencePath } from "@/lib/content/site";
import type { DraftView } from "@/lib/content/store";
import { serializeElements } from "@/lib/copy/markdown";
import { extractSectionsFromHtml } from "@/lib/import/extract";
import { fetchImportResource, ImportFetchError } from "@/lib/import/fetch-url";
import { outlineHtmlStructure } from "@/lib/import/outline";
import type { LlmContentPart } from "@/lib/llm/client";
import { OxenError, type OxenClient } from "@/lib/oxen/client";

import { UPLOAD_LIMITS, tooLargeMessage, uploadMedia, type ReferenceContextRef } from "./context";

/**
 * Reference material the user attaches to the assistant: a screenshot, a PDF,
 * or a URL to build a page from. Everything resolves at attach time into one
 * of three shapes the inference API understands — pixels, a document, or
 * extracted prose — so the rest of the system never branches on "was this a
 * file or a link".
 *
 * Storage, per reference, in the user's draft workspace:
 *   refs/{conversationId}/{id}.json      the manifest (metadata, below)
 *   refs/{conversationId}/{id}/{file}    the bytes, for images and PDFs
 *
 * Bytes are a real file rather than base64 inside the manifest, because
 * that's what lets an arbitrarily large upload arrive in chunks (Oxen
 * assembles them) and what will let us hand the model a presigned URL
 * instead of 30 MB of base64 once workspaces can be presigned.
 *
 * Nothing here is ever committed: `publishDraft` unstages the whole refs/
 * prefix and `hasUnpublishedChanges` ignores it, so reference material is
 * private scratch input that never enters the site's history.
 */

/** Extracted page copy is truncated here — a reference, not an archive. */
const MAX_REFERENCE_TEXT = 60_000;

export const storedReferenceSchema = z.object({
  version: z.literal(2),
  id: z.string().min(1).max(64),
  media: z.enum(["image", "pdf", "text"]),
  label: z.string().min(1).max(120),
  mime: z.string().max(120),
  byteSize: z.number().int().nonnegative(),
  sourceUrl: z.string().max(2000).nullable(),
  /** image / pdf: workspace path of the bytes. */
  blobPath: z.string().max(400).nullable(),
  /** text: copy extracted from a fetched HTML page. */
  text: z.string().nullable(),
});

export type StoredReference = z.infer<typeof storedReferenceSchema>;

/** A reference the user attached was rejected — the message is user-facing. */
export class ReferenceAttachError extends Error {}

/** What the browser must tell us to turn uploaded chunks into a reference. */
export const uploadManifestSchema = z.object({
  /** XXH3-128 of the whole file — Oxen verifies the reassembled bytes against it. */
  hash: z.string().regex(/^[0-9a-f]{1,32}$/, "not a version hash"),
  filename: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  byteSize: z.number().int().positive(),
  numChunks: z.number().int().positive().max(1000),
});

export type UploadManifest = z.infer<typeof uploadManifestSchema>;

// -- ingestion -------------------------------------------------------------

/**
 * Checks an upload before a single byte moves. The browser calls the same
 * limits from `context.ts`, so this is the backstop rather than the first
 * line of defence — but it's the one that counts.
 */
export function assertUploadable(upload: { mime: string; byteSize: number }): {
  media: "image" | "pdf";
} {
  const media = uploadMedia(upload.mime);
  if (media === null) throw new ReferenceAttachError("Attach a PNG, JPG, WEBP, GIF, or PDF.");
  if (upload.byteSize <= 0) throw new ReferenceAttachError("That file is empty.");
  if (upload.byteSize > UPLOAD_LIMITS[media]) throw new ReferenceAttachError(tooLargeMessage(media));
  return { media };
}

/**
 * Finishes a chunked upload: asks Oxen to reassemble the chunks and stage the
 * file into this conversation's reference directory, then writes the manifest
 * beside it. The reassembly is where a corrupt or truncated upload dies —
 * Oxen re-hashes the bytes and rejects anything that doesn't match `hash`.
 */
export async function saveUploadedReference(
  oxen: OxenClient,
  view: DraftView,
  conversationId: string,
  upload: UploadManifest,
): Promise<StoredReference> {
  const { media } = assertUploadable(upload);
  const id = newReferenceId();
  const fileName = blobFileName(upload.filename, media);

  try {
    await oxen.completeVersionUpload(view.repo, upload.hash, {
      fileName,
      dstDir: referenceBlobPath(conversationId, id, ""),
      numChunks: upload.numChunks,
      workspaceId: view.workspaceId,
    });
  } catch (err) {
    // the usual causes are a missing chunk or bytes that don't match the hash
    throw err instanceof OxenError
      ? new ReferenceAttachError("That upload didn't arrive intact — please try again.")
      : err;
  }

  const reference: StoredReference = {
    version: 2,
    id,
    media,
    label: cleanLabel(upload.filename) || (media === "pdf" ? "document.pdf" : "image"),
    mime: upload.mime.split(";")[0]!.trim().toLowerCase(),
    byteSize: upload.byteSize,
    sourceUrl: null,
    blobPath: referenceBlobPath(conversationId, id, fileName),
    text: null,
  };
  await writeManifest(oxen, view, conversationId, reference);
  return reference;
}

/**
 * Fetches a URL and stores it as a reference: an HTML page becomes extracted
 * copy (deterministically — no inference key needed to attach), an image or
 * PDF becomes bytes the model can look at. No chunking here; the bytes never
 * cross a browser-facing request.
 */
export async function saveUrlReference(
  oxen: OxenClient,
  view: DraftView,
  conversationId: string,
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
  const id = newReferenceId();
  const base = {
    version: 2 as const,
    id,
    byteSize: resource.bytes.byteLength,
    mime: resource.contentType,
    sourceUrl: url.toString(),
  };

  let reference: StoredReference;
  if (resource.kind === "html") {
    const text = extractedCopy(new TextDecoder().decode(resource.bytes));
    if (!text) throw new ReferenceAttachError("No copy found on that page — is it a content page?");
    reference = { ...base, media: "text", label: url.hostname.replace(/^www\./, ""), blobPath: null, text };
  } else {
    if (resource.bytes.byteLength > UPLOAD_LIMITS[resource.kind]) {
      throw new ReferenceAttachError(tooLargeMessage(resource.kind));
    }
    const label = cleanLabel(decodeURIComponent(url.pathname.split("/").pop() ?? "")) || url.hostname;
    const fileName = blobFileName(label, resource.kind);
    const blobPath = referenceBlobPath(conversationId, id, fileName);
    await oxen.writeWorkspaceFile(
      view.repo,
      view.workspaceId,
      blobPath,
      new Blob([resource.bytes as BlobPart], { type: resource.contentType }),
    );
    reference = { ...base, media: resource.kind, label, blobPath, text: null };
  }

  await writeManifest(oxen, view, conversationId, reference);
  return reference;
}

/**
 * What we keep from a fetched page: its copy *and* its structure.
 *
 * A URL is the one reference we don't need eyes for — the markup states the
 * band order, the repeat counts, and whether the picture leads or follows,
 * which a screenshot only implies. Sending both means the designer can match
 * the layout from a link, which it could not do when we kept the copy alone.
 */
function extractedCopy(html: string): string {
  const copy = extractSectionsFromHtml(html)
    .map((section) => `## ${section.title}\n\n${serializeElements(section.elements)}`)
    .join("\n\n")
    .trim();
  if (!copy) return "";

  const outline = outlineHtmlStructure(html);
  const text = outline ? `${outline}\n\nIts copy:\n\n${copy}` : copy;
  return text.length > MAX_REFERENCE_TEXT ? `${text.slice(0, MAX_REFERENCE_TEXT)}\n\n…(truncated)` : text;
}

// -- storage ---------------------------------------------------------------

async function writeManifest(
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

/**
 * Reads reference material for one conversation and renders it for the model.
 * Bound to a conversation at construction, so tools only ever name an id —
 * they can't reach across threads, and the agent loop stays free of storage.
 */
export interface ReferenceLibrary {
  load(referenceId: string): Promise<StoredReference | null>;
  /** Loads several, silently dropping ids that no longer resolve. */
  loadMany(referenceIds: string[]): Promise<StoredReference[]>;
  /**
   * The message parts that carry these references to the model. Documents and
   * images come first by construction — the provider is explicit that they
   * belong before text — so callers can append their own prose after.
   */
  contentParts(references: StoredReference[]): Promise<LlmContentPart[]>;
}

export function createReferenceLibrary(
  oxen: OxenClient,
  view: DraftView,
  conversationId: string,
): ReferenceLibrary {
  const load = async (referenceId: string): Promise<StoredReference | null> => {
    let raw: string;
    try {
      raw = await oxen.readWorkspaceFile(view.repo, view.workspaceId, referencePath(conversationId, referenceId));
    } catch (err) {
      if (err instanceof OxenError && err.status === 404) return null;
      throw err;
    }
    const parsed = storedReferenceSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  };

  return {
    load,
    async loadMany(referenceIds) {
      const loaded = await Promise.all([...new Set(referenceIds)].map(load));
      return loaded.filter((reference): reference is StoredReference => reference !== null);
    },

    async contentParts(references) {
      const media: LlmContentPart[] = [];
      const text: LlmContentPart[] = [];
      for (const reference of references) {
        if (reference.media === "text") {
          if (reference.text) {
            text.push({
              type: "text",
              text: `Reference "${reference.label}" — copy from that page:\n\n${reference.text}`,
            });
          }
          continue;
        }
        if (!reference.blobPath) continue;

        // Bytes travel inline as a data URL. The alternative — handing the API
        // a presigned URL and skipping this read entirely — needs Oxen to
        // presign *workspace* files; today it only presigns committed
        // revisions, and our references are deliberately never committed.
        // When that lands, this is the one place that changes.
        const bytes = await oxen
          .readWorkspaceFileBytes(view.repo, view.workspaceId, reference.blobPath)
          .catch(() => null);
        if (!bytes) continue;
        const dataUrl = `data:${reference.mime};base64,${Buffer.from(bytes).toString("base64")}`;
        if (reference.media === "image") {
          media.push({ type: "image_url", image_url: { url: dataUrl } });
        } else {
          media.push({ type: "file", file: { filename: reference.label, file_data: dataUrl } });
        }
      }
      return [...media, ...text];
    },
  };
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

/** Filenames become labels — keep them boring, and never a path. */
function cleanLabel(filename: string): string {
  return filename
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\w.\-() ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** A path segment: the label with anything awkward flattened out. */
function blobFileName(filename: string, media: "image" | "pdf"): string {
  const cleaned = cleanLabel(filename).replace(/[()\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || (media === "pdf" ? "document.pdf" : "image.png");
}

function newReferenceId(): string {
  return `ref_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
