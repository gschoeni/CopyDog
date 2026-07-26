import type { LlmContentPart } from "./client";

/**
 * Which model does which job.
 *
 * The tasks differ enough that one model is the wrong answer for all of them:
 * the chat agent is a tool-calling loop, page layout is a code-generation
 * task, and reading a design someone exported from Figma is a vision task on
 * an image with a punishing aspect ratio. Each entry can be overridden by an
 * environment variable, so a model can be swapped in production without a
 * deploy.
 *
 * Measured on a synthetic 7-band landing page rendered at several aspect
 * ratios and read back band-by-band (layout type, column count, which side
 * the media sits on):
 *
 * | page shape      | claude-sonnet-4-6 | gemini-3-1-pro | gemini-3-flash |
 * |-----------------|-------------------|----------------|----------------|
 * | 1440x3990 (1:3) | 7/7               | 7/7            | 7/7            |
 * | 1440x7770 (1:5) | 7/7               | 7/7            | 7/7            |
 * | 1440x13090(1:9) | **HTTP 400**      | 7/7            | 7/7            |
 * | 1440x22890(1:16)| **HTTP 400**      | 7/7            | 7/7            |
 *
 * Anthropic refuses an image whose dimension exceeds 8000px, which is most of
 * what "export this page from Figma" produces — and the failure was invisible,
 * because the layout pipeline falls back to the rule-based generator on any
 * error. The user got a generic wireframe and no explanation. Gemini reads
 * those exports natively, so anything carrying a picture routes there.
 *
 * Also measured, and rejected: slicing a tall export into overlapping tiles
 * with a low-res overview, which is the usual advice for dense documents. It
 * made every model *worse* here (0–3/7 versus 7/7 whole) — a page is one
 * continuous layout, and cutting it up destroys exactly the vertical rhythm
 * the designer is supposed to reproduce.
 */

export type LlmTask =
  /** The chat agent's own loop: tool calling, narration, judgement. */
  | "copy"
  /** Page and section layout from copy alone — a code-generation task. */
  | "wireframe"
  /** Layout with a design attached: read the reference, then reproduce it. */
  | "wireframeFromReference"
  /** Pulling structure out of a screenshot or document (page import). */
  | "vision";

const DEFAULTS: Record<LlmTask, string> = {
  copy: "claude-sonnet-4-6",
  wireframe: "claude-sonnet-4-6",
  wireframeFromReference: "gemini-3-1-pro-preview",
  vision: "gemini-3-1-pro-preview",
};

const ENV_KEYS: Record<LlmTask, string> = {
  copy: "LLM_MODEL_COPY",
  wireframe: "LLM_MODEL_WIREFRAME",
  wireframeFromReference: "LLM_MODEL_WIREFRAME_REFERENCE",
  vision: "LLM_MODEL_VISION",
};

/** The model for a task, honouring its environment override. */
export function modelFor(task: LlmTask): string {
  return process.env[ENV_KEYS[task]]?.trim() || DEFAULTS[task];
}

/**
 * True when a message carries something to *look at* rather than read. Text
 * extracted from a fetched web page is a reference too, but it needs a strong
 * code model, not a strong vision model — so the routing turns on this, not
 * on "was a reference attached".
 */
export function hasVisualParts(parts: LlmContentPart[] | undefined): boolean {
  return parts?.some((part) => part.type === "image_url" || part.type === "file") ?? false;
}

/** The layout model to use given whatever reference material came along. */
export function modelForLayout(references: LlmContentPart[] | undefined): string {
  return modelFor(hasVisualParts(references) ? "wireframeFromReference" : "wireframe");
}
