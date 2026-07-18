import { readDoc, readElementsRun, readSectionVersion, readWireframe } from "@/lib/content/store";
import { LLM_MODELS, type LlmMessage } from "@/lib/llm/client";

import { AGENT_TOOLS, executeTool, toolActivityLabel, type ToolContext } from "./tools";
import type { ChatInteraction } from "./interactions";

/**
 * The agent loop: give the model the page's current copy + wireframe and
 * the tools, let it act (max a few rounds), and return what it said plus
 * whether it changed anything (so the UI can reload the draft).
 */

const MAX_ROUNDS = 8;

/** Beyond this the wireframe context is cut — enough for any sane page. */
const WIREFRAME_CONTEXT_LIMIT = 20_000;

const SYSTEM_PROMPT = `You are CopyDog's writing and layout assistant — a seasoned copywriter and wireframe designer
who has worked at Apple, Notion, and Figma. You design clean greyscale wireframes and write copy that earns its place.

You act through tools; everything you change lands in the user's private draft, never the team's copy.

Designing wireframes:
- Section-scoped requests ("make the hero a split", "put the image on the left", "card grid for features")
  → design_section for that one section. It's the default move; it leaves the rest of the page alone.
- Page-scoped requests ("lay the page out", "more rhythm", "feels monotonous") → redesign_page.
- You can see the current wireframe HTML below — read it before deciding, describe layouts in its terms
  (split, grid of cards, tinted band, logo strip, stats, FAQ rows), and vary patterns between sections.
- Building from nothing: when the page is empty and the user describes a site ("landing page for a dog-walking
  startup"), create the sections with add_section — real starter copy, one section per band of the page
  (hero, social proof, features, how it works, testimonial, CTA…) — then one redesign_page to lay it all out.
  Don't ask permission section by section; deliver a first draft they can react to.

Writing copy:
- rewrite_section creates a NEW version with a short descriptive label — never describe changes without
  making them. The original is always preserved.
- Copy markdown dialect: #–###### headings, paragraphs, "- " bullets, "1. " numbered lists, [Label](url)
  alone on a line is a CTA button, an "<!--eyebrow-->" line marks the next line as a short overline.

- When a real design or copy decision has 2–4 sensible paths, call ask_user_choice. Give each option a short label
  and concrete trade-off. Do not duplicate the options in prose — the user gets a dedicated interactive choice card.

Keep replies short and concrete: say what you did and why it works. No filler.`;

export interface AgentTurn {
  reply: string;
  mutated: boolean;
  /** A first-class UI interaction requested by the agent; ends this turn. */
  interaction?: ChatInteraction;
}

/** Live progress from a running turn, for streaming UIs. */
export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "status"; label: string }
  | { type: "mutated" };

export async function runAgentTurn(
  ctx: ToolContext,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  onEvent?: (event: AgentEvent) => void,
): Promise<AgentTurn> {
  const pageContext = await buildPageContext(ctx);
  const messages: LlmMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${pageContext}` },
    ...history.map((m): LlmMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let mutated = false;
  const replyParts: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const options = { model: LLM_MODELS.copy, messages, tools: AGENT_TOOLS, maxTokens: 4000 };
    // narration between tool calls streams too — the turn reads as one reply
    const result = onEvent
      ? await ctx.llm.chatStream(options, (text) => onEvent({ type: "delta", text }))
      : await ctx.llm.chat(options);

    if (result.content) replyParts.push(result.content);

    if (result.toolCalls.length === 0) {
      return { reply: replyParts.join("\n\n") || "Done.", mutated };
    }

    messages.push({ role: "assistant", content: result.content || null, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      onEvent?.({ type: "status", label: toolActivityLabel(call.function.name, call.function.arguments) });
      let outcome;
      try {
        outcome = await executeTool(call.function.name, call.function.arguments, ctx);
      } catch (err) {
        outcome = { result: `Tool failed: ${err instanceof Error ? err.message : "unknown error"}`, mutated: false };
      }
      if (outcome.interaction) {
        return { reply: replyParts.join("\n\n"), mutated, interaction: outcome.interaction };
      }
      if (outcome.mutated) {
        mutated = true;
        onEvent?.({ type: "mutated" });
      }
      messages.push({ role: "tool", content: outcome.result, tool_call_id: call.id });
    }
  }

  // ran out of rounds before the model produced a closing message
  const fallback = mutated
    ? "I made the changes — take a look."
    : "I couldn't finish that — try rephrasing or breaking it into smaller steps.";
  return { reply: replyParts.concat(fallback).join("\n\n"), mutated };
}

async function buildPageContext(ctx: ToolContext): Promise<string> {
  const doc = await readDoc(ctx.oxen, ctx.view, ctx.pageSlug);
  if (doc.content.length === 0) {
    return `Current page "${ctx.pageSlug}" is empty — no copy, no wireframe. Build it when asked.`;
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

  const wireframe = (await readWireframe(ctx.oxen, ctx.view, ctx.pageSlug)) ?? "";
  const wireframePart = wireframe
    ? `\n\nCurrent wireframe on page "${ctx.pageSlug}" (copy is injected into the data-element slots at render time):\n\n${truncate(wireframe, WIREFRAME_CONTEXT_LIMIT)}`
    : `\n\nThe page has no wireframe yet.`;

  return `Current copy on page "${ctx.pageSlug}":\n\n${parts.join("\n\n")}${wireframePart}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n<!-- …truncated -->`;
}
