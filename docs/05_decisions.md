# Decisions

In this file, write working decisions & rationales for future reference.

## 2026-07-12 — v1 planning session

**Section versions are sibling files, not branches or commits.** Each alternate version of a section is its own `.md` file under `pages/{page}/sections/{section}/`. Toggling is a file read (instant), commits give history, and branches stay reserved for per-user drafts. Branch-per-version would make rendering a page a cross-branch scatter-read; commits-as-versions conflates history with alternatives ("fix a typo in version B" rewrites what history means).

**Oxen workspaces are the autosave layer; commits are deliberate publishes.** Each user gets a named workspace (`draft-{user_id}`) per project. Keystrokes stream into the workspace (debounced) without touching history. Committing the workspace to `draft/{user_id}` is the explicit "publish for the team to see" action. This keeps history readable and meaningful instead of one-commit-per-keystroke noise.

**Promotion to canonical copy is PR-style.** The project's `main` branch holds the agreed copy. Editors open a proposal (diff vs `main`), someone approves, it merges. Chosen over any-editor-pushes-to-main because the review moment — client sees the diff, approves the copy — *is* the product's collaboration story.

**Async collaboration, no CRDT.** Branch-per-user plus per-author version file paths make conflicts structurally impossible, so live co-editing machinery (Yjs etc.) isn't needed. Supabase Realtime pings the UI when teammates publish. Live cursors are backlog.

**Multi-page sites in v1.** A project holds multiple pages (each with doc + wireframe) from day one; `site.json` is the versioned sitemap. Founder call — single-page would have been cheaper but multi-page is core to real projects.

**v1 entry points: blank doc, HTML/image upload, URL import.** Vibe-code-from-prompt as an *entry point* is deferred (backlog), but the chat agent itself ships in v1 for editing wireframes and brainstorming copy.

**Oxen.ai is the LLM provider.** OpenAI-compatible chat completions at `https://hub.oxen.ai/api/ai` (`OXEN_API_KEY`), with vision, streaming, and tool calling. One provider covers import conversion, the chat agent, and copy generation — and keeps the vendor list at three (Vercel, Supabase, Oxen). Docs: https://docs.oxen.ai/examples/inference/chat_completions

**Auth: Google OAuth + email magic link.** No passwords. Magic link is the fallback for clients without Google accounts. Both built into Supabase Auth.

**Roles: owner + editor only in v1.** Everyone invited gets a draft branch and full editing. Matches "sometimes the client owns the copy entirely." Commenter/viewer roles are backlog.

**One Oxen repo per project.** Clean permission boundary, clean history, repo name stored on the `projects` row. Pages are directories inside the repo.

**`main`'s `doc.json` names the canonical active version per section.** So "which copy did we choose, and when" is itself versioned content — the decision trail the Why doc asks for. Per-user active pointers (personal previews) live in Postgres because they're queryable app state, not content.
