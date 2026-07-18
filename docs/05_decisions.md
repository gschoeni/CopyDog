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

## 2026-07-12 — the continuous document editor

**One Lexical editor per page; sections are shadow-root containers.** Cross-
section selection, grouping, and block dragging all need one editing surface,
so SectionNodes hold each section's blocks inside a single editor. Declaring
them shadow roots makes section children behave as top-level blocks (markdown
shortcuts, turn-into, selection ops) without forking Lexical internals.
Section chrome (title · version · notes · grip) renders as overlays aligned to
the live DOM, in headroom each section reserves.

**Grouped sections are pinned.** Auto-sectioning would instantly re-split a
deliberately grouped section (body + heading), so grouping pins the section
and the split transform skips pinned ones. Pinned is persisted in doc.json.

**Editor state is the structural source of truth while editing.** The page
component reconciles editor snapshots: new sections get metadata + files,
removed ones are dropped, titles derive from first headings until manually
renamed. The editor hides (never unmounts) across view-mode switches so its
live state survives.

**Drags are pointer-based, not HTML5 DnD.** Smoother control over indicators,
and actually drivable by tests.

## 2026-07-14 — The wireframe design agent

**Section-scoped edits are the agent's default move.** v1's `update_wireframe`
regenerated the whole page from copy + a one-line instruction — the LLM never
saw the current layout, so "make the hero two-column" re-rolled every section.
Now `design_section` regenerates exactly one `<section data-copy>` (spliced
into the page by `wireframe/edit.ts`), and `redesign_page` feeds the current
wireframe in as the starting point. The agent also gets the wireframe HTML in
its context, so it can talk about the layout it's editing. Conversational
iteration stays stable: what you didn't mention doesn't change.

**Agent turns stream over ndjson, not a server action.** Server actions can't
stream, so one route handler (`pages/[pageSlug]/chat`) emits
`{delta|status|mutated|done|error}` lines. `LlmClient.chatStream` parses the
OpenAI-compatible SSE (assembling tool-call argument fragments) and falls back
transparently to plain JSON — which is how the e2e stub keeps working and how
we survive providers that ignore `stream: true`.

**Mid-turn mutations refresh the wireframe without remounting the editor.**
`page.tsx` remounts `PageEditor` (fingerprint key) on `router.refresh()`,
which would tear down the chat panel mid-stream. So `mutated` events do a
cheap `readWireframeAction` → `setWireframe` (the design evolves live in the
pane), and the full `router.refresh()` waits for `done`, after the reply is
persisted.

**Designing an unlinked section relinks it.** Asking the agent to lay a
section out *is* "put this in the wireframe" — the tool flips `linked` back
on and says so, rather than failing or silently designing an invisible
section.

**The wf-* vocabulary grew Relume-style; the sanitizer contract didn't move.**
Cards, 2/4-column grids, reversed splits, tinted bands, forms/inputs, logo
strips, avatar rows, stats, FAQ rows. The sanitizer already allows any
`wf-[a-z0-9-]+` class, so the CSS module and the spec prompt are the only two
places a new component touches; tags and attributes stay allowlisted.

## 2026-07-13 — Pages are a mix of elements and sections (design correction)

We originally required every element to live in a section. That was wrong:
a page is an ordered mix of **elements** (H1–H6, paragraph, quote, bullets,
eyebrow, CTA — formerly "blocks" in code; we are renaming code to match) and
**sections** (deliberate, named groups of elements).

**Loose by default.** Typing produces loose elements — messy, free-flowing
copy, like a blank doc. Auto-sectioning on headings is removed. Sections form
only deliberately: Group-into-section from a selection, the rail ⊕,
or (future) an AI "section this page" pass. (Shift+Enter was a section shortcut until 2026-07-14; it now escapes the current section into a fresh loose element below it.)

**Sections are the unit of structure.** Versions, notes, teammate adoption,
the TOC, and the wireframe all remain section-scoped. Loose copy is one
shared body stream: autosaved, published, and diffed in proposals, but not
versioned and not on the map. Grouping is what unlocks the superpowers.

**Sections are linked or unlinked to the wireframe.** Linked (the default on
creation) means "layout-ready": generation lays out linked sections only.
Unlinking keeps a section grouped, titled, and versioned but out of the
wireframe (spare copy, drafts, notes-to-team). There is no "dissolve section"
— unlink, delete, or copy elements out instead. The toggle lives in the
section header strip with a quiet badge; unlinked sections get a hollow
number in the TOC.

