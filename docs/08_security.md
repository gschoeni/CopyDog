# Security & Data Privacy

Security and privacy are architectural concerns in CopyDog, not review-time
checklists. This doc records the model, the enforced boundaries, and the
deliberate trade-offs. Change any of these consciously — most have a matching
entry in [05_decisions.md](05_decisions.md).

## Trust model

| Actor | Trust | Enforced by |
|---|---|---|
| Signed-in browser user | Their own memberships, narrowed by role | Supabase RLS on every query (cookie session → `auth.uid()`) + role-aware access gates |
| External agent with an API key | The key owner's memberships, narrowed by scopes **and role** | `McpToolApi` facade + membership gate + scope checks + write-mode role gate |
| Content read by any LLM (copy, comments, imported sites) | **Untrusted input** | sanitizer allowlist, acceptance gates, MCP guardrails below |
| The service-role Supabase client | Bypasses RLS — most dangerous object in the system | confined to two modules, eslint-fenced |

## Authorization boundaries

**Roles narrow people; scopes narrow keys.** `project_role` is
owner | editor | viewer. Viewers are read-only members: RLS write policies
require `is_project_editor`, and — because Oxen content writes never touch
RLS — both access gates (`requireProjectAccess` / `requireProjectAccessAs`)
load the caller's role and throw `ReadOnlyMemberError` on any `write: true`
call. The MCP server forces write mode for every tool declaring `mutates`,
so a viewer's key cannot write no matter which scopes it carries.

**Browser paths: RLS is the authority.** Policies live next to their tables
in `src/lib/db/schema/*`; membership derives from `is_project_member` /
`is_project_owner`. No app code on a cookie path re-implements authorization.

**MCP paths: the facade is the authority.** External requests have no
session, so `src/lib/mcp/context.ts` builds a capability object
(`McpToolApi`) per request:

- Tools never hold a raw database client. `requireProject(projectId)` runs
  the same membership check the RLS policy expresses, and only then returns
  a handle. Cross-tenant access is unrepresentable in a tool body, not just
  reviewed against.
- `src/lib/supabase/admin.ts` may be imported by exactly two modules
  (`mcp/context.ts` and itself) — enforced by `no-restricted-imports` in
  eslint.config.mjs. Widening that list is a security decision.

## API keys

- `cdk_` + 32 random bytes; Postgres stores the SHA-256 hash and an 8-char
  display prefix. Plaintext exists once, at mint. Constant-time compare.
- **Scoped**: `read` (always), `write` (owner's draft), `collab` (publish /
  propose / comment), `merge` (opt-in, never default). Scopes are chosen at
  mint and immutable — rotate to change. Undisclosed tools don't appear in
  `tools/list` and can't be called.
- **Expiring**: 30/90/365-day expiry offered at mint (90 default in the UI);
  expired keys verify as dead, same as revoked.
- MCP clients store keys in local config (e.g. `~/.claude.json`) — the UI
  warns users to treat keys like passwords, and a committed `.mcp.json`
  with a key in it means revoke + rotate.

## Agent guardrails (prompt injection containment)

The connected LLM reads team-writable and internet-derived text; assume it
can be steered. The server limits what steering can achieve:

- **All writes land in the key owner's private draft branch** — a hijacked
  agent can't touch teammates' drafts or main directly.
- **No self-merge**: `merge_proposal` needs the opt-in `merge` scope AND
  refuses proposals authored by the key's own user. The propose→merge loop
  always crosses a second human. (UI merges are unchanged — review there is
  social, per the product design.)
- **Rate budget**: 240 request-units/key/minute via an atomic SQL counter
  (`consume_api_rate`, service-role-only execute); LLM-backed design tools
  cost 20 units each, capping inference spend from a runaway or stolen key.
- **Audit trail**: every mutating MCP call writes `mcp_audit_log` (key,
  user, project, tool, identifier-only detail — never copy text). Proposals
  and comments carry `via_api_key`; agent-driven publishes/merges append
  "[via <key name>]" to commit messages; the proposals list shows
  "(via agent)".

