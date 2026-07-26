import { describe, expect, it } from "vitest";

import { WIREFRAME_CSS } from "./design-system-css";
import { referenceNote } from "./references";
import { DESIGN_SYSTEM_SPEC } from "./spec";

/**
 * The note is wrapped prose, so a phrase can straddle a line break. Match
 * against a flattened copy — re-wrapping the prompt shouldn't fail a test.
 */
const flatten = (text: string) => text.replace(/\s+/g, " ");

const PAGE_NOTE = flatten(referenceNote([{ type: "text", text: "x" }], "page"));
const SECTION_NOTE = flatten(referenceNote([{ type: "text", text: "x" }], "section"));

describe("referenceNote", () => {
  it("says nothing when no reference is attached", () => {
    expect(referenceNote(undefined)).toBe("");
    expect(referenceNote([])).toBe("");
  });

  it("asks the designer to study the reference before writing HTML", () => {
    expect(PAGE_NOTE).toMatch(/study it before you write any HTML/i);
    expect(PAGE_NOTE).toMatch(/reproduce that structure exactly/i);
  });

  it("names a placeholder for every kind of imagery a reference can hold", () => {
    // Imagery is structure: a split hero that loses its media becomes a
    // centred one, and the layout stops matching.
    for (const placeholder of ["wf-media", "wf-avatar", "wf-logo-box", "wf-input", "wf-pill"]) {
      expect(PAGE_NOTE).toContain(placeholder);
    }
    expect(PAGE_NOTE).toMatch(/count the images/i);
  });

  it("overrides the spec's own instruction to vary patterns", () => {
    // The spec tells the designer to mix patterns and never repeat one twice
    // in a row. That's right when inventing a page and wrong when reproducing
    // one — so the note has to say which wins, or the model splits the
    // difference and the layout drifts from the reference.
    expect(DESIGN_SYSTEM_SPEC).toMatch(/never the same pattern twice in a row/i);
    expect(PAGE_NOTE).toMatch(/overrides/i);
    expect(PAGE_NOTE).toMatch(/three split sections in a row, so do you/i);
  });

  it("still refuses to take the reference's words or branding", () => {
    expect(PAGE_NOTE).toMatch(/never transcribe/i);
    expect(PAGE_NOTE).toMatch(/greyscale/i);
  });

  it("keeps a pure-imagery band from becoming an invented section", () => {
    // Every section must come from the copy — the acceptance gate enforces it —
    // so the reference's image-only band has to land on a neighbour instead.
    expect(PAGE_NOTE).toMatch(/cannot invent a section/i);
    expect(PAGE_NOTE).toMatch(/neighbouring section/i);
  });

  it("scopes the instruction to the whole page or to one band", () => {
    expect(PAGE_NOTE).toMatch(/band by band, in order/i);
    expect(SECTION_NOTE).toMatch(/ignore the rest of the reference/i);
    expect(SECTION_NOTE).not.toMatch(/band by band, in order/i);
  });

  it("only names classes the designer is allowed to use and the CSS can render", () => {
    // Telling the model to emit a class the spec doesn't list, or that has no
    // CSS behind it, produces a layout that validates and renders as nothing.
    const named = [...new Set(PAGE_NOTE.match(/wf-[a-z0-9-]+/g) ?? [])];
    expect(named.length).toBeGreaterThan(5);
    for (const className of named) {
      expect(DESIGN_SYSTEM_SPEC, `${className} is not in the spec's allowlist`).toContain(className);
      expect(WIREFRAME_CSS, `${className} has no CSS`).toContain(`.${className}`);
    }
  });
});
