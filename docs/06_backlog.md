# Backlog

In this file, write future ideas, links, and things we should explore.

## Deferred from v1 (2026-07-12 planning session)

- **Vibe-code-from-prompt entry point** — start a project from a pure text prompt (the chat agent ships in v1, so this is mostly a new-project flow around existing machinery).
- **Figma MCP import** — bring a Figma design in as a wireframe + copy.
- **Export to Figma / Claude Code / other tools via MCP** — v1 exports raw HTML only.
- **Commenter / viewer roles** — read-only clients who can leave notes but not edit; v1 is owner + editor.
- **Live co-editing (CRDT / Yjs)** — real-time cursors inside a shared doc; v1 is async branches + Supabase Realtime pings.
- **Swappable design systems** — the greyscale system is built behind an interface for this; actual alternate systems (or brand theming) come later.
- **Sitemap as an agent input** — prompt the agent with a sitemap to scaffold a multi-page project.

## Ideas / explore

- Hemingway-style writing feedback in copy mode (readability, passive voice).
- Eval fixture suite for import quality: a set of reference sites/screenshots with expected section extraction, to regression-test the LLM import pipeline.
- Workspace cleanup/GC policy for abandoned drafts.

## Added during the v1 build (2026-07-12)

- **Streaming assistant replies** (SSE) — replies currently arrive whole.
- **True merge / conflict UX** — squash-apply is last-write-wins per file.
  Consider Oxen's merge + mergeability APIs. (Removals now propagate to main
  as of the 2026-07-13 review.)
- **Realtime presence** — Supabase Realtime pings when teammates publish
  ("Sarah published 2 new hero versions").
- **Version rename/delete UI** in the switcher; version history timeline per
  section (Oxen has the commits already).
- **Import jobs table + async pipeline** — imports are synchronous server
  actions today; fine locally, tighter on serverless timeouts.
- **Block-level wireframe slot re-linking UI** (manual override of the
  auto-matching).
- **Workspace GC** — named draft workspaces accumulate per user per project.
- **Rich text niceties**: links inside paragraphs, keyboard block menu (/).
- **Block multi-select** (click handles with shift, like Notion) on top of the
  text-selection grouping that exists now.
- **AI sectioning pass** — "section this page for me": proposes named,
  linked sections from loose copy (assistant tool + pre-generation offer).

## Added during the code review (2026-07-13)

- **Autosave retry coordination** — a failed run/section save alongside a
  successful structure save can point doc.json at stale content until the
  user types again. The "Save failed" badge should retry content saves (or
  re-send both) instead of waiting for the next edit.
- **Transactional publish index refresh** — `section_versions` refresh is
  delete-then-insert; a mid-flight failure now throws (no more silent
  `{ok:true}`), but an RPC doing both atomically would remove the empty-index
  window entirely.
- **Standardize server-action result shapes** — three conventions coexist:
  bare `{error}` (projects), `{ok, error}` discriminated (pages/proposals),
  and `throw` (proposeAction). Converge on the discriminated shape.
- **Validate `pageSlug` against site.json** in import/chat/save actions —
  writes to a slug not in the sitemap create unreachable `pages/{slug}/…`
  files in the caller's draft (own-repo pollution only, publish-prune cleans
  content files but not doc.json/wireframe).
- **site.json concurrent edits** — two users adding pages then publishing is
  last-writer-wins on site.json; the losing page's files survive but its
  sitemap entry vanishes. Needs a merge-aware sitemap (or pages in Postgres).
- **Undo across publish loses pruned version files** — publish prunes
  version files of sections deleted at publish time; a later undo restores
  the section and its *active* copy (the editor re-saves it) but alternate
  version files are gone. Rare (publish-while-deleted, then undo); revisit if
  it bites.
