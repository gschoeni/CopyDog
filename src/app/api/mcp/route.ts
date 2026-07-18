import { authenticateMcp } from "@/lib/mcp/context";
import { McpToolError, RateLimitExceededError } from "@/lib/mcp/errors";
import { handleMcpPost } from "@/lib/mcp/protocol";
import { buildMcpServer } from "@/lib/mcp/tools";

/**
 * CopyDog's remote MCP endpoint (Streamable HTTP, stateless).
 *
 * External agents connect with a personal API key minted in Account → API
 * keys, sent as `Authorization: Bearer cdk_…`. Every request stands alone:
 * authenticate the key, charge its rate budget, build the tool server bound
 * to that key's scopes, answer as plain JSON. No sessions, no SSE.
 *
 *   claude mcp add --transport http copydog https://<host>/api/mcp \
 *     --header "Authorization: Bearer cdk_…"
 */

export async function POST(req: Request): Promise<Response> {
  const authorization = req.headers.get("authorization") ?? "";
  const key = /^bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!key) return unauthorized("Missing Authorization: Bearer <api key>");

  const api = await authenticateMcp(key);
  if (!api) return unauthorized("Unknown, revoked, or expired API key");

  try {
    await api.consumeRate(1);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      });
    }
    // rate accounting failed closed (e.g. the RPC errored) — return a
    // structured, retryable error, not an opaque framework 500 the agent
    // can't parse
    if (err instanceof McpToolError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "5" },
      });
    }
    throw err;
  }

  const result = await handleMcpPost(await req.text(), buildMcpServer(api));
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
