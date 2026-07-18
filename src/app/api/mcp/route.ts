import { getLlmClient } from "@/lib/llm";
import { verifyApiKey } from "@/lib/mcp/keys";
import { handleMcpPost } from "@/lib/mcp/protocol";
import { buildMcpServer, type McpContext } from "@/lib/mcp/tools";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * CopyDog's remote MCP endpoint (Streamable HTTP, stateless).
 *
 * External agents connect with a personal API key minted in Account → API
 * keys, sent as `Authorization: Bearer cdk_…`. Every request stands alone:
 * authenticate the key, build the tool server bound to that user, answer as
 * plain JSON. No sessions, no SSE — the stateless subset of the transport,
 * which is all Claude Code / claude.ai need from a tools-only server.
 *
 *   claude mcp add --transport http copydog https://<host>/api/mcp \
 *     --header "Authorization: Bearer cdk_…"
 */

export async function POST(req: Request): Promise<Response> {
  const authorization = req.headers.get("authorization") ?? "";
  const key = /^bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!key) return unauthorized("Missing Authorization: Bearer <api key>");

  const admin = createAdminClient();
  const identity = await verifyApiKey(admin, key);
  if (!identity) return unauthorized("Unknown or revoked API key");

  const ctx: McpContext = { userId: identity.userId, supabase: admin, llm: getLlmClient() };
  const result = await handleMcpPost(await req.text(), buildMcpServer(ctx));
  return new Response(result.body, { status: result.status, headers: result.headers });
}

/** Stateless server: no server-initiated stream to offer. */
export async function GET(): Promise<Response> {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

/** Session termination is a no-op — there are no sessions to terminate. */
export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 200 });
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="CopyDog MCP", error="invalid_token"',
    },
  });
}