**Generation nudges, never blocks.** Generate Wireframe proceeds with linked
sections and quietly reports how many loose elements / unlinked sections
won't appear.

**Storage (v2 doc.json).** `sections[]` becomes an ordered `content[]` mixing
`{kind:"section", …, linked}` and `{kind:"elements", slug}` entries; loose
runs live at `pages/{page}/elements/{slug}.md`. v1 docs parse as all-section
content — no migration needed.

## 2026-07-14 — Panels slim, they don't vanish

Founder feedback: panel open/close felt ad-hoc and didn't use the icon
language. Every edge surface now collapses to a **44px icon rail** instead of
disappearing — the pages sidebar slims to page-initial dots (+ new page,
proposals with an unread dot), the assistant slims to its sparkles glyph
(pulse dot while a turn is running). Reopening is always one click on the
same edge; nothing hides solely behind a toolbar toggle. Toggles use the
standard panel-frame glyphs (PanelLeft/RightIcon) in each panel's header,
widths animate, and rail/expanded state persists per project.

Two structural rules came out of it: side panels are viewport-pinned
(sticky below the chrome, internal scroll — the pages sidebar too, which
previously scrolled away with the document), and slimmed panels stay
**mounted** (CSS-hidden) so an in-flight assistant stream survives
collapsing. The workbench and editor columns carry `min-w-0` so opening
panels shrinks panes rather than pushing the page into horizontal scroll —
e2e asserts the chat input is *fully* in the viewport (`ratio: 1`) with
everything open at once. Mode toggle and the wireframe pane's controls
(export, regenerate) moved to icons per the icons-over-text rule.

## 2026-07-14 — Subpages: the sitemap is a tree

`site.json` pages now nest (`children`, additive — v1 flat files parse
unchanged). Nesting is purely structural: content stays flat at
`pages/{slug}/` and slugs stay unique site-wide, so versioning, publish,
proposals, and the wireframe are untouched by reorganizing navigation.
Moves are sibling-anchored (`parentSlug` + `beforeSlug`, cycle-guarded in
`movePageNode`) rather than index-based — immune to concurrent-shift bugs.

The sidebar renders the tree with fold chevrons (persisted per project),
and every row reveals a grip and an ⊕ on hover: grip drags are
pointer-based (house rule) with three drop zones per row — top edge =
before, bottom edge = after, middle = nest inside — shown as an accent
line at the target depth or a soft highlight on the future parent. Drops
apply optimistically, then `movePageAction` persists and the server tree
reconciles. ⊕ opens an inline "Page name" input as a child row.

**Tree legibility refinement (same day, founder feedback).** Depth is drawn
with nested guide hairlines dropping from each parent's anchor, not with
padding math: every row's anchor states its nature at rest (chevron =
parent, dot = leaf), highlight pills hug their own level, and top-level
pages sit flush left. Hover controls (grip, ⊕) live on the row's right —
iOS-reorder style — so titles never shift. Breadcrumbs walk the full
sitemap chain (`pagePath`): ancestors navigate, the current page is text.

## 2026-07-15 — Production Oxen (hub.oxen.ai) and one key

**One Oxen credential.** `OXEN_TOKEN` is gone; `OXEN_API_KEY` authenticates
both the content store (repos API) and Oxen.ai inference. `OXEN_NAMESPACE`
is the hub username/org. Dev now runs against production hub by default;
uncommenting `OXEN_BASE_URL` in `.env.local` points back at a local
oxen-server.

**Repos are born with their content.** Hub refuses workspaces on a
commitless branch (`no_commits_on_branch`), so provisioning seeds
site.json + the Home doc via `RepoNew.files` in the create call — the root
commit exists before anything else touches the repo. The local stub
mirrors this. (The old create-then-workspace-commit dance only worked
because local servers auto-created an initial commit.)

**Branch names in tail-match routes keep their slashes.** The workspace
commit route is `/merge/{branch:.*}` — actix hands the tail over raw, so
`draft/{user}` must be percent-encoded per segment, never as `%2F`.

**Projects are deletable, owner-only, DB-first.** The projects grid grew a
hover trash + confirm dialog. The action deletes the Postgres row through
RLS first (only the owner's delete removes anything — a non-owner can
never trigger repo deletion), then best-effort deletes the Oxen repo; all
project tables cascade.

