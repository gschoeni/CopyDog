"use server";

import { z } from "zod";

import { docContentSchema, docSections, type DocContent } from "@/lib/content/doc";
import { requireProjectAccess } from "@/lib/content/access";
import { extractSectionsFromHtml, type ExtractedSection } from "@/lib/import/extract";
import { fetchImportHtml, ImportFetchError } from "@/lib/import/fetch-url";
import { extractSectionsFromImage, extractSectionsWithLlm } from "@/lib/import/llm-extract";
import { serializeElements } from "@/lib/copy/markdown";
import {
  adoptVersion,
  draftBranchName,
  hasUnpublishedChanges,
  publishDraft,
  readDoc,
  readSectionVersion,
  readSite,
  replaceDoc,
  syncPageFromMain,
  writeDoc,
  writeElementsRun,
  writeSectionVersion,
  writeWireframe,
} from "@/lib/content/store";
import { createClient } from "@/lib/supabase/server";
import { SITE_FILE_PATH, serializeSiteFile } from "@/lib/content/site";
import { parseElementsMarkdown } from "@/lib/copy/markdown";
import { getLlmClient } from "@/lib/llm";
import { generateWireframe, selectGenerator } from "@/lib/wireframe/generate";
import type { SectionForLayout } from "@/lib/wireframe/heuristic";

/**
 * Editor autosave actions. All writes land in the calling user's Oxen
 * workspace — private, uncommitted, conflict-free by construction.
 * Postgres is untouched: document structure is content, and content
 * lives in Oxen.
 */

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

const saveSectionInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  sectionSlug: slugSchema,
  versionSlug: slugSchema,
  markdown: z.string().max(100_000),
});

export async function saveSectionAction(input: z.infer<typeof saveSectionInput>): Promise<{ ok: boolean }> {
  const { projectId, pageSlug, sectionSlug, versionSlug, markdown } = saveSectionInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);
  await writeSectionVersion(oxen, view, pageSlug, sectionSlug, versionSlug, markdown);
  return { ok: true };
}

const saveStructureInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  content: z.array(docContentSchema).max(400),
});

/** Persists the page's ordered content (element runs + sections) to doc.json. */
export async function saveStructureAction(input: z.infer<typeof saveStructureInput>): Promise<{ ok: boolean }> {
  const { projectId, pageSlug, content } = saveStructureInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);
  // plain write, no orphan pruning: the editor may resurrect deleted
  // sections via undo, so their files must survive until publish prunes
  await writeDoc(oxen, view, pageSlug, { version: 2, content });
  return { ok: true };
}

const saveElementsRunInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  runSlug: slugSchema,
  markdown: z.string().max(100_000),
});

/** Saves a loose element run's copy. */
export async function saveElementsRunAction(input: z.infer<typeof saveElementsRunInput>): Promise<{ ok: boolean }> {
  const { projectId, pageSlug, runSlug, markdown } = saveElementsRunInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);
  await writeElementsRun(oxen, view, pageSlug, runSlug, markdown);
  return { ok: true };
}

const createVersionInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  sectionSlug: slugSchema,
  label: z.string().trim().min(1).max(60),
  /** version to copy content from; omit for a blank version */
  copyFrom: slugSchema.optional(),
  existingSlugs: z.array(slugSchema).max(100),
});

/** Creates a new alternate version file for a section and returns its slug. */
export async function createVersionAction(
  input: z.infer<typeof createVersionInput>,
): Promise<{ slug: string; markdown: string }> {
  const { projectId, pageSlug, sectionSlug, label, copyFrom, existingSlugs } = createVersionInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);

  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "version";
  let slug = base;
  for (let n = 2; existingSlugs.includes(slug); n++) slug = `${base}-${n}`;

  const markdown = copyFrom ? ((await readSectionVersion(oxen, view, pageSlug, sectionSlug, copyFrom)) ?? "") : "";
  await writeSectionVersion(oxen, view, pageSlug, sectionSlug, slug, markdown);

  return { slug, markdown };
}

const readVersionInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  sectionSlug: slugSchema,
  versionSlug: slugSchema,
});

/** Reads a version's markdown from the caller's draft view (for switching). */
export async function readVersionAction(input: z.infer<typeof readVersionInput>): Promise<{ markdown: string }> {
  const { projectId, pageSlug, sectionSlug, versionSlug } = readVersionInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);
  const markdown = (await readSectionVersion(oxen, view, pageSlug, sectionSlug, versionSlug)) ?? "";
  return { markdown };
}

const publishInput = z.object({
  projectId: z.uuid(),
  message: z.string().trim().max(200).optional(),
});

/**
 * Publishes the caller's staged edits to their draft branch and refreshes
 * their rows in the section_versions index so teammates can discover and
 * adopt their versions.
 */
