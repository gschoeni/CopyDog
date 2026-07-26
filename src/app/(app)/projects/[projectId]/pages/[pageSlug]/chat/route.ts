import type { NextRequest } from "next/server";
import { z } from "zod";

import { chatContextListSchema, describeContextRefs, isReferenceRef, type ChatContextRef } from "@/lib/agent/context";
import type { ChatStreamEvent } from "@/lib/agent/events";
import { describeInteraction, type ChatInteraction } from "@/lib/agent/interactions";
import { createReferenceLibrary } from "@/lib/agent/references";
import { runAgentTurn } from "@/lib/agent/run";
import { ContentStoreUnavailableError, requireProjectAccess } from "@/lib/content/access";
import { getLlmClient } from "@/lib/llm";
import { userContent } from "@/lib/llm/client";
import { createClient } from "@/lib/supabase/server";

/**
 * One streaming agent turn. The response is ndjson — one JSON event per
 * line — so the panel can render tokens, tool activity, and draft reloads
 * as they happen:
 *   {type:"delta", text}    assistant tokens (narration between tools too)
 *   {type:"status", label}  a tool is running ("Designing hero…")
 *   {type:"mutated"}        the draft changed — reload the view
 *   {type:"interaction", interaction} agent requests a first-class UI interaction
 *   {type:"done", reply, mutated, interaction?}
 *   {type:"error", error}
 * Messages persist to chat_messages: the user message before the turn,
 * the reply (with any interaction) after.
 */

const chatInput = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid(),
  context: chatContextListSchema.optional(),
});

interface HistoryRow {
  role: "user" | "assistant";
  content: string;
  interaction: ChatInteraction | null;
  context: ChatContextRef[] | null;
}

/** What the model sees for one stored message: attachments and interactions rendered as text. */
function modelContent(row: HistoryRow): string {
  const parts = [row.content];
  if (row.context?.length) parts.unshift(describeContextRefs(row.context));
  if (row.interaction) parts.push(describeInteraction(row.interaction));
  return parts.filter(Boolean).join("\n\n");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; pageSlug: string }> },
) {
  const { projectId, pageSlug } = await params;

  let access;
  try {
    access = await requireProjectAccess(projectId, { write: true });
  } catch (err) {
    if (err instanceof ContentStoreUnavailableError) {
      return Response.json({ error: "The content store is unreachable — is the Oxen server running?" }, { status: 503 });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { oxen, view, user } = access;

  const parsed = chatInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid message" }, { status: 400 });
  }
  const { message, conversationId, context } = parsed.data;

  const llm = getLlmClient();
  if (!llm) {
    return Response.json(
      { error: "The assistant needs an Oxen.ai inference key (OXEN_API_KEY) configured." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: historyRows, error: historyError } = await supabase
    .from("chat_messages")
    .select("role, content, interaction, context")
    .match({ project_id: projectId, user_id: user.id, page_slug: pageSlug, conversation_id: conversationId })
    .order("created_at", { ascending: true })
    .limit(30);
  if (historyError) {
    return Response.json({ error: "Could not load the conversation. Please try again." }, { status: 500 });
  }
  // attachments and interaction turns are stored structured — render them
  // into the text the model sees (chips in the UI, exact context here)
  const history = ((historyRows ?? []) as HistoryRow[]).map((row) => ({
    role: row.role,
    content: modelContent(row),
  }));
  // references travel as real image/document parts; everything else (page
  // selections, the reference roster) is prose prepended to the user's message
  const references = createReferenceLibrary(oxen, view, conversationId);
  const attached = await references.loadMany((context ?? []).filter(isReferenceRef).map((ref) => ref.id));
  const userMessage = userContent(
    await references.contentParts(attached),
    context?.length ? [describeContextRefs(context), message].join("\n\n") : message,
  );

  const userInserted = await supabase.from("chat_messages").insert({
    project_id: projectId,
    user_id: user.id,
    page_slug: pageSlug,
    conversation_id: conversationId,
    role: "user",
    content: message,
    context: context?.length ? context : null,
  });
  if (userInserted.error) {
    return Response.json({ error: "Could not save your message. Please try again." }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const turn = await runAgentTurn({ oxen, view, pageSlug, llm, references }, history, userMessage, send);
        if (turn.interaction) send({ type: "interaction", interaction: turn.interaction });
        const row = {
          project_id: projectId,
          user_id: user.id,
          page_slug: pageSlug,
          conversation_id: conversationId,
          role: "assistant" as const,
          content: turn.reply,
          interaction: turn.interaction ?? null,
        };
        const inserted = await supabase.from("chat_messages").insert({ ...row, trace: turn.trace });
        if (inserted.error) {
          // the trace is debugging material; the reply is the user's
          // conversation. Never lose the second to a problem with the first.
          console.error("failed to save assistant reply with its trace", inserted.error);
          const retried = await supabase.from("chat_messages").insert(row);
          if (retried.error) console.error("failed to save assistant reply", retried.error);
        }
        send({ type: "done", reply: turn.reply, mutated: turn.mutated, interaction: turn.interaction });
      } catch (err) {
        console.error("agent turn failed", err);
        send({ type: "error", error: "The assistant hit an error — try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