## 2026-07-18 — Remote MCP server, API keys, and the service-role seam

**External agents are first-class.** The product bet is that people will
edit copy from Claude Code / claude.ai as often as from our editor, so the
MCP surface is the same library the UI uses, not a parallel API. To make
that true, publish/propose/merge moved out of server actions into
`src/lib/content/collab.ts`, add-page into `src/lib/content/pages.ts`; the
actions became thin wrappers, and MCP tools call the same functions. The
chat agent's tool registry (`src/lib/agent/tools.ts`) is reused verbatim
for rewrite/add/design/redesign — its `ToolContext` never knew about HTTP,
which is what made this cheap.

**Hand-rolled stateless MCP core.** `src/lib/mcp/protocol.ts` speaks the
stateless subset of Streamable HTTP (initialize/ping/tools) as a pure
function — no SDK, no session state, no SSE, plain JSON responses (the
spec allows this). Same reasoning as the hand-rolled LLM client: the
subset is tiny, and owning it avoids zod-version coupling with the MCP SDK
and keeps the handler unit-testable. If we later need resources,
prompts, or server-initiated streams, revisit with the official SDK.

**API keys over OAuth (for now).** `api_keys` stores sha256 hashes only;
plaintext shows once at mint. Keys act as their owner. OAuth + dynamic
client registration (what claude.ai's connector UI prefers) can layer on
later without changing the tool surface.

**The service-role client exists now, behind one gate.** MCP requests have
no cookie session, so RLS can't authorize them. `requireProjectAccessAs`
(access.ts) re-implements the membership gate explicitly on the
service-role client and is the only sanctioned path to it; collab/store
functions take whichever Supabase client the caller was authorized with.
The tradeoff — one explicit check mirroring the RLS policies — is
documented here so it doesn't silently multiply: if you find yourself
adding a second service-role query outside access.ts, stop.

**Tests stub `server-only`.** Vitest aliases the `server-only` marker to a
no-op so server modules (collab, MCP tools) are testable in Node; the MCP
tool tests mock only the access gate and run everything below it against
the Oxen stub.

## 2026-07-18 — External models design directly; one acceptance gate

The MCP design tools originally only *delegated* to the internal designer
LLM. External harnesses (Claude Code) are themselves capable designers, so
the surface now supports both modes: `get_design_system` serves the wf-*
contract (the same `DESIGN_SYSTEM_SPEC` our own LLM is prompted with), and
`write_section_layout` / `write_page_layout` accept externally-authored
HTML. The load-bearing decision: acceptance was extracted into
`acceptSectionLayout` / `acceptPageWireframe` (wireframe/edit.ts,
generate.ts), and *every* author — internal LLM, external model, future
import path — goes through those same two doors: sanitize to the wf-*
allowlist, enforce data-copy slot coverage. Never add a second acceptance
path; extend those functions.

## 2026-07-18 — Security hardening pass: scopes, budgets, containment

Full rationale in docs/08_security.md; the decisions:

**Keys are scoped and expiring.** read/write/collab/merge chosen at mint,
immutable after (rotate to change). `merge` is opt-in and even then a key
never merges its own user's proposals — the propose→merge loop must cross
a second human, because a prompt-injected agent otherwise closes it alone.

**Service-role access is now structural, not conventional.** Tools receive
a `McpToolApi` capability object (mcp/context.ts); the raw admin client is
unreachable from tool bodies, and eslint `no-restricted-imports` fences
`supabase/admin` to exactly context.ts. The gate function is the only door.

**Rate budgets over per-route limits.** One atomic SQL counter
(`consume_api_rate`, service-role execute only) charges 1 unit/request and
20/LLM design call against 240/key/minute — bounds inference spend without
external infrastructure (works on Vercel serverless, no Redis).

**Audit is metadata-only by construction.** mcp_audit_log takes an
allowlist of identifier args (slugs, labels); copy bodies can't reach it.
Attribution: via_api_key on proposals/comments, "[via <key>]" in commit
messages, "(via agent)" in the proposals UI.

**Error hygiene.** Only McpToolError (messages written for the agent)
crosses the MCP boundary; everything else logs server-side and reports
generically.

**SSRF closed properly.** Import fetches now follow redirects manually
(each hop re-guarded), check DNS answers against the private ranges
(rebinding, v4-mapped IPv6), and fail closed on resolution errors.