export async function publishAction(input: z.infer<typeof publishInput>): Promise<{ ok: boolean }> {
  const { projectId, message } = publishInput.parse(input);
  const { oxen, view, user, project } = await requireProjectAccess(projectId);

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const author = { name: profile?.display_name ?? "copydog", email: user.email ?? "unknown@copydog.app" };

  if (await hasUnpublishedChanges(oxen, view)) {
    await publishDraft(oxen, view, { message: message?.trim() || "Publish drafts", author });
  }

  // refresh this user's published-versions index from their doc files
  const site = await readSite(oxen, view);
  const rows: Record<string, unknown>[] = [];
  for (const page of site.pages) {
    const doc = await readDoc(oxen, view, page.slug);
    for (const section of docSections(doc)) {
      for (const version of section.versions) {
        rows.push({
          project_id: project.id,
          author_id: user.id,
          page_slug: page.slug,
          section_slug: section.slug,
          version_slug: version.slug,
          label: version.label,
        });
      }
    }
  }
  const { error: deleteError } = await supabase
    .from("section_versions")
    .delete()
    .match({ project_id: project.id, author_id: user.id });
  if (deleteError) throw new Error(`publish index refresh failed: ${deleteError.message}`);
  if (rows.length) {
    const { error: insertError } = await supabase.from("section_versions").insert(rows);
    if (insertError) throw new Error(`publish index refresh failed: ${insertError.message}`);
  }

  return { ok: true };
}

const proposeInput = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

/** Publishes any pending edits, then opens a proposal from the caller's draft to main. */
export async function proposeAction(input: z.infer<typeof proposeInput>): Promise<{ proposalId: string }> {
  const { projectId, title, description } = proposeInput.parse(input);
  const { oxen, view, user, project } = await requireProjectAccess(projectId);

  await publishAction({ projectId });
  const main = await oxen.getBranch(project.oxenRepo, "main");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposals")
    .insert({
      project_id: project.id,
      author_id: user.id,
      title,
      description: description || null,
      source_branch: view.branch,
      base_commit: main.commit_id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    console.error("proposal insert failed", error);
    throw new Error(error?.message ?? "could not create proposal");
  }

  return { proposalId: data.id };
}

const adoptInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  sectionSlug: slugSchema,
  versionSlug: slugSchema,
  authorId: z.uuid(),
  label: z.string().trim().min(1).max(80),
  existingSlugs: z.array(slugSchema).max(100),
});

/** Copies a teammate's published version into the caller's draft as a new alternate. */
export async function adoptVersionAction(
  input: z.infer<typeof adoptInput>,
): Promise<{ slug: string; markdown: string }> {
  const { projectId, pageSlug, sectionSlug, versionSlug, authorId, label, existingSlugs } = adoptInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);

  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "adopted";
  let slug = base;
  for (let n = 2; existingSlugs.includes(slug); n++) slug = `${base}-${n}`;

  const markdown = await adoptVersion(oxen, view, {
    fromBranch: draftBranchName(authorId),
    pageSlug,
    sectionSlug,
    versionSlug,
    asVersionSlug: slug,
  });
  return { slug, markdown };
}

const syncInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
});

/** Replaces this page in the caller's draft with main's published state. */
export async function syncPageFromMainAction(input: z.infer<typeof syncInput>): Promise<{ ok: boolean }> {
  const { projectId, pageSlug } = syncInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);
  await syncPageFromMain(oxen, view, pageSlug);
  return { ok: true };
}

const chatInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  message: z.string().trim().min(1).max(4000),
});

export type ChatResult =
  | { ok: true; reply: string; mutated: boolean }
  | { ok: false; error: string };

/**
 * One agent turn: persist the user message, run the tool loop against
 * their draft, persist and return the reply. `mutated` tells the client
 * to reload the draft view.
 */
export async function chatAction(input: z.infer<typeof chatInput>): Promise<ChatResult> {
  const { projectId, pageSlug, message } = chatInput.parse(input);
  const { oxen, view, user } = await requireProjectAccess(projectId);

  const llm = getLlmClient();
  if (!llm) {
    return { ok: false, error: "The assistant needs an Oxen.ai inference key (OXEN_API_KEY) configured." };
  }

  const supabase = await createClient();
  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .match({ project_id: projectId, user_id: user.id, page_slug: pageSlug })
    .order("created_at", { ascending: true })
    .limit(30);
  const history = (historyRows ?? []) as { role: "user" | "assistant"; content: string }[];

  await supabase.from("chat_messages").insert({
    project_id: projectId,
    user_id: user.id,
    page_slug: pageSlug,
    role: "user",
    content: message,
  });

  let turn;
  try {
    turn = await (await import("@/lib/agent/run")).runAgentTurn({ oxen, view, pageSlug, llm }, history, message);
  } catch (err) {
    console.error("agent turn failed", err);
    return { ok: false, error: "The assistant hit an error — try again." };
  }

  await supabase.from("chat_messages").insert({
    project_id: projectId,
    user_id: user.id,
    page_slug: pageSlug,
    role: "assistant",
    content: turn.reply,
  });

  return { ok: true, reply: turn.reply, mutated: turn.mutated };
}

const importPageInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("url"), url: z.string().max(2000) }),
    z.object({ kind: z.literal("html"), html: z.string().min(1).max(2_000_000) }),
    z.object({ kind: z.literal("image"), dataUrl: z.string().startsWith("data:image/").max(12_000_000) }),
  ]),
});

export type ImportResult = { ok: true; sections: number } | { ok: false; error: string };

/**
 * Imports a page from a URL, raw HTML, or a screenshot: replaces the page's
 * sections with the extracted copy and regenerates the wireframe. LLM does
 * the extraction when configured (required for images); the deterministic
 * extractor is the floor for URL/HTML.
 */
export async function importPageAction(input: z.infer<typeof importPageInput>): Promise<ImportResult> {
  const { projectId, pageSlug, source } = importPageInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);
  const llm = getLlmClient();

  let extracted: ExtractedSection[];
  try {
    if (source.kind === "image") {
      if (!llm) {
        return { ok: false, error: "Screenshot import needs an Oxen.ai inference key (OXEN_API_KEY)." };
      }
      extracted = await extractSectionsFromImage(llm, source.dataUrl);
    } else {
      const html = source.kind === "url" ? await fetchImportHtml(source.url) : source.html;
      extracted = await extractWithFallback(llm, html);
    }
  } catch (err) {
    if (err instanceof ImportFetchError) return { ok: false, error: err.message };
    console.error("import failed", err);
    return { ok: false, error: "Couldn't extract copy from that source." };
  }

  if (extracted.length === 0) {
    return { ok: false, error: "No copy found — is that a content page?" };
  }

  // write section files + doc structure (replaces the page)
  const content: DocContent[] = [];
  const used = new Set<string>();
  for (const section of extracted) {
    const base =
      section.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "section";
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);

    await writeSectionVersion(oxen, view, pageSlug, slug, "original", serializeElements(section.elements));
    content.push({
      kind: "section",
      slug,
      title: section.title,
      activeVersion: "original",
      versions: [{ slug: "original", label: "Original" }],
      linked: true,
    });
  }
  await replaceDoc(oxen, view, pageSlug, { version: 2, content });

  // lay it out
  const html = await generateWireframe(
    selectGenerator(llm),
    extracted.map((section, i) => ({
      slug: (content[i] as Extract<DocContent, { kind: "section" }>).slug,
      title: section.title,
      elements: section.elements,
    })),
  );
  await writeWireframe(oxen, view, pageSlug, html);

  return { ok: true, sections: content.length };
}

async function extractWithFallback(
  llm: ReturnType<typeof getLlmClient>,
  html: string,
): Promise<ExtractedSection[]> {
  if (llm) {
    try {
      return await extractSectionsWithLlm(llm, html);
    } catch (err) {
      console.warn("LLM extraction failed; using deterministic extractor", err);
    }
  }
  return extractSectionsFromHtml(html);
}

const generateWireframeInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
});

/**
 * Generates (or regenerates) the page's wireframe from its *linked*
 * sections' active copy and stages it in the caller's workspace.
 * LLM-designed when a key is configured; rule-based otherwise.
 */
export async function generateWireframeAction(
  input: z.infer<typeof generateWireframeInput>,
): Promise<{ html: string }> {
  const { projectId, pageSlug } = generateWireframeInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);

  const doc = await readDoc(oxen, view, pageSlug);
  const sections: SectionForLayout[] = await Promise.all(
    docSections(doc)
      .filter((section) => section.linked)
      .map(async (section) => ({
        slug: section.slug,
        title: section.title,
        elements: parseElementsMarkdown(
          (await readSectionVersion(oxen, view, pageSlug, section.slug, section.activeVersion)) ?? "",
        ),
      })),
  );

  const html = await generateWireframe(selectGenerator(getLlmClient()), sections);
  await writeWireframe(oxen, view, pageSlug, html);

  return { html };
}

const addPageInput = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(80),
});

export async function addPageAction(input: z.infer<typeof addPageInput>): Promise<{ slug: string }> {
  const { projectId, title } = addPageInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);

  const site = await readSite(oxen, view);
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "page";
  let slug = base;
  for (let n = 2; site.pages.some((p) => p.slug === slug); n++) slug = `${base}-${n}`;

  site.pages.push({ slug, title });
  await oxen.writeWorkspaceFile(view.repo, view.workspaceId, SITE_FILE_PATH, serializeSiteFile(site));
  await writeDoc(oxen, view, slug, { version: 2, content: [] });

  return { slug };
}
