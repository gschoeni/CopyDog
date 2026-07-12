# Planning

In this file, write the current phase status, the plan, what's next, with the current date of the status and any other notes that would be helpful for the future. Document each plan with the date that it happened, so that we can have a long running document of how the app evolved.

---

## 2026-07-12 — v1 Plan (agreed with founder)

Status: **Plan agreed, no code written yet.** This plan came out of a Q&A session with the founder; the resulting decisions are logged in [05_decisions.md](05_decisions.md), deferred ideas in [06_backlog.md](06_backlog.md).

### What v1 is

A collaborative copy + wireframe editor where:

- A **project** is a multi-page website. Each page has a copy document and a greyscale wireframe.
- Copy is **markdown sections** (H1–H6, paragraph, CTA, list, eyebrow, …). Each section can have multiple **alternate versions**, and every user can pick which version is *active* in their own view.
- The **wireframe** is LLM-generated HTML in our own greyscale design system, with slots the copy is injected into. Three view modes: Copy, Wireframe, Side-by-side.
- Users start from a **blank doc**, an **HTML/image upload**, or a **URL import**. (Vibe-code-from-prompt as an *entry point* is deferred, but the chat agent ships in v1 for editing.)
- A **chat agent** (Oxen.ai inference) can edit wireframe layout and brainstorm/rewrite copy.
- Collaboration is **async**: everyone autosaves privately, *publishes* to their own branch for the team to see, and opens **PR-style proposals** to change the project's canonical copy on `main`.

### Architecture

Three services, per AGENT.md: Vercel (Next.js + route handlers), Supabase (Postgres/Auth/RLS — the *index*), Oxen (version control + content — the *store*).

#### Oxen layout — one repo per project

Each project gets one Oxen repo under `OXEN_NAMESPACE`:

```
site.json                      # page order + sitemap (versioned)
pages/
  home/
    doc.json                   # section order, block types, wireframe slot bindings,
                               # and the project-canonical active version per section
    wireframe.html             # page layout in our greyscale design system, with slots
    sections/
      hero/
        punchy-headline.md     # one file per alternate version (frontmatter: author, label)
        benefit-led.md
      features/
        three-column.md
  about/
    ...
assets/                        # images and other binaries, versioned alongside
```

Key properties:

- **Files-as-versions.** An alternate version of a section is a sibling `.md` file. Toggling versions is a file read, not a VCS operation. Version files created by different users have different paths, so cross-user conflicts are structurally impossible.
- **`main` is the chosen copy.** `doc.json` on `main` names the canonical active version per section, so "what the team agreed on, and when" is itself versioned history.
- **`draft/{user_id}` branches** hold each user's published-but-not-proposed work.

#### Editing & save model (Oxen workspaces)

- Each user gets a **named Oxen workspace** per project (`draft-{user_id}`), based on their `draft/{user_id}` branch. Workspaces are server-side staging areas: writes stream to the server but don't touch history.
- **Autosave** = debounced file writes into the workspace as the user types. Private to the user, survives restarts.
- **Publish** = commit the workspace to `draft/{user_id}`. Teammates can now see and adopt your versions.
- **Propose** = open a PR-style proposal from `draft/{user_id}` → `main` (diff view, approve, merge).
- Draft branches sync from `main` after merges; because version files are per-author paths, merges stay conflict-free in practice. (Risk: verify Oxen's merge API supports this flow — see Risks.)

#### Wireframe ↔ copy linking

- `wireframe.html` elements carry slot attributes (e.g. `data-copy="hero"` on a section wrapper). `doc.json` maps copy sections → wireframe slots and blocks → elements (by role/order, manually overridable).
- Rendering a wireframe = load `wireframe.html` + resolve each section's active version (user's pointer, falling back to project canonical) + inject copy. Pure function, easily unit-tested.
- The LLM does the "magic" auto-linking at import time; users can re-link manually.

#### LLM: Oxen.ai inference

All LLM calls go through Oxen.ai's OpenAI-compatible chat completions API (`https://hub.oxen.ai/api/ai`, `Authorization: Bearer $OXEN_API_KEY`). It supports vision (image → wireframe), streaming, and tool calling — one provider covers import conversion, the chat agent, and copy generation. Wrap it in a thin typed client (`src/lib/llm/`) so models are configurable per task.

#### Postgres schema (the index — pointers only, never content)

