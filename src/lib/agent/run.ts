import { readDoc, readElementsRun, readSectionVersion, readWireframe } from "@/lib/content/store";
import { type LlmContentPart, type LlmMessage } from "@/lib/llm/client";
import { modelFor } from "@/lib/llm/models";
import { outlineWireframe } from "@/lib/wireframe/outline";

import { AGENT_TOOLS, executeTool, toolActivityLabel, type ToolContext } from "./tools";
import type { ChatInteraction } from "./interactions";
import { TRACE_VERSION, toTraceMessage, type AgentTrace, type TraceRound } from "./trace";

/**
 * The agent loop: give the model the page's current copy + wireframe and
 * the tools, let it act (max a few rounds), and return what it said plus
 * whether it changed anything (so the UI can reload the draft).
 */

const MAX_ROUNDS = 8;

/** Between one round's narration and the next — a paragraph break, both live and saved. */
const PART_SEPARATOR = "\n\n";

/** Beyond this the wireframe context is cut — enough for any sane page. */
const WIREFRAME_CONTEXT_LIMIT = 20_000;

const SYSTEM_PROMPT = `You are CopyDog's writing and layout assistant — a seasoned copywriter and wireframe designer
who has worked at Apple, Notion, and Figma. You design clean greyscale wireframes and write copy that earns its place.

You act through tools; everything you change lands in the user's private draft, never the team's copy.

Designing wireframes:
- Section-scoped requests ("make the hero a split", "put the image on the left", "card grid for features")
  → design_section for that one section. It's the default move; it leaves the rest of the page alone.
- Page-scoped requests ("lay the page out", "more rhythm", "feels monotonous") → redesign_page.
- The wireframe outline below says what each section is today, in the design system's own words. Read it
  before deciding, describe layouts in those terms, and vary patterns between neighbouring sections.
- The layout vocabulary — use these names in instructions so the designer builds exactly that:
  centered hero (media below) · split, media right · split, media left · 2/3/4-column card grid ·
  logo strip · testimonial (quote + avatar byline) · stats row · FAQ rows · pricing cards ·
  email capture form · tinted CTA band · navigation bar / footer (only for nav-like copy).
  Media shapes: 16:10 by default, or wide (21:9), square, portrait.
- A vague section request ("make this better", "redesign this", "something different") with no direction
  → look at the section's copy shape and call ask_user_choice with 3 patterns that suit it (a quote wants a
  testimonial; repeated h3+p wants a card grid; h1+p+button wants a hero or a split). If the user said to
  just pick, pick — and say which pattern you chose and why.
- Write instructions that name every element of the section's copy ("eyebrow above the h2, the two
  paragraphs stacked, button row below, media on the right"), so nothing ends up without a slot.
- Every design tool keeps the layout it replaced: if the user dislikes a result, undo_layout restores it
  (and again redoes). Offer it when they hesitate, rather than piling on another redesign.
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

Working from reference material:
- The user can attach a screenshot, a PDF, or a link. Each one is listed with a reference id. ALWAYS pass those
  ids to design_section / redesign_page — that is the only way the designer sees the reference. Describing it
  in the instruction instead is not a substitute; a layout designed from a description does not match.
  read_reference is for when you need to re-examine one yourself.
- A reference on an EMPTY page means "build me this". Study it top to bottom first and count the bands — hero,
  logo strip, features, how-it-works, stats, testimonial, FAQ, CTA, whatever is actually there. Then add_section
  once per band, in the reference's own order, with real starter copy for each. Then ONE redesign_page carrying
  the reference ids. Deliver the whole first draft in one turn.
- The sections you create are what the layout can be built from, so a band you skip is a band the wireframe
  cannot have. Err toward one section per visible band.
- On a page that already has copy, never wipe it because a reference arrived. Say what you'd take from it and
  ask — or use ask_user_choice — before replacing anything.
- Take structure, rhythm, and composition from references. Write the copy yourself: their words are theirs.
  The exception is when the user says the reference is their own material and asks you to bring it across.

Keep replies short and concrete: say what you did and why it works. No filler.`;

export interface AgentTurn {
  reply: string;
  mutated: boolean;
  /** A first-class UI interaction requested by the agent; ends this turn. */
  interaction?: ChatInteraction;
  /** How the turn actually happened — persisted so it can be replayed and exported. */
  trace: AgentTrace;
}

/** Live progress from a running turn, for streaming UIs. */
export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "status"; label: string }
  | { type: "mutated" };

