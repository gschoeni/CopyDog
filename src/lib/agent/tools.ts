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
import { MARKDOWN_DIALECT, parseElementsMarkdown } from "@/lib/copy/markdown";
import type { LlmClient, LlmContentPart, LlmTool } from "@/lib/llm/client";
import type { OxenClient } from "@/lib/oxen/client";
import { generateSectionLayout, listWireframeSections, upsertWireframeSection } from "@/lib/wireframe/edit";
import { generateWireframe, LlmGenerator, HeuristicGenerator } from "@/lib/wireframe/generate";
import type { SectionForLayout } from "@/lib/wireframe/heuristic";

import type { ChatInteraction } from "./interactions";
import type { ReferenceLibrary } from "./references";

/**
 * The agent's hands. Every tool operates on the calling user's draft view —
 * agent edits are exactly like the user's own edits: staged, private,
 * publishable. The agent can never touch main.
 *
 * Each tool is one `defineTool` entry in TOOLS: description, zod args
 * (the single source of truth — the JSON Schema the model sees is derived
 * from it), a live status label, and the implementation. Adding a tool is
 * adding one entry; the loop in run.ts needs no changes.
 */

export interface ToolContext {
  oxen: OxenClient;
  view: DraftView;
  pageSlug: string;
  /** Null when no LLM is configured — only the design tools need it. */
  llm: LlmClient | null;
  /** This conversation's reference material; absent on surfaces without chat (MCP). */
  references?: ReferenceLibrary | null;
}

export interface ToolOutcome {
  result: string;
  mutated: boolean;
  /** This tool needs a human response before the agent can continue. */
  interaction?: ChatInteraction;
  /**
   * Content the tool is putting back in front of the model — pixels or a
   * document, which a tool result (text only) can't carry. The loop appends
   * these as a follow-up user message.
   */
  attach?: LlmContentPart[];
}

interface RegisteredTool {
  description: string;
  parameters: Record<string, unknown>;
  activity(rawArgs: string): string;
  execute(rawArgs: string, ctx: ToolContext): Promise<ToolOutcome>;
}

