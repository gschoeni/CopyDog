import { z } from "zod";

/**
 * Everything a user can attach to a chat message, in the small client-safe
 * shape that rides on `chat_messages.context` and renders as a chip:
 *
 * - **page** — Cursor-style "Add to chat" from a text selection in the copy
 *   editor, a selection in the rendered wireframe, or a whole section.
 * - **reference** — outside material to build from: an uploaded screenshot or
 *   PDF, or a URL. Only the *descriptor* lives here; the bytes live in the
 *   user's draft workspace (see `references.ts`), keyed by this `id`.
 *
 * Both are stored structured (never inlined into the user's prose) and
 * serialized for the model server-side, so the UI shows a chip while the
 * agent sees exact text, location, and pixels.
 */

export const pageContextRefSchema = z.object({
  kind: z.literal("page"),
  /** Which surface the user selected in. */
  source: z.enum(["copy", "wireframe"]),
  /** Section slug shared by doc.json, data-section-slug, and data-copy; null for loose copy. */
  sectionSlug: z.string().max(80).nullable(),
  /** Human section title at attach time (slugs are opaque in the UI). */
  sectionTitle: z.string().max(120).nullable(),
  /** Verbatim selected text; null attaches the whole section. */
  text: z.string().min(1).max(4000).nullable(),
  /** Wireframe selections: the data-element slot type the selection started in. */
  elementType: z.string().max(40).nullable(),
});

/** How a reference reaches the model: pixels, a document, or extracted prose. */
export const referenceMediaSchema = z.enum(["image", "pdf", "text"]);
export type ReferenceMedia = z.infer<typeof referenceMediaSchema>;

export const referenceContextRefSchema = z.object({
  kind: z.literal("reference"),
  /** Opaque id; resolves to `refs/{conversationId}/{id}.json` in the draft. */
  id: z.string().min(1).max(64),
  media: referenceMediaSchema,
  /** Filename or hostname — what the chip says. */
  label: z.string().min(1).max(120),
  /** Where it came from, when it came from the web. */
  sourceUrl: z.string().max(2000).nullable(),
});

/**
 * Rows written before references existed have no `kind`; they are all page
 * context. Defaulting here keeps every historical message parseable without
 * a data migration (the column is jsonb, so this is the whole migration).
 */
export const chatContextRefSchema = z.preprocess(
  (value) =>
    value !== null && typeof value === "object" && !("kind" in value) ? { ...value, kind: "page" } : value,
  z.discriminatedUnion("kind", [pageContextRefSchema, referenceContextRefSchema]),
);

export type PageContextRef = z.infer<typeof pageContextRefSchema>;
export type ReferenceContextRef = z.infer<typeof referenceContextRefSchema>;
export type ChatContextRef = z.infer<typeof chatContextRefSchema>;

/** At most this many page selections ride along with one message. */
export const MAX_CONTEXT_REFS = 8;
/** References are heavy (pixels, documents) — a tighter cap than selections. */
export const MAX_REFERENCE_REFS = 4;

export const chatContextListSchema = z
  .array(chatContextRefSchema)
  .max(MAX_CONTEXT_REFS + MAX_REFERENCE_REFS)
  .superRefine((refs, ctx) => {
    const counts = { page: 0, reference: 0 };
    for (const ref of refs) counts[ref.kind]++;
    if (counts.page > MAX_CONTEXT_REFS) {
      ctx.addIssue({ code: "custom", message: `At most ${MAX_CONTEXT_REFS} page selections per message.` });
    }
    if (counts.reference > MAX_REFERENCE_REFS) {
      ctx.addIssue({ code: "custom", message: `At most ${MAX_REFERENCE_REFS} references per message.` });
    }
  });

export function isReferenceRef(ref: ChatContextRef): ref is ReferenceContextRef {
  return ref.kind === "reference";
}

// -- upload constraints ----------------------------------------------------
// Shared by the composer (which enforces them before spending a round trip)
// and the route (which enforces them for real).

export const UPLOAD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const UPLOAD_PDF_TYPE = "application/pdf";
/** The `accept` attribute for the composer's file picker. */
export const UPLOAD_ACCEPT = [...UPLOAD_IMAGE_TYPES, UPLOAD_PDF_TYPE].join(",");

