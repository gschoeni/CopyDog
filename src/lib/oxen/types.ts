/** Shapes returned by the Oxen HTTP API (https://docs.oxen.ai/http-api). */

export interface OxenCommit {
  id: string;
  parent_ids: string[];
  message: string;
  author: string;
  email: string;
  timestamp: string;
}

export interface OxenRepository {
  namespace: string;
  name: string;
  latest_commit?: OxenCommit;
}

export interface OxenBranch {
  name: string;
  commit_id: string;
}

export interface OxenWorkspace {
  id: string;
  name?: string;
  commit: OxenCommit;
}

export interface OxenDirEntry {
  filename: string;
  hash: string;
  is_dir: boolean;
  size: number;
  data_type: "dir" | "text" | "image" | "video" | "audio" | "tabular" | "binary";
  mime_type: string;
  extension: string;
}

export interface OxenDirListing {
  entries: OxenDirEntry[];
  page_number: number;
  page_size: number;
  total_pages: number;
  total_entries: number;
}

export interface CommitAuthor {
  name: string;
  email: string;
}