function defineTool<A>(def: {
  description: string;
  args: z.ZodType<A>;
  /** Short human-facing label for the live status UI, e.g. "Rewriting hero…". */
  activity: (args: Partial<A>) => string;
  run: (args: A, ctx: ToolContext) => Promise<ToolOutcome> | ToolOutcome;
}): RegisteredTool {
  return {
    description: def.description,
    parameters: jsonSchema(def.args),
    activity: (rawArgs) => def.activity(safeParse(rawArgs) as Partial<A>),
    execute: async (rawArgs, ctx) => def.run(def.args.parse(JSON.parse(rawArgs)), ctx),
  };
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

/** Args as the model sent them, best-effort — for labels only, never execution. */
function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const markdownField = (what: string) =>
  z.string().max(50_000).describe(`${what} as markdown: ${MARKDOWN_DIALECT}`);

const referenceIdsField = z
  .array(z.string().max(64))
  .max(4)
  .optional()
  .describe(
    "ids of attached reference material (from the roster in the conversation) the designer should look at while laying this out",
  );

const TOOLS: Record<string, RegisteredTool> = {
  rewrite_section: defineTool({
    description:
      "Create a new version of a section's copy and make it active in the user's draft. Use for rewrites, tone changes, tightening, or brainstormed alternatives. The original version is preserved.",
    args: z.object({
      sectionSlug: z.string().describe("slug of the section to rewrite"),
      label: z.string().min(1).max(60).describe("short human label for the new version, e.g. 'Punchier'"),
      markdown: markdownField("the full new section copy"),
    }),
    activity: (args) => `Rewriting ${args.sectionSlug ?? "a section"}…`,
    run: rewriteSection,
  }),

  add_section: defineTool({
    description:
      "Add a new copy section to the page with initial markdown copy. It won't appear in the wireframe until design_section lays it out — call that next when the user wants it visible.",
    args: z.object({
      title: z.string().min(1).max(80).describe("section title, e.g. 'Testimonials'"),
      markdown: markdownField("initial copy for the section"),
    }),
    activity: (args) => `Adding section "${args.title ?? "…"}"…`,
    run: addSection,
  }),

  design_section: defineTool({
    description:
      "Redesign (or first lay out) ONE section of the wireframe per an instruction — e.g. 'make the hero a split with the image left', 'turn these features into a 3-up card grid'. Every other section keeps its current layout. Prefer this over redesign_page for anything section-scoped.",
    args: z.object({
      sectionSlug: z.string().describe("slug of the copy section whose layout changes"),
      instruction: z
        .string()
        .min(1)
        .max(2000)
        .describe("what the section's layout should become; mention the design-system pattern when you have one in mind"),
      referenceIds: referenceIdsField,
    }),
    activity: (args) => `Designing ${args.sectionSlug ?? "a section"}…`,
    run: designSection,
  }),

  redesign_page: defineTool({
    description:
      "Redesign the whole page's wireframe per an instruction (e.g. 'more visual rhythm, alternate tinted bands', 'lay the whole page out for the first time'). Starts from the current wireframe when one exists. Copy is untouched; the layout regenerates around it.",
    args: z.object({
      instruction: z.string().min(1).max(2000).describe("page-level layout direction to apply"),
      referenceIds: referenceIdsField,
    }),
    activity: () => "Redesigning the page layout…",
    run: redesignPage,
  }),

  read_reference: defineTool({
    description:
      "Look at a piece of reference material the user attached earlier in this conversation — a screenshot, a PDF, or a page's copy. Its full contents come back into view. Use it when you need to check a detail you no longer have in front of you. To *design* against a reference you don't need this: pass its id to design_section or redesign_page instead, and the designer sees it directly.",
    args: z.object({
      referenceId: z.string().min(1).max(64).describe("id of the reference, from the roster in the conversation"),
    }),
    activity: () => "Looking at the reference…",
    run: readReference,
  }),

  ask_user_choice: defineTool({
    description:
      "Ask the user to choose between 2–4 concrete options before making a consequential design or copy decision. Use this instead of presenting a numbered list in prose. The UI renders a polished choice card and returns the selected option as the next user message. Do not use for questions you can answer yourself or for trivial details.",
    args: z.object({
      question: z.string().trim().min(1).max(280).describe("A concise question ending in a question mark."),
      options: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(80).describe("Short option label, ideally 2–5 words."),
            description: z.string().trim().min(1).max(280).describe("What this option means or its trade-off."),
          }),
        )
        .min(2)
        .max(4)
        .describe("Two to four mutually exclusive options, ordered as they should be shown."),
    }),
    activity: () => "Waiting for your choice…",
    run: (args) => ({
      result: "The user needs to choose an option in the interactive UI before you continue.",
      mutated: false,
      interaction: { type: "choice", question: args.question, options: args.options },
    }),
  }),
};

/** Tool definitions in the shape the LLM API expects. */
export const AGENT_TOOLS: LlmTool[] = Object.entries(TOOLS).map(([name, tool]) => ({
  type: "function",
  function: { name, description: tool.description, parameters: tool.parameters },
}));

export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = TOOLS[name];
  if (!tool) return { result: `Unknown tool: ${name}`, mutated: false };
  return tool.execute(rawArgs, ctx);
}

/** A short human-facing label for what a tool call is doing, for live status UI. */
export function toolActivityLabel(name: string, rawArgs: string): string {
  return TOOLS[name]?.activity(rawArgs) ?? "Working…";
}

function slugify(text: string, fallback: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || fallback
  );
}

function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}

async function rewriteSection(
  args: { sectionSlug: string; label: string; markdown: string },
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const doc = await readDoc(ctx.oxen, ctx.view, ctx.pageSlug);
  const section = docSections(doc).find((s) => s.slug === args.sectionSlug);
  if (!section) {
    return { result: `No section with slug "${args.sectionSlug}" on this page.`, mutated: false };
  }

  const slug = uniqueSlug(slugify(args.label, "agent"), (candidate) =>
    section.versions.some((v) => v.slug === candidate),
  );

  await writeSectionVersion(ctx.oxen, ctx.view, ctx.pageSlug, section.slug, slug, args.markdown);
  section.versions.push({ slug, label: args.label });
  section.activeVersion = slug;
  await writeDoc(ctx.oxen, ctx.view, ctx.pageSlug, doc);

  return { result: `Created version "${args.label}" for section "${section.title}" and made it active.`, mutated: true };
}

