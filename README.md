# CopyDog 🐕: The Collaborative Copy Editor and Wireframe tool

A collaborative web app that decouples website copy from wireframe design. Designers and copywriters can work together with their clients to work on versions of their website copy together. Designers could vibe code the wireframe, and have copywriters fill in the words OR a copywriter can start writing messy copy in a document righ away. Users can seamlessly toggle between wireframe and copywriting mode.

## Table of Contents

Use the table of contents to learn more about why the product exists, inspiration from other tools, or any other information you need as building out the application.

* [Why the project exists](docs/00_why.md) - Description of why we are building this tool
* [Product Inspiration](docs/01_inspiration.md) - Reference products we love
* [User Getting Started](docs/02_gettings_started.md) - How a user will use and easily get started with the tool
* [Features](docs/03_features.md) - Documentation for the features of the app
* [Plan](docs/04_planning.md) - Planning, current phase status, what's next.
* [Decisions](docs/05_decisions.md) - Working decisions & rationale.
* [Backlog](docs/06_backlog.md) - Ideas, links, future exploration.
* [MCP Server](docs/07_mcp.md) - Connect your own agent (Claude Code, claude.ai) to CopyDog over MCP.
* [Security & Privacy](docs/08_security.md) - Trust model, authorization boundaries, and agent guardrails.

## The primary UI

The UI can toggle between a document editor, a wireframe, or a dual panel view of both at the same time. It has an LLM agent that helps users vibe code their wireframes or brainstorm copy.

- **Copy Editor** — Google doc / Notion-style markdown editor, with sections that can be tied to the wireframe
  - **Copy Versioning** - Each user is able to propose edits in parallel, so you can quickly swap between versions while not stepping on each other's toes
  - **Active Copy** - Each user has their view of the wireframe, with certain versions "activated" so they can see how it all flows. They can quickly swap out which version of the copy is active.
- **Wireframe** — Live HTML wireframe preview with active copy substituted in
- **LLM Agent** - The user may update the wireframe or copy through a chat interface with an LLM agent

The Notion-style markdown editor has sections that contain copy and a type such as H1, H2, paragraph, bulleted list, etc. Each section is automatically (or manually) tied to part of the HTML, and is injected into a template. When the copy is updated in the markdown editor, it automatically updates the HTML wireframe.

The LLM agent can be prompted to update the layout of the wireframe. The prompt can either be text, an image, a sitemap, or a url that we crawl. This gives the user flexibility in how the import wireframes, then start iterating on the layout and copy at the same time.

## Running the App Locally (Development)

CopyDog is a Next.js app backed by two services: Supabase (Postgres + auth, run locally in Docker) and an Oxen server (the versioned content store). You need all three running for the app to work.

