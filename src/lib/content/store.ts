import type { OxenClient } from "@/lib/oxen/client";
import { OxenError } from "@/lib/oxen/client";
import type { CommitAuthor } from "@/lib/oxen/types";

import { parseDocFile, serializeDocFile, type DocFile } from "./doc";
import {
  SITE_FILE_PATH,
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
  await oxen.commitWorkspace(view.repo, view.workspaceId, view.branch, options);
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
    for (const [path, { source }] of comparison.changed) {
      if (source === null) continue; // v1: removals stay invisible via doc.json
      await oxen.writeWorkspaceFile(repo, workspaceId, path, source);
      wrote += 1;
    }
    if (wrote === 0) {
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
  for (const path of files) {
    const content = await oxen.readFile(view.repo, "main", path);
    await oxen.writeWorkspaceFile(view.repo, view.workspaceId, path, content);
  }
}
