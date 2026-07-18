# Security & Data Privacy

Security and privacy are architectural concerns in CopyDog, not review-time
checklists. This doc records the model, the enforced boundaries, and the
deliberate trade-offs. Change any of these consciously — most have a matching
entry in [05_decisions.md](05_decisions.md).

## Trust model

| Actor | Trust | Enforced by |
|---|---|---|
| Signed-in browser user | Their own memberships | Supabase RLS on every query (cookie session → `auth.uid()`) |
| External agent with an API key | The key owner's memberships, narrowed by scopes | `McpToolApi` facade + membership gate + scope checks |
| Content read by any LLM (copy, comments, imported sites) | **Untrusted input** | sanitizer allowlist, acceptance gates, MCP guardrails below |
| The service-role Supabase client | Bypasses RLS — most dangerous object in the system | confined to two modules, eslint-fenced |

## Authorization boundaries

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
- **URL imports are SSRF-hardened** (`import/fetch-url.ts`): http(s) only;
  private/loopback/link-local hosts blocked; **DNS answers checked** (a
  public name resolving to a private IP fails closed, including v4-mapped
  IPv6); **redirects followed manually** with every hop re-validated; ≤5
  hops, 10s timeout, 2MB cap.
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
inference (wireframe design, import extraction). When a user connects an
external agent, that agent's operator (e.g. Anthropic for Claude Code)
processes whatever the key can read. The API-keys UI says this at mint
time; a privacy policy must list both.

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
