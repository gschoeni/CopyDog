import "server-only";

import { z } from "zod";

import { executeTool, type ToolContext } from "@/lib/agent/tools";
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
  writeDoc,
  writeElementsRun,
  writeSectionVersion,
  writeWireframe,
} from "@/lib/content/store";
import type { ApiKeyScope } from "@/lib/db/schema/api-keys";
import { diffLines } from "@/lib/diff";
import type { LlmClient } from "@/lib/llm/client";
import { acceptSectionLayout, upsertWireframeSection } from "@/lib/wireframe/edit";
import { acceptPageWireframe } from "@/lib/wireframe/generate";
import { DESIGN_SYSTEM_SPEC } from "@/lib/wireframe/spec";

import { LLM_TOOL_COST, type McpToolApi, type ProjectHandle } from "./context";
import { McpToolError } from "./errors";
import type { McpToolDef, McpToolResult, McpToolServer } from "./protocol";

/**
 * The MCP tool surface: what an external agent (Claude Code, a custom
 * harness, anything speaking MCP) can do in CopyDog. Everything routes
 * through the same library functions the app's own UI and chat agent use —
 * this module binds them to an API-key capability object (McpToolApi).
 *
 * Security posture, enforced here:
 *  - every project-scoped tool starts with api.requireProject() — tools
 *    never hold a raw database client (see context.ts)
 *  - every tool declares the key scope it needs; undisclosed = uncallable
 *  - LLM-backed tools draw extra from the key's rate budget
 *  - mutating tools write an identifier-only audit row
 *  - only McpToolError messages reach the agent; everything else is logged
 *    and reported generically
 *
 * Writes always land on the caller's own draft (their `draft/{user_id}`
 * branch) — private, conflict-free, publishable. Merging is the one act
 * that touches main; it needs the opt-in `merge` scope and never applies
 * to the key owner's own proposals.
 */

const MAX_RESULT_CHARS = 60_000;

/** Argument keys that may appear in the audit trail — identifiers only, never copy. */
const AUDITABLE_ARG_KEYS = new Set([
  "page_slug",
  "section_slug",
  "version_slug",
  "run_slug",
  "proposal_id",
  "parent_slug",
  "label",
  "title",
  "message",
]);

interface RegisteredMcpTool {
  description: string;
  inputSchema: Record<string, unknown>;
  /** The key scope this tool requires. */
  scope: ApiKeyScope;
  /** Mutating tools are audited. */
  mutates: boolean;
  /** Extra rate-budget cost beyond the per-request unit (LLM tools). */
  extraCost?: number;
  /** Omit from tools/list when the server can't honor it (e.g. no LLM key). */
  enabled?: (api: McpToolApi) => boolean;
  run: (args: Record<string, unknown>, api: McpToolApi) => Promise<string>;
}

