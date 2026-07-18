/**
 * Minimal, stateless MCP server core over Streamable HTTP.
 *
 * Hand-rolled on purpose (like src/lib/llm/client.ts): the stateless subset
 * of the protocol is a few JSON-RPC methods, and owning it means no SDK/zod
 * version coupling and a handler that unit-tests as a pure function. Every
 * POST is independent — no sessions, no server-initiated streams, responses
 * are plain application/json (the spec allows this in place of SSE).
 *
 * Spec: https://modelcontextprotocol.io/specification — protocol versions
 * are negotiated in `initialize`; we speak the stateless core that has been
 * unchanged across 2024-11-05 → 2025-06-18.
 */

/** Newest first. Unknown client versions get the newest we speak. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** What a transport needs from us: server identity + a tool surface. */
export interface McpToolServer {
  serverInfo: { name: string; version: string };
  /** Optional usage guidance shown to the connecting model. */
  instructions?: string;
  listTools(): Promise<McpToolDef[]>;
  /** Domain errors should come back as isError results, not throws. */
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface McpHttpResponse {
  status: number;
  body: string | null;
  headers: Record<string, string>;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const JSON_HEADERS = { "content-type": "application/json" };

function rpcResult(id: unknown, result: unknown): McpHttpResponse {
  return { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id, result }) };
}

function rpcError(id: unknown, code: number, message: string): McpHttpResponse {
  return {
    status: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }),
  };
}

/** Handles one Streamable-HTTP POST body. Transport-agnostic and side-effect free. */
export async function handleMcpPost(rawBody: string, server: McpToolServer): Promise<McpHttpResponse> {
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(rawBody) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error: body is not valid JSON");
  }
  if (Array.isArray(message)) {
    // JSON-RPC batching was removed from MCP in 2025-06-18; keep it simple
    return rpcError(null, -32600, "Batch requests are not supported");
  }
  if (typeof message !== "object" || message === null || typeof message.method !== "string") {
    return rpcError(null, -32600, "Invalid request: expected a JSON-RPC message with a method");
  }

  const { id, method, params } = message;

  // Notifications (no id) are acknowledged and ignored — we keep no session state.
  if (id === undefined || id === null) {
    return { status: 202, headers: {}, body: null };
  }

  switch (method) {
    case "initialize":
      return rpcResult(id, initializeResult(params, server));
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: await server.listTools() });
    case "tools/call":
      return toolsCall(id, params, server);
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function initializeResult(params: unknown, server: McpToolServer) {
  const requested =
    typeof params === "object" && params !== null
      ? (params as { protocolVersion?: unknown }).protocolVersion
      : undefined;
  const protocolVersion =
    typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : SUPPORTED_PROTOCOL_VERSIONS[0]!;
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: server.serverInfo,
    ...(server.instructions ? { instructions: server.instructions } : {}),
  };
}

async function toolsCall(id: unknown, params: unknown, server: McpToolServer): Promise<McpHttpResponse> {
  const p = (typeof params === "object" && params !== null ? params : {}) as {
    name?: unknown;
    arguments?: unknown;
  };
  if (typeof p.name !== "string") {
    return rpcError(id, -32602, "tools/call requires a string `name`");
  }
  const args =
    typeof p.arguments === "object" && p.arguments !== null && !Array.isArray(p.arguments)
      ? (p.arguments as Record<string, unknown>)
      : {};
  try {
    return rpcResult(id, await server.callTool(p.name, args));
  } catch (err) {
    // tool-level failures are results the model can read, not protocol errors
    const text = err instanceof Error ? err.message : String(err);
    const result: McpToolResult = { content: [{ type: "text", text: `Error: ${text}` }], isError: true };
    return rpcResult(id, result);
  }
}
