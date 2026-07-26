# Features of CopyDog

These are the core features of the app, and how they need to function.

## Text Document Copy Editor

A Google doc/notion style word document editor.

* Ability to label things as H1-H6, paragraph, button/link/CTA, bulleted list, numbered list, eyebrow, etc
* Ability to organize blocks of elements into a section (ie. highlight multiple headlines, paragraphs, buttons etc into a section)
* Make alternate versions of sections for different copy ideas
* Ability to add notes/comments to your sections, copy, etc to keep random thoughts or feedback that are not copy themselves
  
## Wireframe Builder

Go from a prompt or reference to a unified wireframe design system linked to the copy

1) Upload the raw HTML of a website or wireframe
2) Paste a URL (maybe an existing website)
3) Upload a JPG/PDF/PNG of a wireframe or designed website
4) Use a figma MCP to import from a figma design
5) Use AI to directly "vibe code" the wireframe layout

### Design assistant

The chat assistant is a wireframe designer over Oxen.ai inference (streaming +
tool calling). It sees the page's copy *and* current wireframe HTML, and works
at two grains:

- **design_section** — redesign one section ("make the hero a split, image on
  the left", "3-up card grid for these features"); every other section keeps
  its layout. Designing an unlinked section links it back in.
- **redesign_page** — whole-page passes ("more rhythm, alternate tinted
  bands") that start from the current wireframe, not a blank slate.
- On an empty page, "design me a landing page for X" builds a first draft:
  sections with starter copy (add_section), then a full layout.

Turns stream live: tokens render as they arrive, tool activity shows as status
lines ("Designing hero…"), and the wireframe pane refreshes after every
mutating tool so you watch the design evolve. All agent edits land in the
caller's private draft as new versions — same rules as typing.

Conversations are threaded per page: **+** starts a fresh thread, the history
button lists recent ones (titled by their first message), and reopening the
panel resumes the latest. Threads persist in `chat_messages` keyed by a
client-generated `conversation_id`. When a real decision has 2–4 sensible
paths the agent calls **ask_user_choice**, which renders a structured choice
card (stored on the message, so it survives reloads) instead of a numbered
list in prose; the selection returns as the next user message.

**Add to chat** (Cursor-style): highlight copy in the editor and hit "Add to
chat" in the selection toolbar, or in the wireframe select rendered text /
hover a section for the floating pill. The selection becomes a chip on the
composer (removable; cleared after sending) carrying `source`, section
slug + title, the exact text (or the whole section), and the wireframe
element type — see `src/lib/agent/context.ts`. Chips are stored structured
in `chat_messages.context` and serialized for the model server-side, so
the UI never shows the raw prompt and the agent knows exactly which
section slug the user means. Attachments ride with one message only.

**Reference material** — the other kind of chip. The paperclip in the
composer (also drag-and-drop onto the panel, or ⌘V an image) attaches
outside material to build from: a screenshot, a PDF, or a URL. Each one
resolves once, server-side, into a form the inference API reads directly —
pixels (`image_url`), a document (`file` + base64 data URL), or the page's
copy extracted with the same deterministic extractor page import uses. The
model sees the real thing; the browser only ever holds a small descriptor.

- On an **empty page**, a reference means "build me this": the agent reads
  it, adds a section per band with real starter copy, then lays the whole
  page out in one pass. On a page that already has copy it asks before
  replacing anything.
- References reach the **designer**, not just the chat model:
  `design_section` and `redesign_page` take `referenceIds` and the layout
  generator gets the actual image or document, so the wireframe is authored
  while looking at the reference. It is told to take composition — rhythm,
  grouping, where the weight sits — and never the words.
- `read_reference` pulls one back into view mid-conversation.
- Limits are the model's, not the transport's: 24 MB PDFs, 10 MB images, 4
  references per message.
- **Uploads are chunked.** A route handler's request body caps at 4.5 MB, so
  the browser hashes the file (XXH3-128), slices it, and posts each slice to
  a stateless proxy route that forwards it to Oxen's own large-file protocol
  (`PUT /versions/{hash}/chunks?offset=`). `POST /versions/{hash}/complete`
  takes a `workspace_id`, so Oxen reassembles *and* stages the file in one
  step — no commit, no temporary storage of our own. Oxen re-hashes what it
  assembled, so a dropped chunk fails loudly instead of corrupting a
  reference. See `docs/05_decisions.md` and Oxen's own
  [Large File Upload](https://docs.oxen.ai/http-api/large-file-upload) page.
- Storage: per reference, a JSON manifest at `refs/{conversationId}/{id}.json`
  and the bytes beside it at `refs/{conversationId}/{id}/{file}`. That prefix
  is **pruned before every publish** and ignored by `hasUnpublishedChanges`,
  so attaching a competitor's screenshot neither lights up Publish nor shows
  in a proposal diff. Publishing therefore clears a conversation's
  references; the agent says so when an id no longer resolves.

The Import dialog remains the blunt instrument — "replace this page from
this source, now". References are the conversational path, where the agent
decides what to take. Both share `import/fetch-url.ts` and the extractors.

Each tool lives in one registry entry in `src/lib/agent/tools.ts` —
description, zod args (the JSON Schema the model sees is derived from them),
live status label, and implementation — so extending the agent is adding one
`defineTool` entry; the loop in `run.ts` doesn't change.

The greyscale design system the agent composes with: heroes, split layouts
(both directions), 2/3/4-column card grids, tinted bands, testimonials with
avatar bylines, logo strips, stats, FAQ rows, pricing cards, and email-capture
forms — all `wf-*` classes, sanitizer-enforced, swappable as a module.

## Pages sidebar

The site's pages as a tree, nesting to any depth. Rows stay quiet at rest and
reveal their controls on hover: a grip that drags to reorder (row edges) or
nest (row middle), a ⊕ that adds a subpage inline, and a trash that deletes.

Deleting always goes through a confirmation modal (the shared `ui/modal.tsx`
shell — see Modals below), which names the page, says how many subpages go with it, and reminds the user
the page stays in their teammates' view until they publish. The trash goes
disabled — visible, not hidden, with a tooltip saying why — when a page's
subtree is the whole site: a site with no pages has no route to land on, and
a control that vanishes reads as a missing feature rather than a rule. The
server refuses the same case independently. Deleting the page you're on lands
you on its nearest surviving neighbour, preferring the row above.

Structurally the delete is `deletePage` in `src/lib/content/pages.ts`: the
sitemap entry leaves `site.json` first (it decides what exists), then every
content file of every page in the subtree is staged for removal — committed
files, staged files, and everything `doc.json` references. That eager prune is
deliberate: once a page leaves the sitemap, publish's `pruneOrphanContent`
stops considering it, so anything missed would live on the branch forever.

## Modals

One shell for every centred dialog: `src/components/ui/modal.tsx`. Render it
conditionally — mounted means open — and it owns the scrim, the card, Escape,
backdrop dismissal, the focus trap, and returning focus to the trigger. Pass
`dismissible={!busy}` to hold it open while work is in flight.

It portals to `<body>`, and that is the load-bearing detail. `position: fixed`
only escapes to the viewport while no ancestor has claimed it — `sticky`,
`transform`, `filter` and friends each create a stacking context that traps
the overlay behind neighbouring chrome. Written inline, a modal inherits
whatever context its *trigger* happens to sit in: the delete-page dialog was
caught by the sidebar's sticky `<aside>` and publish/propose by the sticky
editor toolbar, both scrimming the copy pane while the header and assistant
panel stayed bright on top. Portaling puts every modal in the root stacking
context, so where the trigger lives stops mattering.

The scrim is its own token (`--color-scrim`, `bg-scrim`) because it must
*darken* in both themes. Written as `ink/20` it inverts — `ink` is near-white
in dark mode — and washes the page out instead of dimming it. Dark mode takes
the heavier value, since the card floating on it is dark too.

## Dual Panel

The user should be able to toggle between the copy editor and the wireframe builder OR see both at the same time in a dual panel mode.

Every panel is resizable by dragging its divider (project sidebar, copy/wireframe split, assistant) — the shared `ResizeHandle`/`usePanelSize` primitive in `src/components/ui/resize-handle.tsx` implements the ARIA window-splitter pattern (drag, arrow keys, double-click to reset) and persists each size in localStorage.

## Export

You should be able to export the final wireframes as raw html, or into figma, claude code, or other tools via MCP or other connectors.


## Team & project settings

Every project has a settings page (`/projects/[id]/settings`, the gear in the
sidebar — the sidebar's Team facepile links there too) that is the one place
people-management lives:

* **Roster** — everyone on the project with their avatar, name, and role.
* **Roles** — three seats: **owners** manage people, **editors** write,
  **viewers** only read. An owner changes any other member's role from the
  roster dropdown (RLS: owners only, never their own row). Renaming and
  deleting stay with the project's *creator* (`projects.owner_id`), whose
  role is locked and whose membership can't be removed — a project always
  has its anchor.
* **Viewer is enforced at every layer, not just hidden in the UI:**
  RLS write policies require `is_project_editor` (proposals, comments,
  chat, published versions); both content-access gates
  (`requireProjectAccess` / `requireProjectAccessAs`) load the member's
  role and refuse viewers on any write-mode call; the MCP server forces
  write-mode project access for every tool that mutates, so a viewer's API
  key reads but never writes regardless of its scopes; and the invite RPC
  refuses viewer callers. The editor renders read-only for viewers — no
  publish/propose/import, no section editing, no agent, no new pages.
  Avatars are the real OAuth photo when there is one, otherwise the person's
  initial on one of eight muted hues picked by hashing their user id — same
  person, same color, light and dark (`src/components/ui/avatar.tsx`, themed
  by the `--avatar-*` tokens in `globals.css`).
* **Invite by email** — the `invite_member` SECURITY DEFINER RPC: the
  invitee must have signed in to CopyDog once (no pending-invite emails in
  v1); they join immediately with their own draft branch, as an **editor or
  viewer** (the invite form's role dropdown; owner is a deliberate
  post-invite promotion). Owners and editors can invite; viewers can't.
  The RPC returns whether a membership was actually created, so re-inviting
  someone already on the project says so instead of pretending success; the
  no-account failure carries the stable errcode `CD001`.
* **Remove / leave** — the owner removes anyone with a two-click confirm; a
  member can leave the project themself. Both are server actions deleting
  under RLS (owner-or-self policy) that revalidate the project layout, so
  the sidebar facepile and roster stay in sync everywhere. Removal revokes
  access instantly; the person's published versions and authorship stay in
  history.
* **Rename & delete** — owner-only. Rename goes through RLS (a non-owner's
  update touches zero rows and is reported as such); delete is the existing
  everyone-loses-it flow with its own confirm dialog.

Covered end to end by `e2e/project-settings.spec.ts` (rename, invite, leave,
remove, and the removed user's access actually dying) and the invite step of
`e2e/collaboration.spec.ts`.

## MCP Server

CopyDog is drivable by outside agents, not just its own assistant. A remote
MCP endpoint (`POST /api/mcp`, Streamable HTTP, stateless) exposes the whole
workflow as tools — read copy and wireframes, rewrite/add sections, design
layouts, add pages, diff, publish, propose, merge, comment — 24 tools total,
all routed through the same `src/lib` functions the UI and chat agent use.
Design works in two modes: delegate to CopyDog's built-in designer
(`design_section` / `redesign_page`), or the external model authors the
wireframe HTML itself (`get_design_system` → `write_section_layout` /
`write_page_layout`), validated by the same sanitizer + slot rules either way.

Auth is a personal API key (`cdk_…`) minted in **Account → API keys** (key
icon in the header); the key acts as its owner: same membership, same private
draft branch, same publish/propose rules. Connect from Claude Code with:

    claude mcp add --transport http copydog https://<host>/api/mcp \
      --header "Authorization: Bearer cdk_…"

Details and the tool catalog: [07_mcp.md](07_mcp.md).
