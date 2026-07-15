import { z } from "zod";

import { docSections } from "@/lib/content/doc";
import {
  readDoc,
  readSectionVersion,
  readWireframe,
  writeDoc,
  writeSectionVersion,
  writeWireframe,
  type DraftView,
} from "@/lib/content/store";
import { parseElementsMarkdown } from "@/lib/copy/markdown";
import type { LlmClient, LlmTool } from "@/lib/llm/client";
import type { OxenClient } from "@/lib/oxen/client";
import { generateSectionLayout, listWireframeSections, upsertWireframeSection } from "@/lib/wireframe/edit";
import { generateWireframe, LlmGenerator, HeuristicGenerator } from "@/lib/wireframe/generate";
import type { SectionForLayout } from "@/lib/wireframe/heuristic";

/**
 * The agent's hands. Every tool operates on the calling user's draft view —
 * agent edits are exactly like the user's own edits: staged, private,
 * publishable. The agent can never touch main.
 */

export interface ToolContext {
  oxen: OxenClient;
  view: DraftView;
  pageSlug: string;
  llm: LlmClient;
}

export interface ToolOutcome {
  result: string;
  mutated: boolean;
}

export const AGENT_TOOLS: LlmTool[] = [
  {
    type: "function",
    function: {
      name: "rewrite_section",
      description:
        "Create a new version of a section's copy and make it active in the user's draft. Use for rewrites, tone changes, tightening, or brainstormed alternatives. The original version is preserved.",
      parameters: {
        type: "object",
        properties: {
          sectionSlug: { type: "string", description: "slug of the section to rewrite" },
          label: { type: "string", description: "short human label for the new version, e.g. 'Punchier'" },
          markdown: {
            type: "string",
            description:
              "the full new section copy as markdown: # h1-###### h6, paragraphs, - bullets, 1. numbered lists, [CTA label](url) on its own line for buttons, <!--eyebrow--> line before a short overline",
          },
        },
        required: ["sectionSlug", "label", "markdown"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_section",
      description:
        "Add a new copy section to the page with initial markdown copy. It won't appear in the wireframe until design_section lays it out — call that next when the user wants it visible.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "section title, e.g. 'Testimonials'" },
          markdown: { type: "string", description: "initial copy for the section (same markdown dialect)" },
        },
        required: ["title", "markdown"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "design_section",
      description:
        "Redesign (or first lay out) ONE section of the wireframe per an instruction — e.g. 'make the hero a split with the image left', 'turn these features into a 3-up card grid'. Every other section keeps its current layout. Prefer this over redesign_page for anything section-scoped.",
      parameters: {
        type: "object",
        properties: {
          sectionSlug: { type: "string", description: "slug of the copy section whose layout changes" },
          instruction: {
            type: "string",
            description: "what the section's layout should become; mention the design-system pattern when you have one in mind",
          },
        },
        required: ["sectionSlug", "instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "redesign_page",
      description:
        "Redesign the whole page's wireframe per an instruction (e.g. 'more visual rhythm, alternate tinted bands', 'lay the whole page out for the first time'). Starts from the current wireframe when one exists. Copy is untouched; the layout regenerates around it.",
      parameters: {
        type: "object",
        properties: {
          instruction: { type: "string", description: "page-level layout direction to apply" },
        },
        required: ["instruction"],
      },
    },
  },
];

const rewriteArgs = z.object({ sectionSlug: z.string(), label: z.string().min(1).max(60), markdown: z.string().max(50_000) });
const addArgs = z.object({ title: z.string().min(1).max(80), markdown: z.string().max(50_000) });
const designArgs = z.object({ sectionSlug: z.string(), instruction: z.string().min(1).max(2000) });
const redesignArgs = z.object({ instruction: z.string().min(1).max(2000) });

export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case "rewrite_section":
      return rewriteSection(rewriteArgs.parse(JSON.parse(rawArgs)), ctx);
    case "add_section":
      return addSection(addArgs.parse(JSON.parse(rawArgs)), ctx);
    case "design_section":
      return designSection(designArgs.parse(JSON.parse(rawArgs)), ctx);
    case "redesign_page":
      return redesignPage(redesignArgs.parse(JSON.parse(rawArgs)), ctx);
    default:
      return { result: `Unknown tool: ${name}`, mutated: false };
  }
}

/** A short human-facing label for what a tool call is doing, for live status UI. */
export function toolActivityLabel(name: string, rawArgs: string): string {
  const args = safeParse(rawArgs);
  switch (name) {
    case "rewrite_section":
      return `Rewriting ${String(args.sectionSlug ?? "a section")}…`;
    case "add_section":
      return `Adding section "${String(args.title ?? "…")}"…`;
    case "design_section":
      return `Designing ${String(args.sectionSlug ?? "a section")}…`;
    case "redesign_page":
      return "Redesigning the page layout…";
    default:
      return "Working…";
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function rewriteSection(args: z.infer<typeof rewriteArgs>, ctx: ToolContext): Promise<ToolOutcome> {
  const doc = await readDoc(ctx.oxen, ctx.view, ctx.pageSlug);
  const section = docSections(doc).find((s) => s.slug === args.sectionSlug);
  if (!section) {
    return { result: `No section with slug "${args.sectionSlug}" on this page.`, mutated: false };
  }

  const base =
    args.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent";
  let slug = base;
  for (let n = 2; section.versions.some((v) => v.slug === slug); n++) slug = `${base}-${n}`;

  await writeSectionVersion(ctx.oxen, ctx.view, ctx.pageSlug, section.slug, slug, args.markdown);
  section.versions.push({ slug, label: args.label });
  section.activeVersion = slug;
  await writeDoc(ctx.oxen, ctx.view, ctx.pageSlug, doc);

  return { result: `Created version "${args.label}" for section "${section.title}" and made it active.`, mutated: true };
}

async function addSection(args: z.infer<typeof addArgs>, ctx: ToolContext): Promise<ToolOutcome> {
  const doc = await readDoc(ctx.oxen, ctx.view, ctx.pageSlug);
  const base =
    args.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "section";
  let slug = base;
  for (let n = 2; docSections(doc).some((s) => s.slug === slug); n++) slug = `${base}-${n}`;

  await writeSectionVersion(ctx.oxen, ctx.view, ctx.pageSlug, slug, "original", args.markdown);
  doc.content.push({
    kind: "section",
    slug,
    title: args.title,
    activeVersion: "original",
    versions: [{ slug: "original", label: "Original" }],
    linked: true,
  });
  await writeDoc(ctx.oxen, ctx.view, ctx.pageSlug, doc);

  return { result: `Added section "${args.title}" (${slug}).`, mutated: true };
}

async function designSection(args: z.infer<typeof designArgs>, ctx: ToolContext): Promise<ToolOutcome> {
  const doc = await readDoc(ctx.oxen, ctx.view, ctx.pageSlug);
  const section = docSections(doc).find((s) => s.slug === args.sectionSlug);
  if (!section) {
    return { result: `No section with slug "${args.sectionSlug}" on this page.`, mutated: false };
  }

  // designing a section is an explicit "put this in the wireframe"
  let relinked = false;
  if (!section.linked) {
    section.linked = true;
    await writeDoc(ctx.oxen, ctx.view, ctx.pageSlug, doc);
    relinked = true;
  }

  const forLayout: SectionForLayout = {
    slug: section.slug,
    title: section.title,
    elements: parseElementsMarkdown(
      (await readSectionVersion(ctx.oxen, ctx.view, ctx.pageSlug, section.slug, section.activeVersion)) ?? "",
    ),
  };

  const wireframe = (await readWireframe(ctx.oxen, ctx.view, ctx.pageSlug)) ?? "";
  const current = listWireframeSections(wireframe).find((s) => s.slug === section.slug)?.html;

  const sectionHtml = await generateSectionLayout(ctx.llm, forLayout, {
    instruction: args.instruction,
    currentHtml: current,
  });

  const docOrder = docSections(doc)
    .filter((s) => s.linked)
    .map((s) => s.slug);
  await writeWireframe(ctx.oxen, ctx.view, ctx.pageSlug, upsertWireframeSection(wireframe, section.slug, sectionHtml, docOrder));

  const note = relinked ? " (it was unlinked — I linked it back into the wireframe)" : "";
  return {
    result: `Redesigned the "${section.title}" section${note}: ${args.instruction}\n\nIts layout is now:\n${sectionHtml}`,
    mutated: true,
  };
}

async function redesignPage(args: z.infer<typeof redesignArgs>, ctx: ToolContext): Promise<ToolOutcome> {
  const doc = await readDoc(ctx.oxen, ctx.view, ctx.pageSlug);
  const sections = await Promise.all(
    docSections(doc)
      .filter((section) => section.linked)
      .map(async (section) => ({
        slug: section.slug,
        title: section.title,
        elements: parseElementsMarkdown(
          (await readSectionVersion(ctx.oxen, ctx.view, ctx.pageSlug, section.slug, section.activeVersion)) ?? "",
        ),
      })),
  );
  if (sections.length === 0) {
    return {
      result: "The page has no linked sections to lay out — add sections (add_section) before designing the page.",
      mutated: false,
    };
  }

  const currentHtml = (await readWireframe(ctx.oxen, ctx.view, ctx.pageSlug)) || undefined;
  const html = await generateWireframe(
    [new LlmGenerator(ctx.llm, { instruction: args.instruction, currentHtml }), new HeuristicGenerator()],
    sections,
  );
  await writeWireframe(ctx.oxen, ctx.view, ctx.pageSlug, html);

  return { result: `Redesigned the wireframe: ${args.instruction}`, mutated: true };
}
