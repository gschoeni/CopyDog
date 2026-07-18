import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { executeTool, type ToolContext } from "@/lib/agent/tools";
import { requireProjectAccessAs, type ProjectAccess } from "@/lib/content/access";
import { closeProposal, mergeProposal, openProposal, publishDraftAndIndex } from "@/lib/content/collab";
import { contentSlugSchema, docSections } from "@/lib/content/doc";
import { addPage } from "@/lib/content/pages";
import {
  compareRevisions,
  hasUnpublishedChanges,
  readDoc,
  readElementsRun,
  readSectionVersion,
  readSite,
  readWireframe,
  syncPageFromMain,
  writeSectionVersion,
} from "@/lib/content/store";
import { diffLines } from "@/lib/diff";
import type { LlmClient } from "@/lib/llm/client";

import type { McpToolDef, McpToolResult, McpToolServer } from "./protocol";

/**
 * The MCP tool surface: what an external agent (Claude Code, a custom
 * harness, anything speaking MCP) can do in CopyDog. Everything routes
 * through the same library functions the app's own UI and chat agent use —
 * this module only binds them to an API-key identity.
 *
 * Writes always land on the caller's own draft (their `draft/{user_id}`
 * branch), exactly like edits made in the editor: private, conflict-free,
 * publishable. The collaboration verbs (publish, propose, merge) are the
 * same shared code paths the buttons in the UI call.
 */

export interface McpContext {
  userId: string;
  /** Service-role client — every project touch goes through requireProjectAccessAs. */
  supabase: SupabaseClient;
  llm: LlmClient | null;
}

const MAX_RESULT_CHARS = 60_000;

interface RegisteredMcpTool {
  description: string;
  inputSchema: Record<string, unknown>;
  /** Omit from tools/list when the server can't honor it (e.g. no LLM key). */
  enabled?: (ctx: McpContext) => boolean;
  run: (args: Record<string, unknown>, ctx: McpContext) => Promise<string>;
}

