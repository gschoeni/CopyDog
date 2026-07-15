import { z } from "zod";

import { docSections } from "@/lib/content/doc";
import { readDoc, readSectionVersion, writeDoc, writeSectionVersion, writeWireframe, type DraftView } from "@/lib/content/store";
import { parseElementsMarkdown } from "@/lib/copy/markdown";
import type { LlmClient, LlmTool } from "@/lib/llm/client";
import type { OxenClient } from "@/lib/oxen/client";
import { generateWireframe, LlmGenerator, HeuristicGenerator } from "@/lib/wireframe/generate";

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
      description: "Add a new copy section to the page with initial markdown copy.",
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
      name: "update_wireframe",
      description:
        "Redesign the page's wireframe layout per an instruction (e.g. 'make the hero two-column', 'add a three-up feature grid'). Copy is untouched; the layout regenerates around it.",
      parameters: {
        type: "object",
        properties: {
          instruction: { type: "string", description: "layout instruction to apply" },
        },
        required: ["instruction"],
      },
    },
  },
];

const rewriteArgs = z.object({ sectionSlug: z.string(), label: z.string().min(1).max(60), markdown: z.string().max(50_000) });
const addArgs = z.object({ title: z.string().min(1).max(80), markdown: z.string().max(50_000) });
const wireframeArgs = z.object({ instruction: z.string().min(1).max(2000) });

export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case "rewrite_section":
      return rewriteSection(rewriteArgs.parse(JSON.parse(rawArgs)), ctx);
    case "add_section":
      return addSection(addArgs.parse(JSON.parse(rawArgs)), ctx);
    case "update_wireframe":
      return updateWireframe(wireframeArgs.parse(JSON.parse(rawArgs)), ctx);
    default:
      return { result: `Unknown tool: ${name}`, mutated: false };
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

async function updateWireframe(args: z.infer<typeof wireframeArgs>, ctx: ToolContext): Promise<ToolOutcome> {
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

  const html = await generateWireframe(
    [new LlmGenerator(ctx.llm, { instruction: args.instruction }), new HeuristicGenerator()],
    sections,
  );
  await writeWireframe(ctx.oxen, ctx.view, ctx.pageSlug, html);

  return { result: `Redesigned the wireframe: ${args.instruction}`, mutated: true };
}
