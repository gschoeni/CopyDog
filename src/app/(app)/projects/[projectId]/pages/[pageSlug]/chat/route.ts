import type { NextRequest } from "next/server";
import { z } from "zod";

import type { ChatStreamEvent } from "@/lib/agent/events";
import { describeInteraction, type ChatInteraction } from "@/lib/agent/interactions";
import { runAgentTurn } from "@/lib/agent/run";
import { ContentStoreUnavailableError, requireProjectAccess } from "@/lib/content/access";
import { getLlmClient } from "@/lib/llm";
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
});

interface HistoryRow {
  role: "user" | "assistant";
  content: string;
  interaction: ChatInteraction | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; pageSlug: string }> },
) {
  const { projectId, pageSlug } = await params;

  let access;
  try {
    access = await requireProjectAccess(projectId);
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
  const { message, conversationId } = parsed.data;

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
    .select("role, content, interaction")
    .match({ project_id: projectId, user_id: user.id, page_slug: pageSlug, conversation_id: conversationId })
    .order("created_at", { ascending: true })
    .limit(30);
  if (historyError) {
    return Response.json({ error: "Could not load the conversation. Please try again." }, { status: 500 });
  }
  // interaction turns often have no prose — describe them so the model
  // remembers what it asked when the user's answer arrives
  const history = ((historyRows ?? []) as HistoryRow[]).map(({ role, content, interaction }) => ({
    role,
    content: interaction ? [content, describeInteraction(interaction)].filter(Boolean).join("\n\n") : content,
  }));

  const userInserted = await supabase.from("chat_messages").insert({
    project_id: projectId,
    user_id: user.id,
    page_slug: pageSlug,
    conversation_id: conversationId,
    role: "user",
    content: message,
  });
  if (userInserted.error) {
    return Response.json({ error: "Could not save your message. Please try again." }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const turn = await runAgentTurn({ oxen, view, pageSlug, llm }, history, message, send);
        if (turn.interaction) send({ type: "interaction", interaction: turn.interaction });
        const inserted = await supabase.from("chat_messages").insert({
          project_id: projectId,
          user_id: user.id,
          page_slug: pageSlug,
          conversation_id: conversationId,
          role: "assistant",
          content: turn.reply,
          interaction: turn.interaction ?? null,
        });
        if (inserted.error) console.error("failed to save assistant reply", inserted.error);
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
