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

function sseResponse(events: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("LlmClient.chatStream", () => {
  it("streams content deltas and assembles the full message", async () => {
    let requestedStream: unknown;
    const client = new LlmClient({
      apiKey: "test-key",
      fetchImpl: fetchStub(async (req) => {
        requestedStream = ((await req.json()) as Record<string, unknown>).stream;
        return sseResponse([
          `data: {"model":"m","choices":[{"delta":{"content":"Hel"}}]}\n\n`,
          `data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\n`,
          `data: [DONE]\n\n`,
        ]);
      }),
    });

    const deltas: string[] = [];
    const result = await client.chatStream(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      (text) => deltas.push(text),
    );

    expect(requestedStream).toBe(true);
    expect(deltas).toEqual(["Hel", "lo", " there"]);
    expect(result.content).toBe("Hello there");
    expect(result.toolCalls).toEqual([]);
  });

  it("assembles tool calls from indexed argument fragments", async () => {
    const client = new LlmClient({
      apiKey: "test-key",
      fetchImpl: fetchStub(() =>
        sseResponse([
          `data: {"model":"m","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"design_section","arguments":"{\\"sec"}}]}}]}\n\n`,
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"tionSlug\\":\\"hero\\"}"}}]}}]}\n\n`,
          `data: [DONE]\n\n`,
        ]),
      ),
    });

    const result = await client.chatStream({ model: "m", messages: [{ role: "user", content: "hi" }] }, () => {});

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ id: "call_1", function: { name: "design_section" } });
    expect(JSON.parse(result.toolCalls[0]!.function.arguments)).toEqual({ sectionSlug: "hero" });
  });

  it("handles events split across network chunks", async () => {
    const whole = `data: {"model":"m","choices":[{"delta":{"content":"split across chunks"}}]}\n\n`;
    const client = new LlmClient({
      apiKey: "test-key",
      fetchImpl: fetchStub(() => sseResponse([whole.slice(0, 25), whole.slice(25)])),
    });

    const result = await client.chatStream({ model: "m", messages: [{ role: "user", content: "hi" }] }, () => {});
    expect(result.content).toBe("split across chunks");
  });

  it("falls back to plain JSON responses (providers that ignore stream)", async () => {
    const client = new LlmClient({
      apiKey: "test-key",
      fetchImpl: fetchStub(() =>
        Response.json({ model: "m", choices: [{ message: { content: "not streamed" } }] }),
      ),
    });

    const deltas: string[] = [];
    const result = await client.chatStream(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      (text) => deltas.push(text),
    );

    expect(result.content).toBe("not streamed");
    expect(deltas).toEqual(["not streamed"]);
  });
});
