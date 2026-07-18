# MCP Server

CopyDog speaks [MCP](https://modelcontextprotocol.io) so people can bring
their own agent — Claude Code, claude.ai, or any MCP-capable harness — and
do everything the app's built-in assistant does: read and write copy, drive
wireframes, and run the version-control workflow (publish → propose → merge).

## Connecting

1. In the app, open **Account → API keys** (key icon in the header) and
   create a key: name it, pick its scopes (read / write / collaborate /
   merge) and an expiry. Copy it immediately — it's shown once.
2. Point your agent at the endpoint with the key as a bearer token:

```sh
# Claude Code
claude mcp add --transport http copydog https://<host>/api/mcp \
  --header "Authorization: Bearer cdk_…"
```

Local dev: the endpoint is `http://localhost:3131/api/mcp`.

The key acts as its owner, narrowed by its scopes — `tools/list` shows
exactly what a given key can do; out-of-scope tools are invisible and
uncallable. Every write lands in that user's private `draft/{user_id}`
branch — an external agent can never corrupt a teammate's work, exactly
like the in-app editor. Revoking the key (same page) cuts off access
immediately; expired keys die the same way.

Guardrails on the agent path: keys are rate-budgeted (240 units/min;
LLM design tools cost 20 each), every mutating call is audit-logged
(identifiers only, never copy), proposals/comments/commits carry "via
agent" attribution, and `merge_proposal` requires the opt-in merge scope
and never applies to the key owner's own proposals. Details:
[08_security.md](08_security.md).

## Transport

`POST /api/mcp` implements the stateless subset of MCP's Streamable HTTP
transport: every request is independent, responses are plain JSON, there are
no sessions or SSE streams. `initialize`, `ping`, `tools/list`, and
`tools/call` are supported; batching is not (removed from the protocol in
2025-06-18). Unauthenticated requests get `401` + `WWW-Authenticate`.

Implementation: `src/lib/mcp/protocol.ts` (transport core, pure function),
`src/lib/mcp/tools.ts` (tool surface), `src/lib/mcp/keys.ts` (key mint/verify),
`src/app/api/mcp/route.ts` (HTTP binding).

## Tools

Discovery and reading:

| Tool | What it does |
|---|---|
| `list_projects` | Projects the key's owner can access (start here) |
| `get_site` | Page tree for a project |
| `get_page` | A page's sections, versions, and active markdown |
| `read_section` | One section's markdown (any version) |
| `get_wireframe` | The page's wireframe HTML |
| `diff_draft` | Draft branch vs. main, per-file line diffs |
| `list_comments` / `add_comment` | Section-level feedback |

Writing copy (always the caller's draft — the external model authors the markdown itself):

| Tool | What it does |
|---|---|
| `rewrite_section` | New labeled version, made active (history preserved) |
| `add_section` | New section with initial copy |
| `update_section` | Overwrite an existing version in place (autosave-style) |
| `update_elements_run` | Overwrite a loose element run's copy |
| `add_page` | New page in the sitemap |
| `sync_page_from_main` | Reset one page of the draft to main |

Designing layout — two modes:

| Tool | What it does |
|---|---|
| `get_design_system` | The wf-* contract (tags, classes, copy-slot rules, patterns) — read before authoring |
| `write_section_layout` | The external model authors ONE section's HTML itself |
| `write_page_layout` | The external model authors the whole page's HTML itself |
| `design_section` | Delegate one section's layout to CopyDog's built-in designer LLM |
| `redesign_page` | Delegate a whole-page redesign to the built-in designer |

Externally-authored HTML passes through the exact acceptance gate the
internal designer faces (`acceptSectionLayout` / `acceptPageWireframe`):
sanitized to the wf-* allowlist, stripped of scripts/styles/handlers, and
validated for `data-copy` slot coverage. A harness like Claude Code reads
`get_design_system` once, then designs directly — no internal LLM required.

Version control and collaboration:

| Tool | What it does |
|---|---|
| `publish_draft` | Commit staged edits to the draft branch + refresh the version index |
| `propose` | Open a proposal (draft → main), publishing first |
| `list_proposals` | Open + resolved proposals |
| `merge_proposal` | Squash-apply an open proposal onto main |
| `close_proposal` | Close without merging |

`design_section` / `redesign_page` are advertised only when the server has an
LLM configured (`OXEN_API_KEY`); everything else — including the author-it-
yourself layout tools — works without one.

The write tools are the chat agent's own tool implementations
(`src/lib/agent/tools.ts`) invoked through the same `executeTool` dispatcher —
the MCP layer adds authentication and argument mapping, not new behavior.

## Auth model

- Keys are `cdk_` + 32 random bytes (base64url). Postgres stores only the
  SHA-256 hash plus a display prefix; RLS lets users manage only their own
  keys. Scopes and expiry are set at mint and immutable — rotate to change.
- The MCP request path resolves key → user in `src/lib/mcp/context.ts`,
  which builds the `McpToolApi` capability object tools run against. Tools
  never hold a raw database client: `requireProject()` performs the same
  membership check the RLS policies enforce for cookie sessions and only
  then returns a handle. `context.ts` is the only module allowed to import
  the service-role client (eslint-enforced) — see
  [08_security.md](08_security.md).
- OAuth (for claude.ai's one-click connector UI) is a possible later layer;
  it would change how a key is obtained, not the tool surface.
