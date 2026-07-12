import { describe, expect, it } from "vitest";

import { OxenClient } from "./client";
import { OxenStub } from "./stub";

/**
 * Older oxen-servers (<= 0.50.x) don't have /workspaces/get_or_create —
 * the client must fall back to `PUT /workspaces`.
 */
describe("OxenClient compatibility with older servers", () => {
  it("falls back to PUT /workspaces when get_or_create is 404", async () => {
    const stub = new OxenStub();
    // wrap the stub to behave like an old server: 404 the modern route
    const oldServerFetch: typeof fetch = async (input, init) => {
      const req = new Request(input, init);
      if (req.method === "PUT" && new URL(req.url).pathname.endsWith("/workspaces/get_or_create")) {
        return new Response(`{"status":"error","status_message":"resource_not_found"}`, { status: 404 });
      }
      return stub.fetch(req);
    };

    const client = new OxenClient({
      token: "t",
      namespace: "ns",
      baseUrl: "https://old.oxen.local",
      fetchImpl: oldServerFetch,
    });

    await client.createRepo("repo", { user: { name: "g", email: "g@x.dev" } });
    const ws = await client.getOrCreateWorkspace("repo", { workspaceId: "ws-1", branchName: "main" });
    expect(ws.id).toBe("ws-1");
  });
});