async function addSection(args: { title: string; markdown: string }, ctx: ToolContext): Promise<ToolOutcome> {
  const doc = await readDoc(ctx.oxen, ctx.view, ctx.pageSlug);
  const slug = uniqueSlug(slugify(args.title, "section"), (candidate) =>
    docSections(doc).some((s) => s.slug === candidate),
  );

  await writeSectionVersion(ctx.oxen, ctx.view, ctx.pageSlug, slug, "original", args.markdown);
  doc.content.push({
    kind: "section",
    slug,
    title: args.title,
    activeVersion: "original",
    versions: [{ slug: "original", label: "Original" }],
    // unlinked until it gets a layout (design_section / write_section_layout) —
    // linking it now would force every page-layout write to carry a slot for a
    // section that has none yet, and it must not render before it's laid out
    linked: false,
  });
  await writeDoc(ctx.oxen, ctx.view, ctx.pageSlug, doc);

  return { result: `Added section "${args.title}" (${slug}).`, mutated: true };
}

/**
 * Loads the references a design tool named, along with a note about any that
 * no longer resolve — publishing prunes reference material, so an id from
 * earlier in a long conversation can legitimately go missing. Saying so beats
 * silently designing without the thing the user asked us to look at.
 */
async function resolveReferences(
  ctx: ToolContext,
  referenceIds: string[] | undefined,
): Promise<{ parts?: LlmContentPart[]; note: string }> {
  if (!referenceIds?.length) return { note: "" };
  if (!ctx.references) {
    return { note: " (reference material isn't available on this surface, so I designed without it)" };
  }
  const loaded = await ctx.references.loadMany(referenceIds);
  const found = new Set(loaded.map((reference) => reference.id));
  const missing = referenceIds.filter((id) => !found.has(id));
  const note = missing.length
    ? ` (reference ${missing.join(", ")} is no longer available — publishing clears attachments; ask the user to re-attach it)`
    : "";
  return { parts: loaded.length ? await ctx.references.contentParts(loaded) : undefined, note };
}

async function readReference(args: { referenceId: string }, ctx: ToolContext): Promise<ToolOutcome> {
  const reference = ctx.references ? await ctx.references.load(args.referenceId) : null;
  if (!reference) {
    return {
      result: `No reference with id "${args.referenceId}" in this conversation. Publishing clears attachments — ask the user to attach it again.`,
      mutated: false,
    };
  }
  if (reference.media === "text") {
    return { result: `Reference "${reference.label}":\n\n${reference.text ?? "(empty)"}`, mutated: false };
  }
  return {
    result: `Reference "${reference.label}" is in front of you again in the next message.`,
    mutated: false,
    attach: await ctx.references!.contentParts([reference]),
  };
}

async function designSection(
  args: { sectionSlug: string; instruction: string; referenceIds?: string[] },
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!ctx.llm) {
    return { result: "No designer LLM is configured on this server, so layout tools are unavailable.", mutated: false };
  }
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
  const references = await resolveReferences(ctx, args.referenceIds);

  const sectionHtml = await generateSectionLayout(ctx.llm, forLayout, {
    instruction: args.instruction,
    currentHtml: current,
    references: references.parts,
  });

  const docOrder = docSections(doc)
    .filter((s) => s.linked)
    .map((s) => s.slug);
  await writeWireframe(ctx.oxen, ctx.view, ctx.pageSlug, upsertWireframeSection(wireframe, section.slug, sectionHtml, docOrder));

  const note = relinked ? " (it was unlinked — I linked it back into the wireframe)" : "";
  return {
    result: `Redesigned the "${section.title}" section${note}${references.note}: ${args.instruction}\n\nIts layout is now:\n${sectionHtml}`,
    mutated: true,
  };
}

async function redesignPage(
  args: { instruction: string; referenceIds?: string[] },
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!ctx.llm) {
    return { result: "No designer LLM is configured on this server, so layout tools are unavailable.", mutated: false };
  }
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
  const references = await resolveReferences(ctx, args.referenceIds);
  const layout = await generateWireframe(
    [
      new LlmGenerator(ctx.llm, { instruction: args.instruction, currentHtml, references: references.parts }),
      new HeuristicGenerator(),
    ],
    sections,
  );
  await writeWireframe(ctx.oxen, ctx.view, ctx.pageSlug, layout.html);

  // the rule-based generator never saw the reference, so a silent fallback
  // looks exactly like "you ignored my screenshot" — say what happened
  const fallbackNote = layout.fallback
    ? `\n\nNOTE: the designer failed (${layout.error}) and a generic rule-based layout was used instead${
        references.parts ? ", so this layout does NOT follow the reference" : ""
      }. Tell the user plainly rather than describing this as a match.`
    : "";

  return {
    result: `Redesigned the wireframe${references.note}: ${args.instruction}${fallbackNote}`,
    mutated: true,
  };
}
