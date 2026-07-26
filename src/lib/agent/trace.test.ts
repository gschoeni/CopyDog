import { describe, expect, it } from "vitest";

import type { LlmTool } from "@/lib/llm/client";

import {
  buildTraceExport,
  redactContent,
  serializeTraceExport,
  toTraceMessage,
  TRACE_VERSION,
  type AgentTrace,
  type TraceExportRow,
} from "./trace";

const TOOLS: LlmTool[] = [
  { type: "function", function: { name: "rewrite_section", description: "…", parameters: {} } },
  { type: "function", function: { name: "never_offered", description: "…", parameters: {} } },
];

function trace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    version: TRACE_VERSION,
    model: "claude-sonnet-4-6",
    startedAt: "2026-07-26T00:00:00.000Z",
    durationMs: 1200,
    mutated: true,
    toolsOffered: ["rewrite_section"],
    rounds: [
      {
        model: "claude-sonnet-4-6",
        durationMs: 900,
        usage: { prompt_tokens: 1000, completion_tokens: 120, total_tokens: 1120 },
        content: "Let me punch that up.",
        toolCalls: [
          {
            id: "call_1",
            name: "rewrite_section",
            arguments: '{"sectionSlug":"hero","label":"Punchier"}',
            result: "Created version Punchier.",
            mutated: true,
            durationMs: 400,
          },
        ],
      },
    ],
    messages: [
      { role: "system", content: "You are CopyDog's assistant. Page: home" },
      { role: "user", content: "punch up the hero" },
      {
        role: "assistant",
        content: "Let me punch that up.",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "rewrite_section", arguments: "{}" } }],
      },
      { role: "tool", content: "Created version Punchier.", tool_call_id: "call_1" },
      { role: "assistant", content: "Done — sharper promise." },
    ],
    ...overrides,
  };
}

describe("redaction", () => {
  it("replaces a base64 payload with what it was, not what it contained", () => {
    // A 20 MB PDF becomes a 27 MB string; storing that in Postgres is absurd
    // and makes the export unreadable. The bytes stay in the draft workspace.
    const megabyte = "A".repeat(1_400_000);
    const redacted = redactContent([
      { type: "image_url", image_url: { url: `data:image/png;base64,${megabyte}` } },
      { type: "text", text: "build from this" },
    ]) as { type: string; image_url?: { url: string } }[];

    expect(redacted[0]!.image_url!.url).toBe("data:image/png;base64,<elided 1.1 MB>");
    expect(redacted[1]).toEqual({ type: "text", text: "build from this" });
  });

  it("elides a document but keeps its filename", () => {
    const redacted = redactContent([
      { type: "file", file: { filename: "deck.pdf", file_data: `data:application/pdf;base64,${"A".repeat(4000)}` } },
    ]) as { file: { filename: string; file_data: string } }[];
    expect(redacted[0]!.file.filename).toBe("deck.pdf");
    expect(redacted[0]!.file.file_data).toContain("<elided");
  });

  it("leaves plain text and remote urls alone", () => {
    expect(redactContent("just prose")).toBe("just prose");
    const kept = redactContent([{ type: "image_url", image_url: { url: "https://example.com/a.png" } }]);
    expect(JSON.stringify(kept)).toContain("https://example.com/a.png");
  });

  it("clips a tool result that ran away, saying how much it dropped", () => {
    const message = toTraceMessage({ role: "tool", content: "x".repeat(25_000), tool_call_id: "c" });
    expect(String(message.content)).toContain("more characters");
    expect(String(message.content).length).toBeLessThan(21_000);
  });
});

describe("buildTraceExport", () => {
  const context = {
    conversationId: "11111111-2222-3333-4444-555555555555",
    projectId: "proj",
    pageSlug: "home",
    tools: TOOLS,
    exportedAt: "2026-07-26T10:00:00.000Z",
  };

  const rows: TraceExportRow[] = [
    { role: "user", content: "punch up the hero", createdAt: "1", trace: null },
    { role: "assistant", content: "Done — sharper promise.", createdAt: "2", trace: trace() },
  ];

  it("produces the messages array fine-tuning expects, tool calls included", () => {
    const exported = buildTraceExport(rows, context);
    // opens on system, and the user message appears once — the trace's copy,
    // which is what the model actually saw
    expect(exported.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(exported.messages.filter((m) => m.content === "punch up the hero")).toHaveLength(1);
    const assistant = exported.messages.find((m) => m.tool_calls);
    expect(JSON.stringify(assistant!.tool_calls)).toContain("rewrite_section");
  });

  it("emits definitions only for the tools that turn actually offered", () => {
    const exported = buildTraceExport(rows, context);
    expect(exported.tools.map((t) => t.function.name)).toEqual(["rewrite_section"]);
  });

  it("carries the metadata a debugger asks for first", () => {
    const exported = buildTraceExport(rows, context);
    expect(exported.metadata).toMatchObject({
      conversationId: context.conversationId,
      pageSlug: "home",
      turns: 1,
      models: ["claude-sonnet-4-6"],
      totalTokens: 1120,
      totalDurationMs: 1200,
    });
  });

  it("records every model that ran, not just the agent loop's", () => {
    // design tools route to a vision model — a trace that hid that would send
    // someone debugging a layout to the wrong place entirely
    const withDesigner = trace({
      rounds: [
        { ...trace().rounds[0]!, model: "claude-sonnet-4-6" },
        {
          model: "gemini-3-1-pro-preview",
          durationMs: 3000,
          usage: { prompt_tokens: 8000, completion_tokens: 900, total_tokens: 8900 },
          content: "",
          toolCalls: [],
        },
      ],
    });
    const exported = buildTraceExport(
      [rows[0]!, { ...rows[1]!, trace: withDesigner }],
      context,
    );
    expect(exported.metadata.models).toEqual(["claude-sonnet-4-6", "gemini-3-1-pro-preview"]);
    expect(exported.metadata.totalTokens).toBe(10_020);
  });

  it("opens with exactly one system message across many turns", () => {
    const twoTurns = [...rows, { role: "user" as const, content: "again", createdAt: "3", trace: null }, {
      role: "assistant" as const,
      content: "Done again.",
      createdAt: "4",
      trace: trace(),
    }];
    const exported = buildTraceExport(twoTurns, context);
    expect(exported.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(exported.metadata.turns).toBe(2);
  });

  it("degrades to plain text for turns recorded before traces existed, and counts them", () => {
    const legacy: TraceExportRow[] = [
      { role: "user", content: "old question", createdAt: "1", trace: null },
      { role: "assistant", content: "old answer", createdAt: "2", trace: null },
    ];
    const exported = buildTraceExport(legacy, context);
    expect(exported.messages).toEqual([
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
    ]);
    expect(exported.metadata.turnsWithoutTrace).toBe(1);
    expect(exported.tools).toEqual([]);
  });
});

describe("serializeTraceExport", () => {
  it("is one conversation per line, so appending builds a dataset", () => {
    const line = serializeTraceExport(
      buildTraceExport([{ role: "user", content: "hi", createdAt: "1", trace: null }], {
        conversationId: "c",
        projectId: "p",
        pageSlug: "home",
        tools: [],
        exportedAt: "now",
      }),
    );
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(line) as { messages: unknown[] };
    expect(Array.isArray(parsed.messages)).toBe(true);
  });
});
