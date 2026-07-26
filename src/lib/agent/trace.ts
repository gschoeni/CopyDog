import { z } from "zod";

import type { LlmContentPart, LlmMessage, LlmTool } from "@/lib/llm/client";

/**
 * The record of how a turn actually happened: the messages the model was
 * given, the tools it called and what they answered, which model ran, and
 * what it cost. Kept for two reasons that want the same thing —
 *
 *  - **debugging**: "why did it lay the page out like that" is unanswerable
 *    from the reply alone. The tool arguments are the decision.
 *  - **fine-tuning**: a trace is one training example. The export is the
 *    `{"messages": [...]}` shape OpenAI's supervised fine-tuning takes and
 *    Oxen's `text_chat_messages` reads out of a `messages_column`.
 *
 * A turn stores only what *it* added — the system prompt it ran under, the
 * user message, and its own assistant/tool exchange. Prior history is already
 * in the rows before it, so storing it again would make a conversation cost
 * O(n²) to keep. `buildTraceExport` stitches the rows back into one example.
 */

export const TRACE_VERSION = 1;

/** Beyond this a single tool result is clipped — layouts get long. */
const MAX_TOOL_RESULT = 20_000;

const usageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

const traceToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Raw JSON as the model emitted it — this is the decision, keep it verbatim. */
  arguments: z.string(),
  result: z.string(),
  mutated: z.boolean(),
  durationMs: z.number(),
});

const traceRoundSchema = z.object({
  model: z.string(),
  durationMs: z.number(),
  usage: usageSchema.nullable(),
  /** What the model said this round, before any tools ran. */
  content: z.string(),
  toolCalls: z.array(traceToolCallSchema),
});

/** A message as stored: same shape as the wire, minus anything enormous. */
const traceMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.unknown(),
  tool_calls: z.unknown().optional(),
  tool_call_id: z.string().optional(),
});

export const agentTraceSchema = z.object({
  version: z.literal(TRACE_VERSION),
  /** The model the agent loop ran on (design tools may use others — see rounds). */
  model: z.string(),
  startedAt: z.string(),
  durationMs: z.number(),
  mutated: z.boolean(),
  /** Tool names offered this turn, so an export can emit their definitions. */
  toolsOffered: z.array(z.string()),
  rounds: z.array(traceRoundSchema),
  /** What this turn added to the conversation. */
  messages: z.array(traceMessageSchema),
});

export type AgentTrace = z.infer<typeof agentTraceSchema>;
export type TraceRound = z.infer<typeof traceRoundSchema>;
export type TraceMessage = z.infer<typeof traceMessageSchema>;

// -- redaction -------------------------------------------------------------

/**
 * Reference material reaches the model as base64 — a 20 MB PDF becomes a
 * 27 MB string. Storing that in Postgres would be absurd and would make the
 * export unreadable, so a data URL is replaced by a description of what it
 * was. The fact that an image was present, and how big, is what a trace
 * needs; the pixels are still in the draft workspace if anyone wants them.
 */
export function redactContent(content: LlmMessage["content"]): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((part) => redactPart(part));
}

function redactPart(part: LlmContentPart): unknown {
  if (part.type === "image_url") {
    return { type: "image_url", image_url: { url: elide(part.image_url.url) } };
  }
  if (part.type === "file") {
    return {
      type: "file",
      file: {
        ...part.file,
        ...(part.file.file_data ? { file_data: elide(part.file.file_data) } : {}),
      },
    };
  }
  return part;
}

function elide(url: string): string {
  if (!url.startsWith("data:")) return url;
  const mime = url.slice(5, url.indexOf(";")) || "application/octet-stream";
  const base64 = url.slice(url.indexOf(",") + 1);
  const bytes = Math.round((base64.length * 3) / 4);
  return `data:${mime};base64,<elided ${formatBytes(bytes)}>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** A message ready to store: binaries elided, long tool results clipped. */
export function toTraceMessage(message: LlmMessage): TraceMessage {
  const content =
    message.role === "tool" && typeof message.content === "string"
      ? clip(message.content, MAX_TOOL_RESULT)
      : redactContent(message.content);
  return {
    role: message.role,
    content,
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
  };
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(${text.length - max} more characters)`;
}

// -- export ----------------------------------------------------------------

export interface TraceExportRow {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  trace: AgentTrace | null;
}

export interface TraceExport {
  /** The conversation as one fine-tuning example. */
  messages: TraceMessage[];
  /** Definitions for the tools the agent had, for function-calling fine-tunes. */
  tools: LlmTool[];
  metadata: {
    conversationId: string;
    projectId: string;
    pageSlug: string;
    exportedAt: string;
    traceVersion: number;
    turns: number;
    /** Every model that ran, agent loop and design tools alike. */
    models: string[];
    totalTokens: number;
    totalDurationMs: number;
    /** Turns whose detail predates trace capture — reconstructed from text. */
    turnsWithoutTrace: number;
  };
}

/**
 * Stitches a conversation's rows into one training example.
 *
 * The system prompt comes from the first turn that has one: it carries the
 * page's copy and wireframe at that moment, which is the context the whole
 * conversation started from. Later turns contribute everything except their
 * system message, so the example reads as one continuous exchange.
 */
export function buildTraceExport(
  rows: TraceExportRow[],
  context: { conversationId: string; projectId: string; pageSlug: string; tools: LlmTool[]; exportedAt: string },
): TraceExport {
  const messages: TraceMessage[] = [];
  const models = new Set<string>();
  let totalTokens = 0;
  let totalDurationMs = 0;
  let turnsWithoutTrace = 0;
  let systemSeen = false;

  for (const [index, row] of rows.entries()) {
    // A user message is stored twice — as its own row, and inside the trace of
    // the turn it started, which is the copy the model actually saw
    // (attachments described, references listed). Prefer the trace's and skip
    // the row, or the example repeats itself and opens on the wrong role.
    if (row.role === "user") {
      const answeredWithTrace = rows.slice(index + 1).find((next) => next.role === "assistant")?.trace;
      if (!answeredWithTrace) messages.push({ role: "user", content: row.content });
      continue;
    }

    if (!row.trace) {
      // written before traces were captured (or by a turn that failed early):
      // the text is all we have, and saying so beats implying we know more
      messages.push({ role: "assistant", content: row.content });
      turnsWithoutTrace++;
      continue;
    }

    models.add(row.trace.model);
    totalDurationMs += row.trace.durationMs;
    for (const round of row.trace.rounds) {
      models.add(round.model);
      totalTokens += round.usage?.total_tokens ?? 0;
    }

    for (const message of row.trace.messages) {
      if (message.role === "system") {
        if (systemSeen) continue; // one system message opens the example
        systemSeen = true;
      }
      messages.push(message);
    }
  }

  const offered = new Set(rows.flatMap((row) => row.trace?.toolsOffered ?? []));
  return {
    messages,
    tools: context.tools.filter((tool) => offered.has(tool.function.name)),
    metadata: {
      conversationId: context.conversationId,
      projectId: context.projectId,
      pageSlug: context.pageSlug,
      exportedAt: context.exportedAt,
      traceVersion: TRACE_VERSION,
      turns: rows.filter((row) => row.role === "assistant").length,
      models: [...models].sort(),
      totalTokens,
      totalDurationMs,
      turnsWithoutTrace,
    },
  };
}

/**
 * One conversation, one line — the JSONL shape fine-tuning pipelines read.
 * Appending more conversations to the same file builds a dataset.
 */
export function serializeTraceExport(exported: TraceExport): string {
  return `${JSON.stringify(exported)}\n`;
}
