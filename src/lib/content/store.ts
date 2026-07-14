import type { OxenClient } from "@/lib/oxen/client";
import { OxenError } from "@/lib/oxen/client";
import type { CommitAuthor } from "@/lib/oxen/types";

import { parseDocFile, serializeDocFile, type DocFile } from "./doc";
import {
  SITE_FILE_PATH,
  elementsRunPath,
  pageDocPath,
  pageWireframePath,
  parseSiteFile,
  sectionVersionPath,
  type SiteFile,
} from "./site";

/**
 * A user's *draft view* of a project: their named workspace pinned to their
 * `draft/{userId}` branch. Reads see staged autosaves first, then the branch
 * (which starts as a copy of main). Writes stage into the workspace and touch
 * no history until the user publishes.
 */
export interface DraftView {
  repo: string;
  workspaceId: string;
  branch: string;
}

export function draftBranchName(userId: string): string {
  return `draft/${userId}`;
}

export function draftWorkspaceId(userId: string): string {
  return `draft-${userId}`;
}

/** Idempotently ensures the user's draft branch + workspace exist. */
export async function ensureDraftView(oxen: OxenClient, repo: string, userId: string): Promise<DraftView> {
  const branch = draftBranchName(userId);
  await oxen.createBranch(repo, branch, "main"); // returns existing branch if present
  const workspaceId = draftWorkspaceId(userId);
  await oxen.getOrCreateWorkspace(repo, { workspaceId, branchName: branch, name: workspaceId });
  return { repo, workspaceId, branch };
}

export async function readSite(oxen: OxenClient, view: DraftView): Promise<SiteFile> {
  return parseSiteFile(await oxen.readWorkspaceFile(view.repo, view.workspaceId, SITE_FILE_PATH));
}

export async function readDoc(oxen: OxenClient, view: DraftView, pageSlug: string): Promise<DocFile> {
  return parseDocFile(await oxen.readWorkspaceFile(view.repo, view.workspaceId, pageDocPath(pageSlug)));
}

export async function writeDoc(oxen: OxenClient, view: DraftView, pageSlug: string, doc: DocFile): Promise<void> {
  await oxen.writeWorkspaceFile(view.repo, view.workspaceId, pageDocPath(pageSlug), serializeDocFile(doc));
}

/** Every content file a doc's structure references (section versions + element runs). */
function docContentPaths(pageSlug: string, doc: DocFile): string[] {
  const paths: string[] = [];
  for (const entry of doc.content) {
    if (entry.kind === "elements") {
      paths.push(elementsRunPath(pageSlug, entry.slug));
    } else {
      for (const version of entry.versions) paths.push(sectionVersionPath(pageSlug, entry.slug, version.slug));
    }
  }
  return paths;
}

/**
 * Writes a page's doc.json and stages removal of content files the previous
 * structure referenced but the new one doesn't. Only for full-page replaces
 * (import) where the editor reloads afterwards — autosaves must use
 * `writeDoc` instead, because the editor can resurrect deleted sections via
 * undo and their files have to survive until publish prunes them.
 */
export async function replaceDoc(oxen: OxenClient, view: DraftView, pageSlug: string, doc: DocFile): Promise<void> {
  let previous: DocFile | null = null;
  try {
    previous = await readDoc(oxen, view, pageSlug);
  } catch (err) {
    if (err instanceof OxenError && err.status !== 404) throw err;
    previous = null; // missing or unparseable — nothing to prune
  }
  await writeDoc(oxen, view, pageSlug, doc);
  if (!previous) return;
  const keep = new Set(docContentPaths(pageSlug, doc));
  const orphans = docContentPaths(pageSlug, previous).filter((path) => !keep.has(path));
  await oxen.deleteWorkspaceFiles(view.repo, view.workspaceId, orphans);
}

/** Returns the section version's markdown, or null if the file doesn't exist yet. */
export async function readSectionVersion(
  oxen: OxenClient,
  view: DraftView,
  pageSlug: string,
  sectionSlug: string,
  versionSlug: string,
): Promise<string | null> {
  try {
    return await oxen.readWorkspaceFile(view.repo, view.workspaceId, sectionVersionPath(pageSlug, sectionSlug, versionSlug));
  } catch (err) {
    if (err instanceof OxenError && err.status === 404) return null;
    throw err;
  }
}

