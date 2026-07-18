import { z } from "zod";

/**
 * Page context the user attaches to a chat message — Cursor-style "Add to
 * chat" from a text selection in the copy editor, a text selection in the
 * rendered wireframe, or a whole wireframe section. Stored structured on
 * the user's chat message (never inlined into their prose) and serialized
 * for the model server-side, so the UI shows a chip while the agent sees
 * exact text + location.
 */

export const chatContextRefSchema = z.object({
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

export type ChatContextRef = z.infer<typeof chatContextRefSchema>;

/** At most this many attachments ride along with one message. */
export const MAX_CONTEXT_REFS = 8;

export const chatContextListSchema = z.array(chatContextRefSchema).max(MAX_CONTEXT_REFS);

/** Short chip label for the UI: the section title, else a source fallback. */
export function contextRefLabel(ref: ChatContextRef): string {
  if (ref.sectionTitle) return ref.sectionTitle;
  if (ref.sectionSlug) return ref.sectionSlug;
  return ref.source === "wireframe" ? "Wireframe selection" : "Copy selection";
}

function describeContextRef(ref: ChatContextRef): string {
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

/**
 * The model-facing rendering of a message's attachments. Prepended to the
 * user's message server-side — the transcript UI shows chips instead.
 */
export function describeContextRefs(refs: ChatContextRef[]): string {
  if (refs.length === 0) return "";
  const items = refs.map((ref, i) => `${i + 1}. ${describeContextRef(ref)}`);
  return [
    "The user attached page context to this message — it is exactly what they are referring to. Prefer these sections/elements as the target of edits.",
    ...items,
  ].join("\n");
}
