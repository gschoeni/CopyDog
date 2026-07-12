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
- **True merge / conflict UX** — squash-apply is last-write-wins per file;
  removals don't propagate to main. Consider Oxen's merge + mergeability APIs.
- **Realtime presence** — Supabase Realtime pings when teammates publish
  ("Sarah published 2 new hero versions").
- **Version rename/delete UI** in the switcher; version history timeline per
  section (Oxen has the commits already).
- **Import jobs table + async pipeline** — imports are synchronous server
  actions today; fine locally, tighter on serverless timeouts.
- **Block-level wireframe slot re-linking UI** (manual override of the
  auto-matching).
- **Workspace GC** — named draft workspaces accumulate per user per project.
- **Rich text niceties**: links inside paragraphs, keyboard block menu (/),
  drag-to-reorder sections.