export async function writeSectionVersion(
  oxen: OxenClient,
  view: DraftView,
  pageSlug: string,
  sectionSlug: string,
  versionSlug: string,
  markdown: string,
): Promise<void> {
  await oxen.writeWorkspaceFile(
    view.repo,
    view.workspaceId,
    sectionVersionPath(pageSlug, sectionSlug, versionSlug),
    markdown,
  );
}

/** Returns a loose element run's markdown, or null if it doesn't exist. */
export async function readElementsRun(
  oxen: OxenClient,
  view: DraftView,
  pageSlug: string,
  runSlug: string,
): Promise<string | null> {
  try {
    return await oxen.readWorkspaceFile(view.repo, view.workspaceId, elementsRunPath(pageSlug, runSlug));
  } catch (err) {
    if (err instanceof OxenError && err.status === 404) return null;
    throw err;
  }
}

export async function writeElementsRun(
  oxen: OxenClient,
  view: DraftView,
  pageSlug: string,
  runSlug: string,
  markdown: string,
): Promise<void> {
  await oxen.writeWorkspaceFile(view.repo, view.workspaceId, elementsRunPath(pageSlug, runSlug), markdown);
}

/** Returns the page's wireframe HTML, or null if none has been created yet. */
export async function readWireframe(oxen: OxenClient, view: DraftView, pageSlug: string): Promise<string | null> {
  try {
    return await oxen.readWorkspaceFile(view.repo, view.workspaceId, pageWireframePath(pageSlug));
  } catch (err) {
    if (err instanceof OxenError && err.status === 404) return null;
    throw err;
  }
}

export async function writeWireframe(
  oxen: OxenClient,
  view: DraftView,
  pageSlug: string,
  html: string,
): Promise<void> {
  await oxen.writeWorkspaceFile(view.repo, view.workspaceId, pageWireframePath(pageSlug), html);
}

/** Publishes everything staged in the draft workspace to the user's draft branch. */
export async function publishDraft(
  oxen: OxenClient,
  view: DraftView,
  options: { message: string; author: CommitAuthor },
): Promise<void> {
  await pruneOrphanContent(oxen, view);
  await oxen.commitWorkspace(view.repo, view.workspaceId, view.branch, options);
}

/**
 * Stages removal of files under pages/ that no doc.json references —
 * deleted sections' version files and out-of-range element runs. Autosaves
 * never delete (the editor can resurrect content via undo), so publish is
 * where orphans die; history and proposal diffs stay free of phantom files.
 *
 * Only *committed* files are candidates: a staged-but-unreferenced file is
 * usually a write whose doc.json update is still debouncing in the editor,
 * so it must survive this publish (a real orphan gets pruned on the next).
 */
async function pruneOrphanContent(oxen: OxenClient, view: DraftView): Promise<void> {
  const site = await readSite(oxen, view);
  const referenced = new Set<string>();
  const prunablePages = new Set<string>();
  for (const page of site.pages) {
    referenced.add(pageDocPath(page.slug));
    referenced.add(pageWireframePath(page.slug));
    try {
      const doc = await readDoc(oxen, view, page.slug);
      for (const path of docContentPaths(page.slug, doc)) referenced.add(path);
      prunablePages.add(page.slug);
    } catch {
      // unreadable doc — we can't know what it references; leave that page alone
    }
  }

  const branchFiles = await listFilesAt(oxen, view.repo, view.branch, "pages").catch(() => [] as string[]);
  const orphans = branchFiles.filter((path) => {
    if (!path.startsWith("pages/") || referenced.has(path)) return false;
    return prunablePages.has(path.split("/")[1]!);
  });
  await oxen.deleteWorkspaceFiles(view.repo, view.workspaceId, orphans);
}

/** True when the workspace holds edits that haven't been published yet. */
export async function hasUnpublishedChanges(oxen: OxenClient, view: DraftView): Promise<boolean> {
  const changes = await oxen.workspaceChanges(view.repo, view.workspaceId);
  return changes.added.length + changes.modified.length + changes.removed.length > 0;
}

/**
 * Copies a version file from another user's *published* branch into this
 * user's workspace as a new alternate version. Adoption is just a file
 * copy — the whole point of files-as-versions.
 */
export async function adoptVersion(
  oxen: OxenClient,
  view: DraftView,
  options: { fromBranch: string; pageSlug: string; sectionSlug: string; versionSlug: string; asVersionSlug: string },
): Promise<string> {
  const { fromBranch, pageSlug, sectionSlug, versionSlug, asVersionSlug } = options;
  const markdown = await oxen.readFile(view.repo, fromBranch, sectionVersionPath(pageSlug, sectionSlug, versionSlug));
  await writeSectionVersion(oxen, view, pageSlug, sectionSlug, asVersionSlug, markdown);
  return markdown;
}