| Table | Purpose |
|-------|---------|
| `profiles` | Display name/avatar, keyed to `auth.users` |
| `projects` | Name, slug, `oxen_repo`, owner |
| `project_members` | `owner` \| `editor` (everyone edits in v1) |
| `pages` | Fast page listings; mirrors `site.json` |
| `sections` | Fast section listings; mirrors `doc.json` |
| `section_versions` | Pointers to version files: author, label, oxen path, draft/published status |
| `active_versions` | Per-user active pick per section (personal preview state) |
| `proposals` | PR-style: author, source branch, base commit, status, merged commit |
| `comments` | Notes on sections/versions/proposals; resolvable |
| `import_jobs` | URL/HTML/image import pipeline status |
| `chat_threads` / `chat_messages` | Agent conversation history (app state → Postgres) |

RLS policies live in the same schema file as each table (Drizzle → `supabase/migrations/`). Supabase Realtime broadcasts metadata changes ("Sarah published a hero version") to refresh listings — no CRDT.

#### Design system

- Greyscale wireframe component library (Relume-inspired): hero, features, CTA, testimonial, footer, nav, etc. Built as a **swappable module** — components + tokens behind an interface, so other design systems can drop in later.
- App UI uses centralized design tokens (CSS variables) with first-class light/dark modes.

### Tech choices

Next.js (App Router, TypeScript) · Tailwind + CSS-variable design tokens · Lexical editor (markdown canonical: serialize on save, deserialize on load) · Drizzle for schema/migrations · Supabase JS + local `supabase start` for dev · Typed Oxen HTTP client (`src/lib/oxen/`) for repos/branches/workspaces/diffs/merges · Vitest (unit/integration) + Playwright (e2e) · Oxen API stub server for fast tests, opt-in live tests against OxenHub.

### Phases

Each phase ends with all checks green and a commit. Work happens on feature branches off `main`.

**Phase 0 — Foundation** ✅ definition of done: `pnpm test`, `pnpm lint`, `pnpm build` all pass in CI and are documented in AGENT.md (replacing the TODOs).
- Scaffold Next.js + TypeScript + Tailwind; design tokens with light/dark toggle.
- Drizzle + Supabase local setup; `supabase db reset` replays cleanly.
- Vitest + Playwright wiring; Oxen client skeleton with stub server for tests.

**Phase 1 — Auth & projects**
- Supabase Auth: Google OAuth + email magic link.
- Projects CRUD, members, RLS; Oxen repo provisioned per project.
- Clean empty state: the three entry points presented as the landing experience.

**Phase 2 — Copy editor (blank-doc entry point)**
- Lexical editor with block types (H1–H6, paragraph, CTA, list, eyebrow), section grouping.
- Markdown ⇄ editor round-trip (heavily unit-tested — canonical format).
- Autosave into the user's Oxen workspace; multi-page navigation.

**Phase 3 — Versions & notes**
- Alternate versions per section (create, label, toggle); per-user active pointers.
- Notes/comments on sections and versions.

**Phase 4 — Wireframe & view modes**
- Greyscale design system components; `wireframe.html` rendering with copy injection.
- Copy / Wireframe / Side-by-side modes; edits in copy mode live-update the wireframe.
- "Generate wireframe from my copy" (LLM) for the blank-doc path.

**Phase 5 — Import pipeline**
- URL crawl, raw HTML upload, JPG/PNG/PDF upload → LLM converts to our design system, extracts copy into sections, auto-links slots.
- `import_jobs` with progress UI; assets stored in Oxen.

**Phase 6 — Publish & proposals**
- Publish (workspace → draft branch commit), team visibility of published versions, adopt a teammate's version into your view.
- PR-style proposals: diff vs `main`, approve, merge; canonical pointer updates in `doc.json`.

**Phase 7 — Chat agent**
- Chat panel (streaming) with tool calls that edit wireframe layout and create copy versions; changes land in your workspace like any edit.

**Phase 8 — Export & polish**
- Export raw HTML (wireframe + active copy). Figma/MCP export is backlog.
- Design polish pass, onboarding-free first-run experience.

### Risks / things to verify early

1. **Oxen merge API** — confirm branch→branch merge (or implement proposal merge as a server-side workspace commit replaying the source branch's files onto `main`). Verify in Phase 0/1 spike.
2. **Workspace-per-user-per-project scale** — named workspaces persist; confirm limits/cleanup story.
3. **Lexical markdown fidelity** — custom blocks (CTA, eyebrow, section wrappers) must round-trip; lock down with unit tests before building on top.
4. **LLM import quality** — image→wireframe is the hardest path; build eval fixtures (sample sites/screenshots) early in Phase 5.

### Next step

Start Phase 0 on a feature branch.