function defineMcpTool<A extends { project_id?: string }>(def: {
  description: string;
  args: z.ZodType<A>;
  scope: ApiKeyScope;
  mutates?: boolean;
  extraCost?: number;
  enabled?: (api: McpToolApi) => boolean;
  run: (args: A, api: McpToolApi) => Promise<string>;
}): RegisteredMcpTool {
  return {
    description: def.description,
    inputSchema: jsonSchema(def.args),
    scope: def.scope,
    mutates: def.mutates ?? false,
    extraCost: def.extraCost,
    enabled: def.enabled,
    run: (raw, api) => def.run(def.args.parse(raw), api),
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

/** Bridges an MCP call onto the chat agent's tool registry (same implementations). */
async function runAgentTool(
  handle: ProjectHandle,
  api: McpToolApi,
  page: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const toolCtx: ToolContext = { oxen: handle.oxen, view: handle.view, pageSlug: page, llm: api.llm ?? unavailableLlm() };
  const outcome = await executeTool(name, JSON.stringify(args), toolCtx);
  return outcome.result;
}

/** Stand-in for tools that never touch the LLM; loud failure if one does. */
function unavailableLlm(): LlmClient {
  return new Proxy({} as LlmClient, {
    get() {
      throw new McpToolError("This server has no LLM configured — LLM-backed tools are unavailable.");
    },
  });
}

const TOOLS: Record<string, RegisteredMcpTool> = {
  list_projects: defineMcpTool({
    description:
      "List the projects you can access, with their ids. Start here — every other tool takes a project_id from this list.",
    args: z.object({}),
    scope: "read",
    run: async (_args, api) => JSON.stringify({ projects: await api.listMemberships() }, null, 2),
  }),

  get_site: defineMcpTool({
    description: "The project's sitemap: the page tree with each page's slug and title.",
    args: z.object({ project_id: projectId }),
    scope: "read",
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
      const site = await readSite(oxen, view);
      return JSON.stringify({ pages: site.pages }, null, 2);
    },
  }),

  get_page: defineMcpTool({
    description:
      "A page's full structure and copy from your draft: ordered sections (with all version labels and the active version's markdown) and loose element runs.",
    args: z.object({ project_id: projectId, page_slug: pageSlug }),
    scope: "read",
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
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
    scope: "read",
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
      const doc = await readDoc(oxen, view, args.page_slug);
      const section = docSections(doc).find((s) => s.slug === args.section_slug);
      if (!section) throw new McpToolError(`No section "${args.section_slug}" on page "${args.page_slug}".`);
      const version = args.version_slug ?? section.activeVersion;
      const markdown = await readSectionVersion(oxen, view, args.page_slug, section.slug, version);
      if (markdown === null) throw new McpToolError(`Section "${section.slug}" has no version "${version}".`);
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
    scope: "read",
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
      return (await readWireframe(oxen, view, args.page_slug)) ?? "(no wireframe yet — redesign_page creates one)";
    },
  }),

  diff_draft: defineMcpTool({
    description:
      "What your published draft branch changes relative to the team's main branch, as per-file line diffs. Staged edits you haven't published yet are NOT included — publish_draft first for a complete picture.",
    args: z.object({ project_id: projectId }),
    scope: "read",
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
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
    scope: "read",
    run: async (args, api) => {
      const { db } = await api.requireProject(args.project_id);
      let query = db
        .from("comments")
        .select("id, page_slug, section_slug, body, created_at, resolved_at, via_api_key, author:profiles(display_name)")
        .eq("project_id", args.project_id)
        .order("created_at", { ascending: true });
      if (args.page_slug) query = query.eq("page_slug", args.page_slug);
      const { data, error } = await query;
      if (error) {
        console.error("mcp list_comments failed", error);
        throw new McpToolError("Couldn't list comments.");
      }
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
    scope: "collab",
    mutates: true,
    run: async (args, api) => {
      const { db } = await api.requireProject(args.project_id);
      const { error } = await db.from("comments").insert({
        project_id: args.project_id,
        page_slug: args.page_slug,
        section_slug: args.section_slug,
        author_id: api.userId,
        via_api_key: api.keyId,
        body: args.body,
      });
      if (error) {
        console.error("mcp add_comment failed", error);
        throw new McpToolError("Couldn't add the comment.");
      }
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
    scope: "write",
    mutates: true,
    run: async (args, api) => {
      const handle = await api.requireProject(args.project_id);
      return runAgentTool(handle, api, args.page_slug, "rewrite_section", {
        sectionSlug: args.section_slug,
        label: args.label,
        markdown: args.markdown,
      });
    },
  }),

  add_section: defineMcpTool({
    description:
      "Add a new copy section to a page with initial markdown. It won't appear in the wireframe until it gets a layout (design_section or write_section_layout).",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      title: z.string().min(1).max(80),
      markdown: markdownField,
    }),
    scope: "write",
    mutates: true,
    run: async (args, api) => {
      const handle = await api.requireProject(args.project_id);
      return runAgentTool(handle, api, args.page_slug, "add_section", {
        title: args.title,
        markdown: args.markdown,
      });
    },
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
    scope: "write",
    mutates: true,
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
      const doc = await readDoc(oxen, view, args.page_slug);
      const section = docSections(doc).find((s) => s.slug === args.section_slug);
      if (!section) throw new McpToolError(`No section "${args.section_slug}" on page "${args.page_slug}".`);
      if (!section.versions.some((v) => v.slug === args.version_slug)) {
        throw new McpToolError(
          `Section "${section.slug}" has no version "${args.version_slug}" — rewrite_section creates new versions.`,
        );
      }
      await writeSectionVersion(oxen, view, args.page_slug, section.slug, args.version_slug, args.markdown);
      return `Updated ${args.section_slug}/${args.version_slug}.`;
    },
  }),

  update_elements_run: defineMcpTool({
    description: "Overwrite a loose element run's markdown (the non-section copy shown in get_page).",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      run_slug: contentSlugSchema,
      markdown: markdownField,
    }),
    scope: "write",
    mutates: true,
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
      const doc = await readDoc(oxen, view, args.page_slug);
      if (!doc.content.some((entry) => entry.kind === "elements" && entry.slug === args.run_slug)) {
        throw new McpToolError(`No element run "${args.run_slug}" on page "${args.page_slug}".`);
      }
      await writeElementsRun(oxen, view, args.page_slug, args.run_slug, args.markdown);
      return `Updated element run "${args.run_slug}".`;
    },
  }),

  get_design_system: defineMcpTool({
    description:
      "CopyDog's wireframe design-system contract: allowed tags, wf-* classes, copy-slot rules, and layout patterns. Read this BEFORE authoring layout HTML for write_section_layout / write_page_layout.",
    args: z.object({}),
    scope: "read",
    run: async () =>
      `${DESIGN_SYSTEM_SPEC}\n\nSubmit HTML you author via write_section_layout (one <section> fragment) or write_page_layout (the whole page). Submissions are sanitized and validated by the same rules as CopyDog's internal designer.`,
  }),

  write_section_layout: defineMcpTool({
    description:
      "Set ONE wireframe section's layout to HTML that YOU author (see get_design_system for the contract). Must be exactly one <section class=\"wf-section\" data-copy=\"<section_slug>\"> fragment with empty copy slots; it is sanitized and validated like internal designs. Other sections keep their layout.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      section_slug: contentSlugSchema,
      html: z.string().min(1).max(50_000).describe("the <section> fragment, wf-* classes and data-element slots only"),
    }),
    scope: "write",
    mutates: true,
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
      const doc = await readDoc(oxen, view, args.page_slug);
      const section = docSections(doc).find((s) => s.slug === args.section_slug);
      if (!section) throw new McpToolError(`No section "${args.section_slug}" on page "${args.page_slug}".`);

      // authoring a layout is an explicit "put this in the wireframe"
      if (!section.linked) {
        section.linked = true;
        await writeDoc(oxen, view, args.page_slug, doc);
      }

      const sectionHtml = acceptLayout(() => acceptSectionLayout(args.html, section.slug));
      const wireframe = (await readWireframe(oxen, view, args.page_slug)) ?? "";
      const docOrder = docSections(doc)
        .filter((s) => s.linked)
        .map((s) => s.slug);
      await writeWireframe(oxen, view, args.page_slug, upsertWireframeSection(wireframe, section.slug, sectionHtml, docOrder));
      return `Set the layout for section "${section.slug}".`;
    },
  }),

  write_page_layout: defineMcpTool({
    description:
      "Replace the WHOLE page wireframe with HTML that YOU author (see get_design_system for the contract). Must include a <section data-copy=\"…\"> for every linked section; sanitized and validated like internal designs.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      html: z.string().min(1).max(200_000).describe("the full page fragment: sections in order, wf-* classes only"),
    }),
    scope: "write",
    mutates: true,
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
      const doc = await readDoc(oxen, view, args.page_slug);
      const linked = docSections(doc)
        .filter((s) => s.linked)
        .map((s) => s.slug);
      const html = acceptLayout(() => acceptPageWireframe(args.html, linked));
      await writeWireframe(oxen, view, args.page_slug, html);
      return `Replaced the wireframe for "${args.page_slug}" (${linked.length} section slots verified).`;
    },
  }),

  design_section: defineMcpTool({
    description:
      "Have CopyDog's built-in designer LLM redesign (or first lay out) ONE wireframe section per an instruction, e.g. 'split hero, image left'. Other sections keep their layout. To author the HTML yourself instead, use write_section_layout.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      section_slug: contentSlugSchema,
      instruction: z.string().min(1).max(2000),
    }),
    scope: "write",
    mutates: true,
    extraCost: LLM_TOOL_COST,
    enabled: (api) => api.llm !== null,
    run: async (args, api) => {
      const handle = await api.requireProject(args.project_id);
      return runAgentTool(handle, api, args.page_slug, "design_section", {
        sectionSlug: args.section_slug,
        instruction: args.instruction,
      });
    },
  }),

  redesign_page: defineMcpTool({
    description:
      "Have CopyDog's built-in designer LLM regenerate the whole page's wireframe per an instruction. Copy is untouched; the layout regenerates around it. To author the HTML yourself instead, use write_page_layout.",
    args: z.object({
      project_id: projectId,
      page_slug: pageSlug,
      instruction: z.string().min(1).max(2000),
    }),
    scope: "write",
    mutates: true,
    extraCost: LLM_TOOL_COST,
    enabled: (api) => api.llm !== null,
    run: async (args, api) => {
      const handle = await api.requireProject(args.project_id);
      return runAgentTool(handle, api, args.page_slug, "redesign_page", { instruction: args.instruction });
    },
  }),

  add_page: defineMcpTool({
    description: "Add a new (empty) page to the sitemap in your draft. Returns the new page's slug.",
    args: z.object({
      project_id: projectId,
      title: z.string().trim().min(1).max(80),
      parent_slug: contentSlugSchema.optional().describe("nest under this page; omit for top level"),
    }),
    scope: "write",
    mutates: true,
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
      const { slug } = await addPage(oxen, view, args.title, args.parent_slug);
      return JSON.stringify({ slug });
    },
  }),

  sync_page_from_main: defineMcpTool({
    description:
      "Replace ONE page in your draft with main's published state. Destructive for your unpublished edits on that page.",
    args: z.object({ project_id: projectId, page_slug: pageSlug }),
    scope: "write",
    mutates: true,
    run: async (args, api) => {
      const { oxen, view } = await api.requireProject(args.project_id);
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
    scope: "collab",
    mutates: true,
    run: async (args, api) => {
      const handle = await api.requireProject(args.project_id);
      await publishDraftAndIndex(handle.db, handle, args.message, { attribution: `via ${api.keyName}` });
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
    scope: "collab",
    mutates: true,
    run: async (args, api) => {
      const handle = await api.requireProject(args.project_id);
      const { proposalId } = await openProposal(handle.db, handle, {
        title: args.title,
        description: args.description,
        viaApiKey: api.keyId,
      });
      return JSON.stringify({ proposalId });
    },
  }),

  list_proposals: defineMcpTool({
    description: "Proposals on a project: open ones awaiting review plus merged/closed history.",
    args: z.object({ project_id: projectId }),
    scope: "read",
    run: async (args, api) => {
      const { db } = await api.requireProject(args.project_id);
      const { data, error } = await db
        .from("proposals")
        .select("id, title, description, status, source_branch, created_at, via_api_key, author:profiles(display_name)")
        .eq("project_id", args.project_id)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("mcp list_proposals failed", error);
        throw new McpToolError("Couldn't list proposals.");
      }
      return JSON.stringify({ proposals: data ?? [] }, null, 2);
    },
  }),

  merge_proposal: defineMcpTool({
    description:
      "Merge an open proposal onto the team's main branch. Requires a key with the opt-in merge scope, and never applies to proposals opened by this key's own user — a teammate reviews those in the app.",
    args: z.object({ project_id: projectId, proposal_id: z.uuid() }),
    scope: "merge",
    mutates: true,
    run: async (args, api) => {
      const handle = await api.requireProject(args.project_id);

      // review must involve a second human: a key can never merge work its
      // own user proposed, or an injected agent closes the loop alone
      const { data: proposal } = await handle.db
        .from("proposals")
        .select("author_id")
        .eq("id", args.proposal_id)
        .eq("project_id", args.project_id)
        .maybeSingle<{ author_id: string }>();
      if (!proposal) throw new McpToolError("Proposal not found.");
      if (proposal.author_id === api.userId) {
        throw new McpToolError(
          "This key's owner authored that proposal — someone else on the team has to review and merge it.",
        );
      }

      const result = await mergeProposal(handle.db, handle, args.proposal_id, {
        attribution: `via ${api.keyName}`,
      });
      if (!result.ok) throw new McpToolError(result.error);
      return `Merged (commit ${result.mergedCommit}).`;
    },
  }),

  close_proposal: defineMcpTool({
    description: "Close an open proposal without merging.",
    args: z.object({ project_id: projectId, proposal_id: z.uuid() }),
    scope: "collab",
    mutates: true,
    run: async (args, api) => {
      const handle = await api.requireProject(args.project_id);
      await closeProposal(handle.db, handle, args.proposal_id);
      return "Proposal closed.";
    },
  }),
};

