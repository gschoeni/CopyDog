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

## 2026-07-12 — decisions made while building

**Wireframes are LLM-optional.** Every LLM-powered feature has a deterministic
floor: rule-based wireframe generation, semantic-HTML import extraction. The LLM
upgrades quality when `OXEN_API_KEY` is set; nothing breaks when it isn't. This
also makes e2e deterministic and free.

**Wireframe HTML is sanitized, always.** LLM output and imported HTML pass an
allowlist sanitizer (structural tags, wf-* classes only, inert links) before
touching the DOM; copy is escaped at injection. The wireframe renders as
always-light "paper" in both app themes — it's an artifact, not a UI surface.

**Copy injection is a pure, isomorphic function.** `injectCopy(wireframe,
sections)` runs server-side and re-runs in the browser on every keystroke, so the
copy doc and wireframe can never disagree. Slots match by block type in order;
unfilled slots grey out; extra copy flows to a data-overflow container.

**Proposal merge = squash-apply.** Merging writes the source branch's changed
files onto main through a temporary workspace, as one commit. No 3-way merge
machinery; per-author file paths make real conflicts structurally rare. File
*removals* don't propagate (doc.json controls visibility) — revisit if it bites.

**Cross-user version discovery is a Postgres index written at publish time.**
Draft-private state stays in files; `section_versions` rows are refreshed from
doc.json on every publish. Adoption is a file copy from the publisher's branch
into the adopter's workspace.

**Agent edits are user edits.** The assistant's tools write to the caller's
draft view through the same store functions as the editor — new versions, never
overwrites, never main. Conversations are per user+page in Postgres.

**One CSS source of truth for the design system.** `design-system-css.ts` is
injected as a <style> in the app and inlined into HTML exports, so exported
pages are pixel-identical standalone documents.

**e2e runs fully offline.** The in-memory Oxen stub is served over HTTP for
Playwright, including a fixture site for URL import and a scripted
chat-completions endpoint for the agent loop. Ports: app 3131, stub 3232
(3000 belongs to the local oxen-server).

**Toolbar actions are icons, not text.** Founder call (2026-07-12): editor
chrome (Import, Assistant, Update from main, Publish, Propose) renders as
icon-only buttons for a clean, minimal look. Icons are hand-rolled stroke SVGs
in `src/components/ui/icons.tsx` — no icon library dependency — used via
`<Button size="icon">`, always with `aria-label` + `title` naming the action.
Dialogs and forms keep text labels, where prose context does the explaining.