/** All file paths under a revision, walked recursively. */
export async function listFilesAt(oxen: OxenClient, repo: string, revision: string, dir = ""): Promise<string[]> {
  const listing = await oxen.listDir(repo, revision, dir);
  const files: string[] = [];
  for (const entry of listing.entries) {
    const path = dir ? `${dir}/${entry.filename}` : entry.filename;
    if (entry.is_dir) {
      files.push(...(await listFilesAt(oxen, repo, revision, path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

export interface BranchComparison {
  /** path -> { ours, theirs } where either side may be null (added/removed) */
  changed: Map<string, { source: string | null; target: string | null }>;
}

/** Content-level comparison of two revisions (small-repo simple walk). */
export async function compareRevisions(
  oxen: OxenClient,
  repo: string,
  sourceRevision: string,
  targetRevision: string,
): Promise<BranchComparison> {
  const [sourceFiles, targetFiles] = await Promise.all([
    listFilesAt(oxen, repo, sourceRevision),
    listFilesAt(oxen, repo, targetRevision),
  ]);
  const all = new Set([...sourceFiles, ...targetFiles]);
  const changed = new Map<string, { source: string | null; target: string | null }>();

  await Promise.all(
    [...all].map(async (path) => {
      const [source, target] = await Promise.all([
        sourceFiles.includes(path) ? oxen.readFile(repo, sourceRevision, path) : Promise.resolve(null),
        targetFiles.includes(path) ? oxen.readFile(repo, targetRevision, path) : Promise.resolve(null),
      ]);
      if (source !== target) changed.set(path, { source, target });
    }),
  );

  return { changed };
}

/**
 * Applies a source branch's state onto main as one squash commit
 * ("merge" for proposals). Files that differ are written through a
 * temporary workspace on main; the workspace is cleaned up afterwards.
 */
export async function applyBranchToMain(
  oxen: OxenClient,
  repo: string,
  sourceBranch: string,
  options: { message: string; author: CommitAuthor },
): Promise<string> {
  const comparison = await compareRevisions(oxen, repo, sourceBranch, "main");
  const workspaceId = `merge-${Math.random().toString(36).slice(2, 10)}`;
  await oxen.getOrCreateWorkspace(repo, { workspaceId, branchName: "main", name: workspaceId });
  try {
    let wrote = 0;
    const removals: string[] = [];
    for (const [path, { source }] of comparison.changed) {
      if (source === null) {
        removals.push(path); // deleted on the proposal branch — delete on main too
        continue;
      }
      await oxen.writeWorkspaceFile(repo, workspaceId, path, source);
      wrote += 1;
    }
    await oxen.deleteWorkspaceFiles(repo, workspaceId, removals);
    if (wrote + removals.length === 0) {
      throw new Error("nothing to merge");
    }
    const commit = await oxen.commitWorkspace(repo, workspaceId, "main", options);
    return commit.id;
  } finally {
    await oxen.deleteWorkspace(repo, workspaceId).catch(() => {});
  }
}

/**
 * Replaces one page of the user's draft with main's published state
 * (doc.json, wireframe, and every section file main knows about).
 * Explicitly destructive for that page's unpublished edits — callers confirm.
 */
export async function syncPageFromMain(oxen: OxenClient, view: DraftView, pageSlug: string): Promise<void> {
  const prefix = `pages/${pageSlug}/`;
  const files = (await listFilesAt(oxen, view.repo, "main", `pages/${pageSlug}`)).filter((p) => p.startsWith(prefix));
  if (files.length === 0) return; // page doesn't exist on main — nothing to replace with

  // draft-only content files (sections/runs main doesn't know) must go too,
  // or they'd survive the "replace with main" as orphans
  let draftDoc: DocFile | null = null;
  try {
    draftDoc = await readDoc(oxen, view, pageSlug);
  } catch {
    draftDoc = null;
  }

  for (const path of files) {
    const content = await oxen.readFile(view.repo, "main", path);
    await oxen.writeWorkspaceFile(view.repo, view.workspaceId, path, content);
  }

  if (draftDoc) {
    const onMain = new Set(files);
    const orphans = docContentPaths(pageSlug, draftDoc)
      .concat(pageWireframePath(pageSlug))
      .filter((path) => !onMain.has(path));
    await oxen.deleteWorkspaceFiles(view.repo, view.workspaceId, orphans);
  }
}
