import type {
  CommitAuthor,
  OxenBranch,
  OxenCommit,
  OxenDirListing,
  OxenRepository,
  OxenWorkspace,
} from "./types";

export class OxenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "OxenError";
  }
}

export interface OxenClientConfig {
  /** OxenHub API token (`OXEN_TOKEN`). */
  token: string;
  /** Namespace repos live under (`OXEN_NAMESPACE`). */
  namespace: string;
  /** Defaults to OxenHub; point at a stub or self-hosted oxen-server in tests. */
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Thin typed wrapper over the Oxen HTTP API — only the endpoints CopyDog uses.
 * Server-side only: the token must never reach the browser.
 */
export class OxenClient {
  private readonly token: string;
  readonly namespace: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OxenClientConfig) {
    this.token = config.token;
    this.namespace = config.namespace;
    this.baseUrl = (config.baseUrl ?? "https://hub.oxen.ai").replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  // -- repositories ------------------------------------------------------

  async createRepo(
    name: string,
    options: { description?: string; isPublic?: boolean; user: CommitAuthor },
  ): Promise<OxenRepository> {
    const data = await this.request<{ repository: OxenRepository }>("POST", `/api/repos`, {
      json: {
        namespace: this.namespace,
        name,
        description: options.description,
        is_public: options.isPublic ?? false,
        user: options.user,
      },
    });
    return data.repository;
  }

  async getRepo(name: string): Promise<OxenRepository> {
    const data = await this.request<{ repository: OxenRepository }>("GET", this.repoPath(name));
    return data.repository;
  }

  async deleteRepo(name: string): Promise<void> {
    await this.request("DELETE", this.repoPath(name));
  }

  // -- branches ----------------------------------------------------------

  async listBranches(repo: string): Promise<OxenBranch[]> {
    const data = await this.request<{ branches: OxenBranch[] }>("GET", `${this.repoPath(repo)}/branches`);
    return data.branches;
  }

  async getBranch(repo: string, name: string): Promise<OxenBranch> {
    const data = await this.request<{ branch: OxenBranch }>(
      "GET",
      `${this.repoPath(repo)}/branches/${encodeURIComponent(name)}`,
    );
    return data.branch;
  }

  /** Creates a branch from another branch or commit id. Returns the existing branch if the name is taken. */
  async createBranch(repo: string, newName: string, fromName: string): Promise<OxenBranch> {
    const data = await this.request<{ branch: OxenBranch }>("POST", `${this.repoPath(repo)}/branches`, {
      json: { new_name: newName, from_name: fromName },
    });
    return data.branch;
  }

  // -- files & directories -----------------------------------------------

  /** Reads a file's content at a revision (branch name or commit id). */
  async readFile(repo: string, revision: string, path: string): Promise<string> {
    const res = await this.rawRequest("GET", `${this.repoPath(repo)}/file/${joinResource(revision, path)}`);
    return res.text();
  }

  async listDir(repo: string, revision: string, path = ""): Promise<OxenDirListing> {
    return this.request<OxenDirListing>("GET", `${this.repoPath(repo)}/dir/${joinResource(revision, path)}`);
  }

  // -- workspaces ----------------------------------------------------------

  /**
   * Idempotently gets or creates a named workspace pinned to a branch.
   * Named workspaces persist across commits and fast-forward to the new head.
   *
   * Newer servers expose `PUT /workspaces/get_or_create`; older ones
   * (<= 0.50.x, e.g. a local oxen-server) use `PUT /workspaces` — fall back
   * on 404 so both work.
   */
  async getOrCreateWorkspace(
    repo: string,
    options: { workspaceId: string; branchName: string; name?: string },
  ): Promise<OxenWorkspace> {
    const json = {
      workspace_id: options.workspaceId,
      branch_name: options.branchName,
      name: options.name,
    };
    try {
      const data = await this.request<{ workspace: OxenWorkspace }>(
        "PUT",
        `${this.repoPath(repo)}/workspaces/get_or_create`,
        { json },
      );
      return data.workspace;
    } catch (err) {
      if (!(err instanceof OxenError) || err.status !== 404) throw err;
      const data = await this.request<{ workspace: OxenWorkspace }>("PUT", `${this.repoPath(repo)}/workspaces`, {
        json,
      });
      return data.workspace;
    }
  }

  async deleteWorkspace(repo: string, workspaceId: string): Promise<void> {
    await this.request("DELETE", `${this.repoPath(repo)}/workspaces/${encodeURIComponent(workspaceId)}`);
  }

  /**
   * Stages a file into a workspace. `path` is the full target path in the repo;
   * the upload lands in its directory under the filename's basename.
   */
  async writeWorkspaceFile(
    repo: string,
    workspaceId: string,
    path: string,
    content: string | Blob,
  ): Promise<void> {
    const { dir, base } = splitPath(path);
    const form = new FormData();
    const blob = typeof content === "string" ? new Blob([content], { type: "text/plain" }) : content;
    form.append("file", blob, base);
    await this.rawRequest(
      "POST",
      `${this.repoPath(repo)}/workspaces/${encodeURIComponent(workspaceId)}/files/${encodePath(dir)}`,
      { body: form },
    );
  }

  /** Reads a staged (or base-commit) file from a workspace. */
  async readWorkspaceFile(repo: string, workspaceId: string, path: string): Promise<string> {
    const res = await this.rawRequest(
      "GET",
      `${this.repoPath(repo)}/workspaces/${encodeURIComponent(workspaceId)}/files/${encodePath(path)}`,
    );
    return res.text();
  }

  /**
   * Commits everything staged in the workspace onto `branch` as one atomic commit.
   * Fails with 422 if the branch has advanced past the workspace's base commit.
   */
  async commitWorkspace(
    repo: string,
    workspaceId: string,
    branch: string,
    options: { message: string; author: CommitAuthor },
  ): Promise<OxenCommit> {
    const data = await this.request<{ commit: OxenCommit }>(
      "POST",
      `${this.repoPath(repo)}/workspaces/${encodeURIComponent(workspaceId)}/merge/${encodeURIComponent(branch)}`,
      {
        json: {
          message: options.message,
          author: options.author.name,
          email: options.author.email,
        },
      },
    );
    return data.commit;
  }

  // -- internals -----------------------------------------------------------

  private repoPath(repo: string): string {
    return `/api/repos/${encodeURIComponent(this.namespace)}/${encodeURIComponent(repo)}`;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { json?: unknown } = {},
  ): Promise<T> {
    const res = await this.rawRequest(method, path, {
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
      contentType: options.json !== undefined ? "application/json" : undefined,
    });
    return (await res.json()) as T;
  }

  private async rawRequest(
    method: string,
    path: string,
    options: { body?: BodyInit; contentType?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (options.contentType) headers["Content-Type"] = options.contentType;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new OxenError(`Oxen API ${method} ${path} failed: ${res.status}`, res.status, body);
    }
    return res;
  }
}

/** Joins a revision and file path into a `resource` path segment, percent-encoding each part. */
function joinResource(revision: string, path: string): string {
  return encodePath(path ? `${revision}/${path}` : revision);
}

function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function splitPath(path: string): { dir: string; base: string } {
  const idx = path.lastIndexOf("/");
  return idx === -1
    ? { dir: "", base: path }
    : { dir: path.slice(0, idx), base: path.slice(idx + 1) };
}
