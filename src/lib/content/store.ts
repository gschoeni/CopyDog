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
