import { describe, expect, it } from "vitest";

import { LlmClient, LlmError } from "./client";

function fetchStub(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => handler(new Request(input, init));
}

describe("LlmClient", () => {
  it("sends an OpenAI-compatible chat completion request", async () => {
    let captured: { url: string; auth: string | null; body: Record<string, unknown> } | undefined;
    const client = new LlmClient({
      apiKey: "test-key",
      fetchImpl: fetchStub(async (req) => {
        captured = {
          url: req.url,
          auth: req.headers.get("authorization"),
          body: (await req.json()) as Record<string, unknown>,
        };
        return Response.json({
          model: "claude-sonnet-4-6",
          choices: [{ message: { content: "Sure — here are three headline options." } }],
          usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
        });
      }),
    });

    const result = await client.chat({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Brainstorm hero headlines" }],
    });

    expect(captured?.url).toBe("https://hub.oxen.ai/api/ai/chat/completions");
    expect(captured?.auth).toBe("Bearer test-key");
    expect(captured?.body.model).toBe("claude-sonnet-4-6");
    expect(result.content).toContain("headline options");
    expect(result.usage?.total_tokens).toBe(22);
  });

  it("throws LlmError with status on API failure", async () => {
    const client = new LlmClient({
      apiKey: "bad-key",
      fetchImpl: fetchStub(() => new Response("unauthorized", { status: 401 })),
    });

    await expect(
      client.chat({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("throws LlmError when the response has no choices", async () => {
    const client = new LlmClient({
      apiKey: "test-key",
      fetchImpl: fetchStub(() => Response.json({ model: "m", choices: [] })),
    });

    await expect(
      client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});