/**
 * The ceiling is the inference API's, not our transport's: files reach Oxen
 * in chunks (see `references/upload`), so nothing here is bounded by a
 * request-body limit. 24 MB is the documented maximum for a document; images
 * get a saner cap because a 10 MB screenshot is already enormous.
 */
export const UPLOAD_LIMITS: Record<Extract<ReferenceMedia, "image" | "pdf">, number> = {
  image: 10_000_000,
  pdf: 24_000_000,
};

/**
 * Bytes per upload chunk. Comfortably under the 4.5 MB request-body limit a
 * Vercel route handler enforces, and far under Oxen's 10 MiB segment size.
 */
export const UPLOAD_CHUNK_BYTES = 3_500_000;

export function uploadMedia(mime: string): Extract<ReferenceMedia, "image" | "pdf"> | null {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  if ((UPLOAD_IMAGE_TYPES as readonly string[]).includes(type)) return "image";
  if (type === UPLOAD_PDF_TYPE) return "pdf";
  return null;
}

/** The one wording for "too big", wherever it's hit. */
export function tooLargeMessage(media: Extract<ReferenceMedia, "image" | "pdf">): string {
  return `${media === "pdf" ? "PDFs" : "Images"} up to ${Math.round(UPLOAD_LIMITS[media] / 1_000_000)} MB.`;
}

/** Short chip label: the section title or reference name, else a source fallback. */
export function contextRefLabel(ref: ChatContextRef): string {
  if (ref.kind === "reference") return ref.label;
  if (ref.sectionTitle) return ref.sectionTitle;
  if (ref.sectionSlug) return ref.sectionSlug;
  return ref.source === "wireframe" ? "Wireframe selection" : "Copy selection";
}

function describePageRef(ref: PageContextRef): string {
  const where =
    ref.sectionSlug === null
      ? "loose copy outside any section"
      : `the "${ref.sectionTitle ?? ref.sectionSlug}" section (slug: ${ref.sectionSlug})`;
  const surface = ref.source === "wireframe" ? "the wireframe" : "the copy editor";
  if (ref.text === null) {
    return `The whole ${where.replace(/^the /, "")} — attached from ${surface}.`;
  }
  const slot = ref.elementType ? `, inside a "${ref.elementType}" element` : "";
  return `Selected in ${surface}, from ${where}${slot}:\n"""\n${ref.text}\n"""`;
}

const MEDIA_NOUN: Record<ReferenceMedia, string> = {
  image: "image",
  pdf: "PDF document",
  text: "web page",
};

function describeReferenceRef(ref: ReferenceContextRef): string {
  const origin = ref.sourceUrl ? ` from ${ref.sourceUrl}` : "";
  return `"${ref.label}" — a ${MEDIA_NOUN[ref.media]}${origin}. Reference id: ${ref.id}`;
}

/**
 * The model-facing rendering of a message's attachments. Prepended to the
 * user's message server-side — the transcript UI shows chips instead. The
 * reference *content* travels as real image/document parts alongside this
 * text; what's listed here is the roster of ids, so a later turn can name one
 * in `read_reference` or a design tool.
 */
export function describeContextRefs(refs: ChatContextRef[]): string {
  const pageRefs = refs.filter((ref): ref is PageContextRef => ref.kind === "page");
  const referenceRefs = refs.filter(isReferenceRef);
  const blocks: string[] = [];

  if (pageRefs.length > 0) {
    blocks.push(
      [
        "The user attached page context to this message — it is exactly what they are referring to. Prefer these sections/elements as the target of edits.",
        ...pageRefs.map((ref, i) => `${i + 1}. ${describePageRef(ref)}`),
      ].join("\n"),
    );
  }

  if (referenceRefs.length > 0) {
    blocks.push(
      [
        "The user attached reference material to this message — outside inspiration to design and write from, not content to copy verbatim.",
        ...referenceRefs.map((ref, i) => `${i + 1}. ${describeReferenceRef(ref)}`),
        "Pass these ids to design_section / redesign_page so the designer sees them, or call read_reference to look again yourself.",
      ].join("\n"),
    );
  }

  return blocks.join("\n\n");
}
