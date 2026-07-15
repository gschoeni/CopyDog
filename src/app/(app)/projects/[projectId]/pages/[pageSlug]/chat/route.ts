import type { NextRequest } from "next/server";
import { z } from "zod";

import type { ChatStreamEvent } from "@/lib/agent/events";
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
 *   {type:"done", reply, mutated}
 *   {type:"error", error}
 * Messages persist to chat_messages exactly like the old non-streaming
 * action: the user message before the turn, the reply after.
 */

const chatInput = z.object({ message: z.string().trim().min(1).max(4000) });

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
  const { message } = parsed.data;

  const llm = getLlmClient();
  if (!llm) {
    return Response.json(
      { error: "The assistant needs an Oxen.ai inference key (OXEN_API_KEY) configured." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .match({ project_id: projectId, user_id: user.id, page_slug: pageSlug })
    .order("created_at", { ascending: true })
    .limit(30);
  const history = (historyRows ?? []) as { role: "user" | "assistant"; content: string }[];

  await supabase.from("chat_messages").insert({
    project_id: projectId,
    user_id: user.id,
    page_slug: pageSlug,
    role: "user",
    content: message,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const turn = await runAgentTurn({ oxen, view, pageSlug, llm }, history, message, send);
        await supabase.from("chat_messages").insert({
          project_id: projectId,
          user_id: user.id,
          page_slug: pageSlug,
          role: "assistant",
          content: turn.reply,
        });
        send({ type: "done", reply: turn.reply, mutated: turn.mutated });
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
