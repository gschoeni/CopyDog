import { readDoc, readElementsRun, readSectionVersion } from "@/lib/content/store";
import { LLM_MODELS, type LlmMessage } from "@/lib/llm/client";

import { AGENT_TOOLS, executeTool, type ToolContext } from "./tools";

/**
 * The agent loop: give the model the page's current copy and the tools,
 * let it act (max a few rounds), and return what it said plus whether it
 * changed anything (so the UI can reload the draft).
 */

const MAX_ROUNDS = 5;

const SYSTEM_PROMPT = `You are CopyDog's writing and layout assistant — a seasoned copywriter and wireframe designer.

You help with website copy (rewrites, alternatives, new sections) and greyscale wireframe layout. You act
through tools; everything you change lands in the user's private draft, never the team's copy.

Guidelines:
- When asked to change copy, use rewrite_section to create a NEW version with a short descriptive label —
  never describe changes without making them.
- When asked about layout, use update_wireframe with a precise instruction.
- Copy markdown dialect: #–###### headings, paragraphs, "- " bullets, [Label](url) alone on a line is a CTA
  button, an "<!--eyebrow-->" line marks the next line as a short overline.
- Keep replies short and concrete: say what you did and why it works. No filler.`;

export interface AgentTurn {
  reply: string;
  mutated: boolean;
}

export async function runAgentTurn(
  ctx: ToolContext,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
): Promise<AgentTurn> {
  const pageContext = await buildPageContext(ctx);
  const messages: LlmMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${pageContext}` },
    ...history.map((m): LlmMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let mutated = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await ctx.llm.chat({
      model: LLM_MODELS.copy,
      messages,
      tools: AGENT_TOOLS,
      maxTokens: 4000,
    });

    if (result.toolCalls.length === 0) {
      return { reply: result.content || "Done.", mutated };
    }

    messages.push({ role: "assistant", content: result.content || null, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      let outcome;
      try {
        outcome = await executeTool(call.function.name, call.function.arguments, ctx);
      } catch (err) {
        outcome = { result: `Tool failed: ${err instanceof Error ? err.message : "unknown error"}`, mutated: false };
      }
      mutated = mutated || outcome.mutated;
      messages.push({ role: "tool", content: outcome.result, tool_call_id: call.id });
    }
  }

  // ran out of rounds before the model produced a closing message
  return {
    reply: mutated
      ? "I made the changes — take a look."
      : "I couldn't finish that — try rephrasing or breaking it into smaller steps.",
    mutated,
  };
}

async function buildPageContext(ctx: ToolContext): Promise<string> {
  const doc = await readDoc(ctx.oxen, ctx.view, ctx.pageSlug);
  if (doc.content.length === 0) {
    return `Current page "${ctx.pageSlug}" is empty.`;
  }
  const parts = await Promise.all(
    doc.content.map(async (entry) => {
      if (entry.kind === "elements") {
        const markdown = (await readElementsRun(ctx.oxen, ctx.view, ctx.pageSlug, entry.slug)) ?? "";
        return `### Loose copy (not in a section)\n${markdown || "(empty)"}`;
      }
      const markdown =
        (await readSectionVersion(ctx.oxen, ctx.view, ctx.pageSlug, entry.slug, entry.activeVersion)) ?? "";
      const linkNote = entry.linked ? "" : ", unlinked from the wireframe";
      return `### ${entry.title} (section slug: ${entry.slug}, active version: ${entry.activeVersion}${linkNote})\n${markdown || "(empty)"}`;
    }),
  );
  return `Current copy on page "${ctx.pageSlug}":\n\n${parts.join("\n\n")}`;
}