**Prerequisites:** Node.js with [pnpm](https://pnpm.io), Docker, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

1. **Install dependencies**

   ```sh
   pnpm install
   ```

2. **Start the local Supabase stack** (Postgres, Auth, Studio in Docker)

   ```sh
   supabase start
   ```

   `supabase status` prints the local URL and keys. Put them in `.env.local` (gitignored — these are the well-known local-dev keys, not secrets):

   ```sh
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon key from `supabase status`>
   SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status`>
   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   ```

3. **Apply database migrations**

   ```sh
   pnpm db:reset
   ```

   This rebuilds the local database and replays every migration from scratch. If it fails, a migration is broken — fix that before going further.

4. **Point at an Oxen server.** The app reads `OXEN_TOKEN` and `OXEN_NAMESPACE` from `.env` (see `src/lib/env.ts` for the full set of server-side variables). By default that targets [OxenHub](https://docs.oxen.ai); for fully local development, run a local `oxen-server` (conventionally on port 3000) and set `OXEN_BASE_URL=http://localhost:3000` in `.env.local`.

5. **Start the dev server**

   ```sh
   pnpm dev
   ```

   The app runs at **http://localhost:3131** (port 3131 is intentional — 3000 is usually taken by the local `oxen-server`).

Before committing, run `pnpm check` (lint, typecheck, unit tests, build). See [AGENT.md](AGENT.md) for the full testing and verification workflow.

## Connect your own agent (MCP)

CopyDog exposes a remote [MCP](https://modelcontextprotocol.io) endpoint, so you can bring your own agent — Claude Code, claude.ai, or any MCP-capable harness — and do everything the in-app assistant does: read and write copy, drive wireframes, and run the publish → propose → merge workflow. This is the full quick-start; [docs/07_mcp.md](docs/07_mcp.md) has the complete tool list and [docs/08_security.md](docs/08_security.md) has the trust model.

1. **Mint a personal API key.** In the app, open **Account → API keys** (the key icon in the header). Name the key, choose its scopes (**read** / **write** / **collaborate** / **merge**) and an expiry, and create it. Copy the key (`cdk_…`) immediately — it's shown once and stored only as a hash.

2. **Add the endpoint to your agent.** The endpoint is `POST /api/mcp`; send the key as a bearer token. For Claude Code:

   ```sh
   # hosted
   claude mcp add --transport http copydog https://<your-host>/api/mcp \
     --header "Authorization: Bearer cdk_your_key_here"

   # local dev (the app runs on port 3131)
   claude mcp add --transport http copydog http://localhost:3131/api/mcp \
     --header "Authorization: Bearer cdk_your_key_here"
   ```

   Any other MCP client points at the same URL with an `Authorization: Bearer cdk_…` header. The transport is stateless Streamable HTTP — plain JSON request/response, no sessions or SSE.

3. **Verify the connection.** Ask your agent to run `list_projects`; it should return the projects your key can access. `tools/list` shows exactly what the key's scopes allow — out-of-scope tools are invisible and uncallable. A good first flow is `list_projects` → `get_site` → `get_page`.

**Good to know:**

- The key acts as **you**, narrowed to its scopes. Every write lands in your private `draft/{user_id}` branch, so an agent can never corrupt a teammate's work — exactly like the in-app editor.
- **Revoke** a key anytime on the same page; access stops immediately, and expired keys die the same way.
- Keys are rate-limited (240 units/min) and every mutating call is audit-logged (identifiers only, never your copy). `merge_proposal` needs the opt-in **merge** scope and can never merge the key owner's own proposals — a teammate reviews those.
- **Layout, two ways:** an agent can author wireframe HTML itself (`get_design_system` → `write_section_layout` / `write_page_layout`, validated by the same gate as the built-in designer), or delegate to CopyDog's designer LLM (`design_section` / `redesign_page`, advertised only when the server has an LLM key configured).

## Agents & Code Contributions

Refer to [AGENT.md](AGENT.md) for how to contribute or write code for this project.

## Initial Prompt

This is the initial prompt we used to build the app, for reference, historical purposes, and for old times sake.

```
Build a collaborative web app that decouples website copy from wireframe design. Designers and copywriters can work together with their clients to work on different versions of their website copy together. Designers vibe code the wireframe, copywriters fill in the words. Users can seamlessly toggle between wireframe and copy editing mode. It is inspired by Google Docs/Notion for the copy editor, and Relume for the greyscale wireframe.

Refer to the README.md and read all the documents in the Table of Contents to understand what we are building before writing any code. After you have read all of the documentation, quiz me asking any clarifying questions before creating a plan. Once we come to a shared understanding of what we are building, and the architecture, you may start writing the detailed plan to the [docs/04_planning.md](docs/04_planning.md) markdown file we can refer to later. Only after we have our agreed upon plan, can we start writing code. If there are any documented design decisions you do not agree with, feel free to push back, or ask more questions, until we do agree. When we are done, the documentation should reflect everything we have discussed.

You are a seasoned designer who has worked at Apple, Notion, and Figma in the past. You are great at building clean, minimal, beautiful, aesthetically pleasing, and intuitive application. The user should be able to enter the application and understand exactly how to get started without any instruction.

Explore the documentation, ask me questions, and lets get going.
```

```
Start building the application and make sure the code is clean, modular, and idiomatic. The design should be minimal, beautiful, aesthetically pleasing, and intuitive application like a product that would win the Apple Design Award for app of the year for innovation and ingenuity.
```