function defineMcpTool<A>(def: {
  description: string;
  args: z.ZodType<A>;
  enabled?: (ctx: McpContext) => boolean;
  run: (args: A, ctx: McpContext) => Promise<string>;
}): RegisteredMcpTool {
  return {
    description: def.description,
    inputSchema: jsonSchema(def.args),
    enabled: def.enabled,
    run: (raw, ctx) => def.run(def.args.parse(raw), ctx),
  };
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

const projectId = z.uuid().describe("project id (from list_projects)");
const pageSlug = contentSlugSchema.describe("page slug (from get_site)");
const markdownField = z
  .string()
  .max(50_000)
  .describe(
    "copy as markdown: # h1-###### h6, paragraphs, - bullets, 1. numbered lists, [CTA label](url) on its own line for buttons, <!--eyebrow--> line before a short overline",
  );

async function access(ctx: McpContext, project: string): Promise<ProjectAccess> {
  return requireProjectAccessAs(ctx.supabase, ctx.userId, project);
}

/** Bridges an MCP call onto the chat agent's tool registry (same implementations). */
async function runAgentTool(
  ctx: McpContext,
  project: string,
  page: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { oxen, view } = await access(ctx, project);
  const toolCtx: ToolContext = { oxen, view, pageSlug: page, llm: ctx.llm ?? unavailableLlm() };
  const outcome = await executeTool(name, JSON.stringify(args), toolCtx);
  return outcome.result;
}

/** Stand-in for tools that never touch the LLM; loud failure if one does. */
function unavailableLlm(): LlmClient {
  return new Proxy({} as LlmClient, {
    get() {
      throw new Error("This server has no LLM configured (OXEN_API_KEY) — LLM-backed tools are unavailable.");
    },
  });
}

const TOOLS: Record<string, RegisteredMcpTool> = {
  list_projects: defineMcpTool({
    description:
      "List the projects you can access, with their ids. Start here — every other tool takes a project_id from this list.",
    args: z.object({}),
    run: async (_args, ctx) => {
      const { data, error } = await ctx.supabase
        .from("project_members")
        .select("role, projects(id, name, slug)")
        .eq("user_id", ctx.userId);
      if (error) throw new Error(error.message);
      const projects = (data ?? []).flatMap((row) => {
        const p = row.projects as unknown as { id: string; name: string; slug: string } | null;
        return p ? [{ id: p.id, name: p.name, slug: p.slug, role: row.role as string }] : [];
      });
      return JSON.stringify({ projects }, null, 2);
    },
  }),

  get_site: defineMcpTool({
    description: "The project's sitemap: the page tree with each page's slug and title.",
    args: z.object({ project_id: projectId }),
    run: async (args, ctx) => {
      const { oxen, view } = await access(ctx, args.project_id);
      const site = await readSite(oxen, view);
      return JSON.stringify({ pages: site.pages }, null, 2);
    },
  }),

  get_page: defineMcpTool({
    description:
      "A page's full structure and copy from your draft: ordered sections (with all version labels and the active version's markdown) and loose element runs.",
    args: z.object({ project_id: projectId, page_slug: pageSlug }),
    run: async (args, ctx) => {
      const { oxen, view } = await access(ctx, args.project_id);
      const doc = await readDoc(oxen, view, args.page_slug);
      const content = await Promise.all(
        doc.content.map(async (entry) => {
          if (entry.kind === "elements") {
            return {
              kind: "elements" as const,
              slug: entry.slug,
              markdown: (await readElementsRun(oxen, view, args.page_slug, entry.slug)) ?? "",
            };
          }
          return {
            kind: "section" as const,
            slug: entry.slug,
            title: entry.title,
            linked: entry.linked,
            activeVersion: entry.activeVersion,
            versions: entry.versions,
            markdown:
              (await readSectionVersion(oxen, view, args.page_slug, entry.slug, entry.activeVersion)) ?? "",
          };
        }),
      );
      return JSON.stringify({ page: args.page_slug, content }, null, 2);
    },
  }),

  read_section: defineMcpTool({
    description:
      "One section's markdown from your draft — the active version by default, or a specific version_slug.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      section_slug: contentSlugSchema,
      version_slug: contentSlugSchema.optional().describe("omit for the active version"),
    }),
    run: async (args, ctx) => {
      const { oxen, view } = await access(ctx, args.project_id);
      const doc = await readDoc(oxen, view, args.page_slug);
      const section = docSections(doc).find((s) => s.slug === args.section_slug);
      if (!section) throw new Error(`No section "${args.section_slug}" on page "${args.page_slug}".`);
      const version = args.version_slug ?? section.activeVersion;
      const markdown = await readSectionVersion(oxen, view, args.page_slug, section.slug, version);
      if (markdown === null) throw new Error(`Section "${section.slug}" has no version "${version}".`);
      return JSON.stringify(
        { section: section.slug, title: section.title, version, versions: section.versions, markdown },
        null,
        2,
      );
    },
  }),

  get_wireframe: defineMcpTool({
    description:
      "The page's greyscale wireframe HTML from your draft. Layout only — copy is injected into data-copy slots at render time.",
    args: z.object({ project_id: projectId, page_slug: pageSlug }),
    run: async (args, ctx) => {
      const { oxen, view } = await access(ctx, args.project_id);
      return (await readWireframe(oxen, view, args.page_slug)) ?? "(no wireframe yet — redesign_page creates one)";
    },
  }),

  diff_draft: defineMcpTool({
    description:
      "What your published draft branch changes relative to the team's main branch, as per-file line diffs. Staged edits you haven't published yet are NOT included — publish_draft first for a complete picture.",
    args: z.object({ project_id: projectId }),
    run: async (args, ctx) => {
      const { oxen, view } = await access(ctx, args.project_id);
      const [comparison, staged] = await Promise.all([
        compareRevisions(oxen, view.repo, view.branch, "main"),
        hasUnpublishedChanges(oxen, view),
      ]);
      const parts: string[] = [];
      if (staged) parts.push("NOTE: you have staged edits not yet published — they are not in this diff.\n");
      if (comparison.changed.size === 0) parts.push("Your draft branch matches main.");
      for (const [path, { source, target }] of comparison.changed) {
        const lines = diffLines(target ?? "", source ?? "")
          .filter((l) => l.kind !== "same")
          .map((l) => `${l.kind === "added" ? "+" : "-"} ${l.text}`);
        parts.push(`=== ${path} ===\n${lines.join("\n")}`);
      }
      return parts.join("\n");
    },
  }),

  list_comments: defineMcpTool({
    description: "Section-level comments (feedback about the copy) for a project, optionally scoped to one page.",
    args: z.object({ project_id: projectId, page_slug: pageSlug.optional() }),
    run: async (args, ctx) => {
      await access(ctx, args.project_id);
      let query = ctx.supabase
        .from("comments")
        .select("id, page_slug, section_slug, body, created_at, resolved_at, author:profiles(display_name)")
        .eq("project_id", args.project_id)
        .order("created_at", { ascending: true });
      if (args.page_slug) query = query.eq("page_slug", args.page_slug);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return JSON.stringify({ comments: data ?? [] }, null, 2);
    },
  }),

  add_comment: defineMcpTool({
    description: "Leave a comment on a section — feedback and open questions, visible to the whole team.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      section_slug: contentSlugSchema,
      body: z.string().trim().min(1).max(4000),
    }),
    run: async (args, ctx) => {
      await access(ctx, args.project_id);
      const { error } = await ctx.supabase.from("comments").insert({
        project_id: args.project_id,
        page_slug: args.page_slug,
        section_slug: args.section_slug,
        author_id: ctx.userId,
        body: args.body,
      });
      if (error) throw new Error(error.message);
      return "Comment added.";
    },
  }),

  rewrite_section: defineMcpTool({
    description:
      "Create a new labeled version of a section's copy and make it active in your draft. The original version is preserved — this is how copy changes should normally land.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      section_slug: contentSlugSchema,
      label: z.string().min(1).max(60).describe("short human label for the new version, e.g. 'Punchier'"),
      markdown: markdownField,
    }),
    run: (args, ctx) =>
      runAgentTool(ctx, args.project_id, args.page_slug, "rewrite_section", {
        sectionSlug: args.section_slug,
        label: args.label,
        markdown: args.markdown,
      }),
  }),

  add_section: defineMcpTool({
    description:
      "Add a new copy section to a page with initial markdown. It won't appear in the wireframe until design_section lays it out.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      title: z.string().min(1).max(80),
      markdown: markdownField,
    }),
    run: (args, ctx) =>
      runAgentTool(ctx, args.project_id, args.page_slug, "add_section", {
        title: args.title,
        markdown: args.markdown,
      }),
  }),

  update_section: defineMcpTool({
    description:
      "Overwrite an EXISTING version's markdown in place (like the editor's autosave). Prefer rewrite_section, which keeps history as labeled versions.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      section_slug: contentSlugSchema,
      version_slug: contentSlugSchema,
      markdown: markdownField,
    }),
    run: async (args, ctx) => {
      const { oxen, view } = await access(ctx, args.project_id);
      const doc = await readDoc(oxen, view, args.page_slug);
      const section = docSections(doc).find((s) => s.slug === args.section_slug);
      if (!section) throw new Error(`No section "${args.section_slug}" on page "${args.page_slug}".`);
      if (!section.versions.some((v) => v.slug === args.version_slug)) {
        throw new Error(
          `Section "${section.slug}" has no version "${args.version_slug}" — rewrite_section creates new versions.`,
        );
      }
      await writeSectionVersion(oxen, view, args.page_slug, section.slug, args.version_slug, args.markdown);
      return `Updated ${args.section_slug}/${args.version_slug}.`;
    },
  }),

  design_section: defineMcpTool({
    description:
      "Redesign (or first lay out) ONE wireframe section per an instruction, e.g. 'split hero, image left'. Uses CopyDog's design-system LLM; other sections keep their layout.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      section_slug: contentSlugSchema,
      instruction: z.string().min(1).max(2000),
    }),
    enabled: (ctx) => ctx.llm !== null,
    run: (args, ctx) =>
      runAgentTool(ctx, args.project_id, args.page_slug, "design_section", {
        sectionSlug: args.section_slug,
        instruction: args.instruction,
      }),
  }),

  redesign_page: defineMcpTool({
    description:
      "Regenerate the whole page's wireframe per an instruction. Copy is untouched; the layout regenerates around it.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      instruction: z.string().min(1).max(2000),
    }),
    enabled: (ctx) => ctx.llm !== null,
    run: (args, ctx) =>
      runAgentTool(ctx, args.project_id, args.page_slug, "redesign_page", { instruction: args.instruction }),
  }),

  add_page: defineMcpTool({
    description: "Add a new (empty) page to the sitemap in your draft. Returns the new page's slug.",
    args: z.object({
      project_id: projectId,
      title: z.string().trim().min(1).max(80),
      parent_slug: contentSlugSchema.optional().describe("nest under this page; omit for top level"),
    }),
    run: async (args, ctx) => {
      const { oxen, view } = await access(ctx, args.project_id);
      const { slug } = await addPage(oxen, view, args.title, args.parent_slug);
      return JSON.stringify({ slug });
    },
  }),

  sync_page_from_main: defineMcpTool({
    description:
      "Replace ONE page in your draft with main's published state. Destructive for your unpublished edits on that page.",
    args: z.object({ project_id: projectId, page_slug: pageSlug }),
    run: async (args, ctx) => {
      const { oxen, view } = await access(ctx, args.project_id);
      await syncPageFromMain(oxen, view, args.page_slug);
      return `Page "${args.page_slug}" now matches main in your draft.`;
    },
  }),

  publish_draft: defineMcpTool({
    description:
      "Commit your staged edits to your draft branch (a real version-control commit) and refresh the shared version index so teammates can see and adopt your versions. Does not touch main.",
    args: z.object({
      project_id: projectId,
      message: z.string().trim().max(200).optional().describe("commit message"),
    }),
    run: async (args, ctx) => {
      const a = await access(ctx, args.project_id);
      await publishDraftAndIndex(ctx.supabase, a, args.message);
      return "Draft published.";
    },
  }),

  propose: defineMcpTool({
    description:
      "Publish pending edits, then open a proposal (like a pull request) from your draft branch to the team's main. Teammates review and merge it.",
    args: z.object({
      project_id: projectId,
      title: z.string().trim().min(1).max(120),
      description: z.string().trim().max(2000).optional(),
    }),
    run: async (args, ctx) => {
      const a = await access(ctx, args.project_id);
      const { proposalId } = await openProposal(ctx.supabase, a, {
        title: args.title,
        description: args.description,
      });
      return JSON.stringify({ proposalId });
    },
  }),

  list_proposals: defineMcpTool({
    description: "Proposals on a project: open ones awaiting review plus merged/closed history.",
    args: z.object({ project_id: projectId }),
    run: async (args, ctx) => {
      await access(ctx, args.project_id);
      const { data, error } = await ctx.supabase
        .from("proposals")
        .select("id, title, description, status, source_branch, created_at, author:profiles(display_name)")
        .eq("project_id", args.project_id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return JSON.stringify({ proposals: data ?? [] }, null, 2);
    },
  }),

  merge_proposal: defineMcpTool({
    description:
      "Merge an open proposal: squash-applies its branch onto main and records the merge. Affects the whole team — be sure this is what the user wants.",
    args: z.object({ project_id: projectId, proposal_id: z.uuid() }),
    run: async (args, ctx) => {
      const a = await access(ctx, args.project_id);
      const result = await mergeProposal(ctx.supabase, a, args.proposal_id);
      if (!result.ok) throw new Error(result.error);
      return `Merged (commit ${result.mergedCommit}).`;
    },
  }),

  close_proposal: defineMcpTool({
    description: "Close an open proposal without merging.",
    args: z.object({ project_id: projectId, proposal_id: z.uuid() }),
    run: async (args, ctx) => {
      const a = await access(ctx, args.project_id);
      await closeProposal(ctx.supabase, a, args.proposal_id);
      return "Proposal closed.";
    },
  }),
};