## Content safety

- **Wireframe HTML is allowlist-sanitized** (`wireframe/sanitize.ts`):
  structural tags only, `wf-*` classes only, no scripts/styles/handlers/
  external refs. Every author — internal LLM, external agent, import —
  passes the same two acceptance gates (`acceptSectionLayout`,
  `acceptPageWireframe`).
- **URL imports and references are SSRF-hardened** (`import/fetch-url.ts`):
  http(s) only; private/loopback/link-local hosts blocked; **DNS answers
  checked** (a public name resolving to a private IP fails closed, including
  v4-mapped IPv6); **connections pinned** to the vetted address so a
  rebinding resolver can't swap it; **redirects followed manually** with
  every hop re-validated; ≤5 hops, 10s timeout. Assistant references widen
  only the *content types* accepted, never the host guards: HTML (2MB),
  images (8MB), PDFs (24MB) — anything else is refused, and the caller
  declares which kinds it will take (page import still says HTML only).
- **Reference uploads** (`chat/references`) accept PNG/JPG/WEBP/GIF up to
  10MB and PDFs up to 24MB, behind the same project write gate as any other
  edit. Bytes land in the uploader's own draft workspace under `refs/`, are
  never committed, and are readable only through that user's own draft view.
- **The chunk proxy** (`chat/references/upload`) is stateless and holds no
  partial uploads: it forwards each slice to Oxen's version store, which is
  content-addressed, so a chunk can only ever land under the hash of its own
  bytes and `complete` refuses anything that doesn't hash to the id claimed.
  An abandoned upload leaves orphaned chunks in the version store rather than
  anything reachable.
- **Error hygiene on the MCP surface**: only `McpToolError` messages (written
  for the agent) pass through; anything else is logged server-side and
  reported as a generic internal error. Supabase/Oxen internals never leak.

## Data privacy

**What lives where.** Postgres holds pointers, permissions, and indexes —
never copy. Oxen holds all content and its full history.

**Version control never forgets — a deliberate trade-off.** Every published
version of every section persists in Oxen history; commits carry display
names and emails; draft branches are keyed by user UUID. Honoring a
data-deletion request means deleting repos (project deletion best-effort
does this), not surgically rewriting history. State this in any privacy
policy.

**Drafts are private-until-published, not secret.** Publishing writes your
version labels to the shared index and your branch becomes readable to
teammates (adoption depends on it). The explicit Publish step is the
consent boundary.

**Third-party processors.** Copy and imported content flow to Oxen.ai for
inference (wireframe design, import extraction). **Assistant references go
there too** — an attached screenshot, PDF, or fetched page is sent to the
inference API in full, so anything a user attaches is disclosed to that
processor. When a user connects an external agent, that agent's operator
(e.g. Anthropic for Claude Code) processes whatever the key can read. The
API-keys UI says this at mint time; a privacy policy must list both.

**Reference material is scratch, not record.** References live only in the
uploader's draft workspace and are deleted at the next publish. They are
never committed, so they don't enter Oxen history and aren't subject to the
"version control never forgets" trade-off above.

**Audit data is metadata-only by construction.** `mcp_audit_log.detail`
records slugs/labels/titles, never copy bodies — enforced by an allowlist
of auditable argument keys in `mcp/tools.ts` and covered by a test.

## Known gaps (accepted for now)

- No org-level controls: any member can mint keys; owners can't disable MCP
  per-project or see teammates' key inventory (the audit log does show
  agent *activity*).
- Rate limiting is per-key, not per-user or per-IP; unauthenticated
  requests still cost a hash lookup each.
- No anomaly detection on key usage (geo/velocity); revocation is manual.
- Supabase auth cookies and the single shared `OXEN_API_KEY` are unchanged
  from the base architecture; per-user Oxen identity is future work.
