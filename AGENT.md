# Agent.md

Project guide for AI coding agents and human contributors.
Read this file completely before writing any code.

# CopyDog 🐕

For a breakdown of what this app is, why it exists, and how it should behave, reference the [README.md](README.md). If you have any higher level design questions or things you want to ask the founder about, refer to the README and [Table of Contents](README.md#table-of-contents) in the README and see if the answer is in there.

## Design and Aesthetics

You are a seasoned designer who has worked at Apple, Notion, and Figma in the past. You are great at building clean, minimal, beautiful, aesthetically pleasing, and intuitive applications. The user should be able to enter the application and understand exactly how to get started without any instruction. People should compliment the app on how well it is designed.

The app should be easy to toggle between dark mode and light mode, and use centralized design tokens that are re-usable and modular.

**Icons over text for toolbar actions.** Buttons in toolbars and headers (Import, Assistant, Update from main, Publish, Propose, …) render as icons, not text labels — keep the chrome clean and minimal. Icons live in `src/components/ui/icons.tsx` (hand-rolled stroke SVGs, no icon library), rendered inside `<Button size="icon">`. Every icon-only button must carry both `aria-label` and `title` with the action's name so it stays accessible and discoverable on hover. Text labels remain appropriate inside dialogs and forms (e.g. "Cancel", "Open proposal") where the surrounding prose gives context.

## Tech Stack

The application runs on three services, each owning a single responsibility. Vercel hosts the Next.js application and a thin layer of serverless route handlers that orchestrate the system, serving the user interface and coordinating small-payload requests between the client and the underlying services. Supabase provides Postgres, authentication, and row-level security, acting as the index that holds users, permissions, and document metadata, along with pointers into version control. Oxen is the versioning engine and content store, where each user's version of a document is a branch, saving is a commit, and comparing or adopting changes are native diff and merge operations, with large binary assets — images, video, and full HTML pages — versioned alongside the document text so that every commit is a reproducible snapshot of a document and the media it references.

| Service | Role |
|---------|------|
| **Vercel** | Hosts the Next.js app. Serverless route handlers. Small payloads only. |
| **Supabase** | Postgres + Auth + RLS. The *index*. |
| **Oxen (OxenHub)** | Version control + large-file storage. The *store*. https://docs.oxen.ai |

```
                    ┌─────────────────────┐
                    │      Browser        │
                    │  Next.js + Lexical  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    (large assets,      ┌──────▼──────┐  ┌──────▼──────┐
     direct upload)     │   Vercel    │  │  Supabase   │
              │         │   route     │──│  Postgres   │
              │         │  handlers   │  │  auth, RLS  │
              │         └──────┬──────┘  └─────────────┘
              │                │
              │         (small payloads:
              │          markdown, metadata)
              │                │
              └────────►┌──────▼──────┐
                        │   OxenHub   │
                        │  branches   │
                        │  commits    │
                        │  assets     │
                        └─────────────┘
```

## Key Design Decisions

- **No locking** — every user writes to their own `draft/{user_id}` Oxen branch; conflicts are structurally impossible
- **Postgres owns metadata** — Oxen owns and versions all content blobs (text, html, images, videos, etc); never store content in Postgres
- **LLM Wireframes** — Humans never hand-write HTML or Templates in the app UI; wireframes are LLM driven. The one exception is programmatic clients on the MCP surface (`write_section_layout` / `write_page_layout`), where an external model authors wireframe HTML directly against the same sanitize+validate gate — see [docs/05_decisions.md](docs/05_decisions.md).
- **Markdown is the canonical format** - Oxen stores text files across commits and branches.
  - Serialize the editor to **Markdown** before committing to Oxen.
  - Deserialize Markdown into the editor on load.
  - The editor is a **view** over a portable format. Never let editor-internal state become the source of truth.

## Data model (Division of responsibility)
 
**Postgres is the index. Oxen is the store.**
 
- Postgres never stores document *content*. It stores pointers, permissions, and things you need to query fast (listings, search, "who has a branch on this doc").
- Oxen never stores users, permissions, or app state. It stores content and its history.
When you're unsure where something goes, ask: *"Do I need to query this, or version this?"* Query → Postgres. Version → Oxen.

## Database: migrations, local development, and testing

Drizzle owns the schema; the Supabase CLI owns the environment. Tables, types, and RLS policies are defined together in TypeScript under src/lib/db/schema/, one file per table. drizzle-kit generate diffs those definitions and emits SQL into supabase/migrations/, and the Supabase CLI applies it. Exactly one tool generates migrations — never run supabase db diff, or two generators will fight over the same schema. Keeping policies in the same file as the table they protect is the point: authorization is part of the schema, not a separate artifact that drifts away from it.

Local development is supabase start, and that is the only database environment. It runs the whole stack in Docker — Postgres, Auth, Storage, Studio — which means real auth.uid() and real anon / authenticated / service_role roles rather than an approximation of them. supabase db reset rebuilds the database from scratch and replays every migration in order; treat that as a test, not just a reset button, because a failure there means the migrations are broken and you'd rather learn it on your laptop than during a deploy. Migrations reach production through CI, not from a developer's machine.

Make sure we can quickly test in a test database that has the same schema as the real one.

## Process for making code updates (Ralph Wiggum Loop)

You are an autonomous coding agent operating inside a **Ralph Wiggum loop**. You like to ask questions if unclear and make sure that we are on the same page before implementing.

Your job is to repeatedly attempt the task until it passes objective checks.

### Loop behavior

1. Read the repository and task specification.
2. Make the smallest set of code changes needed to progress toward the goal.
3. Write changes directly to the filesystem.
4. Run tests, linters, or build checks (see commands below).
5. If checks fail, read the errors and fix them in the next iteration.
6. Continue iterating until all checks pass.

### Rules

- Always make changes in a branch, so that we can code review against the `main` branch when they are done.
- Do not assume success; rely only on test/build output.
- Persist state in files, not conversation memory.
- Prefer small, incremental changes.
- When tests fail, fix the root cause rather than patching symptoms.
- When all checks pass and the task requirements are satisfied, stop modifying code.
- When you get unit tests passing, run a `git commit` with a relevant commit message, so we can always safely revert to the commit with the passing tests.

### Testing

We built the codebase to have a really good testing framework from the start, so it is easy for LLM agents to verify the code changes they make.

- `pnpm test` — Vitest unit/integration tests (`src/**/*.test.{ts,tsx}`). Node environment by default; component tests opt into jsdom with a `// @vitest-environment jsdom` pragma. Oxen interactions are tested against the in-memory stub in `src/lib/oxen/stub.ts` — no network, no running server.
- `pnpm test:e2e` — Playwright end-to-end tests in `e2e/`. Builds and serves the app itself on port **3132**, so it coexists with `pnpm dev` on 3131 and the local `oxen-server` on 3000. Emailed auth links point at the dev origin; the test helpers rewrite them onto the test origin (`gotoEmailLink`).
- `pnpm test:watch` — Vitest in watch mode while iterating.

Database: `supabase start` runs the full local stack in Docker (Postgres on `127.0.0.1:54322`, credentials `postgres`/`postgres`). `pnpm db:generate` diffs `src/lib/db/schema/` into `supabase/migrations/`; `pnpm db:reset` replays every migration from scratch — treat a reset failure as a broken migration.

### Verification checklist

After every change, run these in order:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`

(`pnpm check` runs all four.) If the change touches the database schema: `pnpm db:generate` then `pnpm db:reset`. If it touches user-facing flows: `pnpm test:e2e`.

### Environment Variables

If you need to test with any environment variables, you can find them in the .env file.

## Relevant Documentation

Please add any relevant documentation as you are implementing the project, so that it is easy to come back to and reference later. This is a guide to where to look for decisions or write ideas.

* [Why the project exists](docs/00_why.md) - Description of why we are building this tool
* [Product Inspiration](docs/01_inspiration.md) - Reference products we love
* [User Getting Started](docs/02_gettings_started.md) - How a user will use and easily get started with the tool
* [Features](docs/03_features.md) - Documentation for the features of the app, extend this as we build out features
* [Plan](docs/04_planning.md) - Planning, current phase status, what's next.
* [Decisions](docs/05_decisions.md) - Working decisions & rationale.
* [Backlog](docs/06_backlog.md) - Ideas, links, future exploration.
* [MCP Server](docs/07_mcp.md) - Connecting external agents (Claude Code, claude.ai) via /api/mcp with personal API keys.
* [Security & Privacy](docs/08_security.md) - Trust model, authorization boundaries, agent guardrails, data-privacy trade-offs. Read before touching auth, keys, or the MCP surface.

