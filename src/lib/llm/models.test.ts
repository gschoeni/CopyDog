import { afterEach, describe, expect, it } from "vitest";

import { hasVisualParts, modelFor, modelForLayout } from "./models";

const ENV_KEYS = ["LLM_MODEL_COPY", "LLM_MODEL_WIREFRAME", "LLM_MODEL_WIREFRAME_REFERENCE", "LLM_MODEL_VISION"];
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("modelFor", () => {
  it("gives each task its own default", () => {
    expect(modelFor("copy")).toBe("claude-sonnet-4-6");
    expect(modelFor("wireframe")).toBe("claude-sonnet-4-6");
    expect(modelFor("wireframeFromReference")).toBe("gemini-3-1-pro-preview");
    expect(modelFor("vision")).toBe("gemini-3-1-pro-preview");
  });

  it("lets one task be swapped by environment without touching the others", () => {
    process.env.LLM_MODEL_WIREFRAME_REFERENCE = "gemini-3-flash-preview";
    expect(modelFor("wireframeFromReference")).toBe("gemini-3-flash-preview");
    expect(modelFor("wireframe")).toBe("claude-sonnet-4-6");
  });

  it("ignores an override that is blank", () => {
    process.env.LLM_MODEL_COPY = "   ";
    expect(modelFor("copy")).toBe("claude-sonnet-4-6");
  });
});

describe("modelForLayout", () => {
  const image = { type: "image_url" as const, image_url: { url: "data:image/png;base64,AA" } };
  const pdf = { type: "file" as const, file: { filename: "a.pdf", file_data: "data:application/pdf;base64,AA" } };
  const text = { type: "text" as const, text: "copy from that page" };

  it("routes anything with a picture in it to the vision model", () => {
    // Anthropic refuses an image over 8000px in a dimension, which is most
    // full-page Figma exports; Gemini reads them. See models.ts for the run.
    expect(modelForLayout([image])).toBe("gemini-3-1-pro-preview");
    expect(modelForLayout([pdf])).toBe("gemini-3-1-pro-preview");
    expect(modelForLayout([image, text])).toBe("gemini-3-1-pro-preview");
  });

  it("keeps text-only work — a fetched page, or no reference — on the layout model", () => {
    // A URL reference arrives as extracted copy, so it needs a strong code
    // model, not a strong vision model.
    expect(modelForLayout([text])).toBe("claude-sonnet-4-6");
    expect(modelForLayout(undefined)).toBe("claude-sonnet-4-6");
    expect(modelForLayout([])).toBe("claude-sonnet-4-6");
  });

  it("follows the override for the route it picked", () => {
    process.env.LLM_MODEL_WIREFRAME_REFERENCE = "gpt-5-5-2026-04-23";
    expect(modelForLayout([image])).toBe("gpt-5-5-2026-04-23");
    expect(modelForLayout([text])).toBe("claude-sonnet-4-6");
  });
});

describe("hasVisualParts", () => {
  it("distinguishes something to look at from something to read", () => {
    expect(hasVisualParts([{ type: "text", text: "x" }])).toBe(false);
    expect(hasVisualParts([{ type: "image_url", image_url: { url: "x" } }])).toBe(true);
    expect(hasVisualParts([{ type: "file", file: { file_data: "x" } }])).toBe(true);
    expect(hasVisualParts(undefined)).toBe(false);
  });
});
