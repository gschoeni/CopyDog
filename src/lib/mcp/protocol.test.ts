import { describe, expect, it } from "vitest";

import { handleMcpPost, type McpToolServer } from "./protocol";

const server: McpToolServer = {
  serverInfo: { name: "copydog-test", version: "0.0.0" },
  instructions: "test instructions",
  listTools: async () => [
    { name: "echo", description: "echoes", inputSchema: { type: "object", properties: {} } },
  ],
  callTool: async (name, args) => {
    if (name === "boom") throw new Error("kaboom");
    if (name !== "echo") return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(args) }] };
  },
};

function rpc(method: string, params?: unknown, id: unknown = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

async function post(body: string) {
  const res = await handleMcpPost(body, server);
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

describe("MCP streamable-HTTP core", () => {
  it("rejects invalid JSON with a parse error", async () => {
    const res = await post("{nope");
    expect(res.status).toBe(200);
    expect(res.json.error.code).toBe(-32700);
  });

  it("rejects batches (removed from the protocol in 2025-06-18)", async () => {
    const res = await post(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]));
    expect(res.json.error.code).toBe(-32600);
  });

  it("acknowledges notifications with 202 and no body", async () => {
    const res = await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
    expect(res.body).toBeNull();
  });

  it("negotiates a known protocol version by echoing it", async () => {
    const res = await post(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {} }));
    expect(res.json.result.protocolVersion).toBe("2025-03-26");
    expect(res.json.result.serverInfo.name).toBe("copydog-test");
    expect(res.json.result.capabilities.tools).toBeDefined();
    expect(res.json.result.instructions).toBe("test instructions");
  });

  it("answers an unknown protocol version with the newest it speaks", async () => {
    const res = await post(rpc("initialize", { protocolVersion: "2099-01-01" }));
    expect(res.json.result.protocolVersion).toBe("2025-06-18");
  });

  it("responds to ping", async () => {
    const res = await post(rpc("ping"));
    expect(res.json.result).toEqual({});
  });

  it("lists tools", async () => {
    const res = await post(rpc("tools/list"));
    expect(res.json.result.tools).toHaveLength(1);
    expect(res.json.result.tools[0].name).toBe("echo");
  });

  it("calls a tool and returns its content", async () => {
    const res = await post(rpc("tools/call", { name: "echo", arguments: { a: 1 } }));
    expect(res.json.result.content[0].text).toBe('{"a":1}');
    expect(res.json.result.isError).toBeUndefined();
  });

  it("turns tool exceptions into isError results, not protocol errors", async () => {
    const res = await post(rpc("tools/call", { name: "boom", arguments: {} }));
    expect(res.json.error).toBeUndefined();
    expect(res.json.result.isError).toBe(true);
    expect(res.json.result.content[0].text).toContain("kaboom");
  });

  it("requires a string tool name", async () => {
    const res = await post(rpc("tools/call", { arguments: {} }));
    expect(res.json.error.code).toBe(-32602);
  });

  it("rejects unknown methods", async () => {
    const res = await post(rpc("resources/list"));
    expect(res.json.error.code).toBe(-32601);
  });

  it("keeps the request id on results and errors", async () => {
    expect((await post(rpc("ping", undefined, 42))).json.id).toBe(42);
    expect((await post(rpc("nope", undefined, "abc"))).json.id).toBe("abc");
  });
});