/** Layout acceptance failures are contract feedback for the agent, not internals. */
function acceptLayout(accept: () => string): string {
  try {
    return accept();
  } catch (err) {
    throw new McpToolError(err instanceof Error ? err.message : String(err));
  }
}

const INSTRUCTIONS = `CopyDog is a collaborative website-copy editor backed by real version control.
Everything you write lands in the calling user's private draft (their own branch) — you can never
break teammates' work. The flow: edit copy (rewrite_section / add_section), lay it out, then
publish_draft to commit, and propose to open a proposal against the team's shared main.
Layout has two modes: author the wireframe HTML yourself (get_design_system for the contract,
then write_section_layout / write_page_layout), or delegate to CopyDog's built-in designer
(design_section / redesign_page) when available. Start with list_projects, then get_site, then
get_page. Copy is markdown; wireframes are greyscale layout HTML that derives entirely from the copy.
Your API key may be scoped — tools/list shows exactly what this key can do.`;

export function buildMcpServer(api: McpToolApi): McpToolServer {
  const usable = ([name, tool]: [string, RegisteredMcpTool]) =>
    api.scopes.includes(tool.scope) && (tool.enabled?.(api) ?? true) && Boolean(name);

  return {
    serverInfo: { name: "copydog", version: "0.2.0" },
    instructions: INSTRUCTIONS,
    listTools: async () =>
      Object.entries(TOOLS)
        .filter(usable)
        .map(([name, tool]): McpToolDef => ({ name, description: tool.description, inputSchema: tool.inputSchema })),
    callTool: async (name, args): Promise<McpToolResult> => {
      const tool = TOOLS[name];
      if (!tool || !usable([name, tool])) {
        return errorResult(`Unknown tool (or not permitted by this key's scopes): ${name}`);
      }
      try {
        if (tool.extraCost) await api.consumeRate(tool.extraCost);
        let text = await tool.run(args, api);
        if (tool.mutates) {
          const detail = Object.fromEntries(
            Object.entries(args).filter(([key]) => AUDITABLE_ARG_KEYS.has(key)),
          );
          await api.audit({
            projectId: typeof args.project_id === "string" ? args.project_id : undefined,
            tool: name,
            detail,
          });
        }
        if (text.length > MAX_RESULT_CHARS) {
          text = `${text.slice(0, MAX_RESULT_CHARS)}\n… (truncated at ${MAX_RESULT_CHARS} chars)`;
        }
        return { content: [{ type: "text", text }] };
      } catch (err) {
        if (err instanceof z.ZodError) return errorResult(`Invalid arguments: ${err.message}`);
        if (err instanceof McpToolError) return errorResult(err.message);
        console.error(`mcp tool ${name} failed`, err);
        return errorResult("Internal error — the CopyDog server logged the details.");
      }
    },
  };
}

function errorResult(text: string): McpToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], isError: true };
}