const INSTRUCTIONS = `CopyDog is a collaborative website-copy editor backed by real version control.
Everything you write lands in the calling user's private draft (their own branch) — you can never
break teammates' work. The flow: edit copy (rewrite_section / add_section), lay it out
(design_section / redesign_page), then publish_draft to commit, and propose to open a
proposal against the team's shared main. Start with list_projects, then get_site, then get_page.
Copy is markdown; wireframes are greyscale layout HTML that derives entirely from the copy.`;

export function buildMcpServer(ctx: McpContext): McpToolServer {
  return {
    serverInfo: { name: "copydog", version: "0.1.0" },
    instructions: INSTRUCTIONS,
    listTools: async () =>
      Object.entries(TOOLS)
        .filter(([, tool]) => tool.enabled?.(ctx) ?? true)
        .map(([name, tool]): McpToolDef => ({ name, description: tool.description, inputSchema: tool.inputSchema })),
    callTool: async (name, args): Promise<McpToolResult> => {
      const tool = TOOLS[name];
      if (!tool || !(tool.enabled?.(ctx) ?? true)) {
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }
      try {
        let text = await tool.run(args, ctx);
        if (text.length > MAX_RESULT_CHARS) {
          text = `${text.slice(0, MAX_RESULT_CHARS)}\n… (truncated at ${MAX_RESULT_CHARS} chars)`;
        }
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const message = err instanceof z.ZodError ? `Invalid arguments: ${err.message}` : err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  };
}