export async function runAgentTurn(
  ctx: ToolContext,
  history: { role: "user" | "assistant"; content: string }[],
  /** Plain prose, or prose preceded by attachment parts (images, documents). */
  userMessage: string | LlmContentPart[],
  onEvent?: (event: AgentEvent) => void,
): Promise<AgentTurn> {
  // the chat agent is only mounted when an LLM is configured — assert it so the
  // conversation loop below can rely on ctx.llm
  const llm = ctx.llm;
  if (!llm) throw new Error("runAgentTurn requires a configured LLM");
  const pageContext = await buildPageContext(ctx);
  const messages: LlmMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${pageContext}` },
    ...history.map((m): LlmMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let mutated = false;
  const replyParts: string[] = [];

  // The turn records itself as it goes. `messages` accumulates history the
  // earlier rows already hold, so the trace keeps only what this turn added —
  // from `traceFrom`, the index where its own messages begin.
  const traceFrom = messages.length - 1; // the user message opens this turn
  const startedAt = new Date();
  const model = modelFor("copy");
  const rounds: TraceRound[] = [];
  const buildTrace = (): AgentTrace => ({
    version: TRACE_VERSION,
    model,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    mutated,
    toolsOffered: AGENT_TOOLS.map((tool) => tool.function.name),
    rounds,
    messages: [messages[0]!, ...messages.slice(traceFrom)].map((message) =>
      toTraceMessage(message, (url) => ctx.references?.describeAttachment(url) ?? null),
    ),
  });

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roundStartedAt = Date.now();
    const options = { model, messages, tools: AGENT_TOOLS, maxTokens: 4000 };
    // Narration between tool calls streams too, so the turn reads as one reply.
    // Each round's narration is a finished paragraph, and the stream has to
    // carry the same separator the final reply gets — otherwise the panel
    // renders "…every band clearly.I can see…" mid-turn and then silently
    // reflows once the saved message replaces it. What streams must equal
    // what lands; `streamsSameTextAsReply` in run.test.ts holds us to it.
    let roundHasStreamed = false;
    const result = onEvent
      ? await llm.chatStream(options, (text) => {
          if (!roundHasStreamed && replyParts.length > 0) {
            onEvent({ type: "delta", text: PART_SEPARATOR });
          }
          roundHasStreamed = true;
          onEvent({ type: "delta", text });
        })
      : await llm.chat(options);

    if (result.content) replyParts.push(result.content);

    const roundRecord: TraceRound = {
      model: result.model || model,
      durationMs: Date.now() - roundStartedAt,
      usage: result.usage ?? null,
      content: result.content,
      reasoning: result.reasoning,
      toolCalls: [],
    };
    rounds.push(roundRecord);

    if (result.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: result.content });
      return { reply: replyParts.join(PART_SEPARATOR) || "Done.", mutated, trace: buildTrace() };
    }

    messages.push({ role: "assistant", content: result.content || null, tool_calls: result.toolCalls });
    // every tool result must follow its assistant message before anything else,
    // so attachments a tool pulled back into view are held until they're all in
    const attachments: LlmContentPart[] = [];
    for (const call of result.toolCalls) {
      onEvent?.({ type: "status", label: toolActivityLabel(call.function.name, call.function.arguments) });
      const callStartedAt = Date.now();
      let outcome;
      try {
        outcome = await executeTool(call.function.name, call.function.arguments, ctx);
      } catch (err) {
        outcome = { result: `Tool failed: ${err instanceof Error ? err.message : "unknown error"}`, mutated: false };
      }
      roundRecord.toolCalls.push({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        result: outcome.result,
        mutated: outcome.mutated,
        durationMs: Date.now() - callStartedAt,
      });
      if (outcome.interaction) {
        messages.push({ role: "tool", content: outcome.result, tool_call_id: call.id });
        return {
          reply: replyParts.join(PART_SEPARATOR),
          mutated,
          interaction: outcome.interaction,
          trace: buildTrace(),
        };
      }
      if (outcome.mutated) {
        mutated = true;
        onEvent?.({ type: "mutated" });
      }
      if (outcome.attach?.length) attachments.push(...outcome.attach);
      messages.push({ role: "tool", content: outcome.result, tool_call_id: call.id });
    }
    if (attachments.length > 0) {
      messages.push({
        role: "user",
        content: [...attachments, { type: "text", text: "(the reference material you asked to see)" }],
      });
    }
  }

  // ran out of rounds before the model produced a closing message
  const fallback = mutated
    ? "I made the changes — take a look."
    : "I couldn't finish that — try rephrasing or breaking it into smaller steps.";
  return { reply: replyParts.concat(fallback).join(PART_SEPARATOR), mutated, trace: buildTrace() };
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
  const outline = wireframe
    ? outlineWireframe(
        wireframe,
        doc.content.flatMap((entry) => (entry.kind === "section" ? [{ slug: entry.slug, title: entry.title }] : [])),
      )
    : "";
  const wireframePart = wireframe
    ? `\n\nWireframe outline for page "${ctx.pageSlug}" — one line per section, in page order:\n${outline}` +
      `\n\nThe wireframe HTML (copy is injected into the data-element slots at render time):\n\n${truncate(wireframe, WIREFRAME_CONTEXT_LIMIT)}`
    : `\n\nThe page has no wireframe yet.`;

  return `Current copy on page "${ctx.pageSlug}":\n\n${parts.join("\n\n")}${wireframePart}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n<!-- …truncated -->`;
}
