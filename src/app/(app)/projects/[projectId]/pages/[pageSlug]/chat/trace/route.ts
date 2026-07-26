import type { NextRequest } from "next/server";
import { z } from "zod";

import { describeContextRefs, type ChatContextRef } from "@/lib/agent/context";
import { AGENT_TOOLS } from "@/lib/agent/tools";
import {
  agentTraceSchema,
  buildTraceExport,
  serializeTraceExport,
  type AgentTrace,
  type TraceExportRow,
} from "@/lib/agent/trace";
import { UnauthenticatedError } from "@/lib/content/access";
import { createClient } from "@/lib/supabase/server";

/**
 * Downloads one conversation as a JSONL fine-tuning example: a single line of
 * `{"messages": [...], "tools": [...], "metadata": {...}}`. That is the shape
 * OpenAI's supervised fine-tuning takes and what Oxen's `text_chat_messages`
 * reads out of a `messages_column`, so appending more conversations to the
 * same file builds a dataset.
 *
 * It is also the debugging view: the tool calls and their arguments are how
 * the model actually decided, and the reply never shows them.
 *
 * Authorization is RLS's, not ours — `chat_messages` is selectable only by the
 * user who owns the row, so a conversation id belonging to someone else
 * simply returns nothing.
 */

const query = z.object({ conversationId: z.uuid() });

interface Row {
  role: "user" | "assistant";
  content: string;
  context: ChatContextRef[] | null;
  trace: unknown;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; pageSlug: string }> },
) {
  const { projectId, pageSlug } = await params;

  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return Response.json({ error: "A conversation id is required." }, { status: 400 });
  }
  const { conversationId } = parsed.data;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    throw new UnauthenticatedError();
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, context, trace, created_at")
    .match({ project_id: projectId, page_slug: pageSlug, conversation_id: conversationId })
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("trace export failed", error);
    return Response.json({ error: "Could not read that conversation." }, { status: 500 });
  }
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    return Response.json({ error: "No conversation found." }, { status: 404 });
  }

  const exported = buildTraceExport(rows.map(toExportRow), {
    conversationId,
    projectId,
    pageSlug,
    tools: AGENT_TOOLS,
    exportedAt: new Date().toISOString(),
  });

  const filename = `copydog-trace-${pageSlug}-${conversationId.slice(0, 8)}.jsonl`;
  return new Response(serializeTraceExport(exported), {
    headers: {
      "Content-Type": "application/jsonl; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function toExportRow(row: Row): TraceExportRow {
  // the user's attachments are prose to the model, so the export shows what
  // the model was actually given rather than the chip the UI drew
  const content =
    row.role === "user" && row.context?.length
      ? [describeContextRefs(row.context), row.content].join("\n\n")
      : row.content;
  return { role: row.role, content, createdAt: row.created_at, trace: parseTrace(row.trace) };
}

/** A trace that no longer matches the schema is treated as absent, not fatal. */
function parseTrace(value: unknown): AgentTrace | null {
  if (value === null || value === undefined) return null;
  const parsed = agentTraceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
