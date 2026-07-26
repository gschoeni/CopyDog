import { xxhash128 } from "hash-wasm";
import { beforeEach, describe, expect, it } from "vitest";

import { docSections } from "@/lib/content/doc";
import {
  ensureDraftView,
  readDoc,
  readSectionVersion,
  readWireframe,
  writeDoc,
  writeSectionVersion,
  writeWireframe,
  type DraftView,
} from "@/lib/content/store";
import { LlmClient } from "@/lib/llm/client";
import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import { createReferenceLibrary, saveUploadedReference } from "./references";
import { runAgentTurn } from "./run";

const AUTHOR = { name: "greg", email: "greg@copydog.app" };
const REPO = "agent-x1";
const CONVERSATION = "11111111-2222-3333-4444-555555555555";

/** One tool call, as the model would emit it. */
function toolCall(name: string, args: object, id = "call_1") {
  return {
    model: "m",
    choices: [{ message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
  };
}

function say(content: string) {
  return { model: "m", choices: [{ message: { content } }] };
}

/** A scripted LLM: emits queued responses, capturing what it was sent. */
function scriptedLlm(responses: object[]): { llm: LlmClient; requests: { messages: unknown[]; tools?: unknown[] }[] } {
  const requests: { messages: unknown[]; tools?: unknown[] }[] = [];
  const queue = [...responses];
  const llm = new LlmClient({
    apiKey: "test",
    fetchImpl: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as { messages: unknown[]; tools?: unknown[] });
      return Response.json(queue.shift() ?? { model: "m", choices: [{ message: { content: "done" } }] });
    },
  });
  return { llm, requests };
}

describe("runAgentTurn", () => {
  let oxen: OxenClient;
  let view: DraftView;

  beforeEach(async () => {
    const stub = new OxenStub();
    oxen = new OxenClient({ token: "t", namespace: "ns", baseUrl: "https://stub.oxen.local", fetchImpl: stub.fetch });
    await provisionProjectRepo(oxen, { repoName: REPO, author: AUTHOR });
    view = await ensureDraftView(oxen, REPO, "greg");
    await writeSectionVersion(oxen, view, "home", "hero", "original", "# Old headline\n");
    await writeDoc(oxen, view, "home", {
      version: 2,
      content: [
        {
          kind: "section",
          slug: "hero",
          title: "Hero",
          activeVersion: "original",
          versions: [{ slug: "original", label: "Original" }],
          linked: true,
        },
      ],
    });
  });

  it("executes a rewrite tool call and reports mutation", async () => {
    const { llm, requests } = scriptedLlm([
      {
        model: "m",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "rewrite_section",
                    arguments: JSON.stringify({ sectionSlug: "hero", label: "Punchier", markdown: "# Ship it today\n" }),
                  },
                },
              ],
            },
          },
        ],
      },
      { model: "m", choices: [{ message: { content: "Rewrote the hero — sharper verb, faster promise." } }] },
    ]);

    const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "Punch up the hero");

    expect(turn.mutated).toBe(true);
    expect(turn.reply).toContain("sharper verb");

    // the new version exists and is active in the draft
    const doc = await readDoc(oxen, view, "home");
    const section = docSections(doc)[0]!;
    expect(section.activeVersion).toBe("punchier");
    expect(section.versions.map((v) => v.label)).toEqual(["Original", "Punchier"]);
    expect(await readSectionVersion(oxen, view, "home", "hero", "punchier")).toBe("# Ship it today\n");
    // original untouched
    expect(await readSectionVersion(oxen, view, "home", "hero", "original")).toBe("# Old headline\n");

    // the model saw the page context and the tool results
    const firstRequest = requests[0]!;
    expect(JSON.stringify(firstRequest.messages)).toContain("Old headline");
    expect(firstRequest.tools).toBeDefined();
    const secondRequest = requests[1]!;
    expect(JSON.stringify(secondRequest.messages)).toContain("Created version");
  });

  it("returns a structured choice interaction without mutating", async () => {
    const { llm, requests } = scriptedLlm([
      {
        model: "m",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_choice",
                  type: "function",
                  function: {
                    name: "ask_user_choice",
                    arguments: JSON.stringify({
                      question: "Which direction should I take?",
                      options: [
                        { label: "Merge them", description: "One focused split section." },
                        { label: "Keep them distinct", description: "Two complementary bands." },
                      ],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    ]);

    const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "What are my options?");

    expect(turn).toMatchObject({
      reply: "",
      mutated: false,
      interaction: {
        type: "choice",
        question: "Which direction should I take?",
        options: [
          { label: "Merge them", description: "One focused split section." },
          { label: "Keep them distinct", description: "Two complementary bands." },
        ],
      },
    });
    // a turn that ends on a question is still a turn worth tracing
    expect(turn.trace.rounds[0]!.toolCalls[0]!.name).toBe("ask_user_choice");
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0]!.tools)).toContain("ask_user_choice");
  });

  it("plain replies pass through without mutation", async () => {
    const { llm } = scriptedLlm([
      { model: "m", choices: [{ message: { content: "Three angles: speed, trust, delight." } }] },
    ]);
    const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "Brainstorm hero angles");
    expect(turn).toMatchObject({ reply: "Three angles: speed, trust, delight.", mutated: false });
  });

  it("design_section swaps one section's layout and leaves the rest alone", async () => {
    const original = `<header class="wf-navbar" aria-hidden="true"></header>
<section class="wf-section" data-copy="hero"><div class="wf-container wf-center"><h1 class="wf-h1" data-element="h1"></h1></div></section>
<footer class="wf-footer" aria-hidden="true"></footer>`;
    await writeWireframe(oxen, view, "home", original);

    const { llm, requests } = scriptedLlm([
      {
        model: "m",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "design_section",
                    arguments: JSON.stringify({ sectionSlug: "hero", instruction: "split, image on the left" }),
                  },
                },
              ],
            },
          },
        ],
      },
      // the section-layout request answers with the new fragment
      {
        model: "m",
        choices: [
          {
            message: {
              content: `<section class="wf-section" data-copy="hero"><div class="wf-container wf-split wf-split-reverse"><div class="wf-stack" data-overflow><h1 class="wf-h1" data-element="h1"></h1></div><div class="wf-media" aria-hidden="true"></div></div></section>`,
            },
          },
        ],
      },
      { model: "m", choices: [{ message: { content: "Hero is a split now, image left." } }] },
    ]);

    const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "image on the left of the hero");

    expect(turn.mutated).toBe(true);
    const wireframe = await readWireframe(oxen, view, "home");
    expect(wireframe).toContain("wf-split-reverse");
    expect(wireframe).toContain("wf-navbar"); // chrome untouched
    expect(wireframe?.match(/data-copy="hero"/g)).toHaveLength(1);

    // the agent saw the current wireframe in its context
    expect(JSON.stringify(requests[0]!.messages)).toContain("wf-navbar");
    // and the section designer saw the current section + instruction
    const layoutRequest = JSON.stringify(requests[1]!.messages);
    expect(layoutRequest).toContain("image on the left");
    expect(layoutRequest).toContain("wf-center");
  });

  it("redesign_page starts from the current wireframe", async () => {
    await writeWireframe(oxen, view, "home", `<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-element="h1"></h1></section>`);
    const { llm, requests } = scriptedLlm([
      {
        model: "m",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "redesign_page", arguments: JSON.stringify({ instruction: "add rhythm" }) },
                },
              ],
            },
          },
        ],
      },
      {
        model: "m",
        choices: [
          {
            message: {
              content: `<section class="wf-section wf-section-tint" data-copy="hero"><div class="wf-container wf-center" data-overflow><h1 class="wf-h1" data-element="h1"></h1></div></section>`,
            },
          },
        ],
      },
      { model: "m", choices: [{ message: { content: "Tinted the hero band." } }] },
    ]);

    const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "give the page more rhythm");

    expect(turn.mutated).toBe(true);
    expect(await readWireframe(oxen, view, "home")).toContain("wf-section-tint");
    // the page generator was shown the current wireframe as its starting point
    expect(JSON.stringify(requests[1]!.messages)).toContain("starting point");
  });

  it("survives a failing tool and still answers", async () => {
    const { llm } = scriptedLlm([
      {
        model: "m",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "rewrite_section", arguments: `{"sectionSlug":"nope","label":"X","markdown":"y"}` },
                },
              ],
            },
          },
        ],
      },
      { model: "m", choices: [{ message: { content: "That section doesn't exist — did you mean Hero?" } }] },
    ]);
    const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "rewrite the footer");
    expect(turn.mutated).toBe(false);
    expect(turn.reply).toContain("did you mean Hero");
  });

  describe("trace capture", () => {
    it("records the tool call, its arguments, and its result — the decision, not just the reply", async () => {
      const { llm } = scriptedLlm([
        toolCall("rewrite_section", { sectionSlug: "hero", label: "Punchier", markdown: "# Ship it\n" }),
        say("Rewrote the hero."),
      ]);
      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "punch it up");

      expect(turn.trace.rounds).toHaveLength(2);
      const call = turn.trace.rounds[0]!.toolCalls[0]!;
      expect(call.name).toBe("rewrite_section");
      // the arguments are what the reply can never tell you
      expect(JSON.parse(call.arguments)).toMatchObject({ sectionSlug: "hero", label: "Punchier" });
      expect(call.result).toContain("Created version");
      expect(call.mutated).toBe(true);
      expect(turn.trace.mutated).toBe(true);
    });

    it("keeps the system prompt and the page context it ran under", async () => {
      const { llm } = scriptedLlm([say("Three angles.")]);
      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "brainstorm");

      const system = turn.trace.messages.find((m) => m.role === "system")!;
      expect(String(system.content)).toContain("CopyDog's writing and layout assistant");
      // the page as it stood — a decision is only explicable against its input
      expect(String(system.content)).toContain("Old headline");
    });

    it("stores only this turn's messages, not history it would duplicate", async () => {
      const { llm } = scriptedLlm([say("Sure.")]);
      const history = [
        { role: "user" as const, content: "an earlier question" },
        { role: "assistant" as const, content: "an earlier answer" },
      ];
      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, history, "the new question");

      const asText = JSON.stringify(turn.trace.messages);
      expect(asText).toContain("the new question");
      expect(asText).not.toContain("an earlier question");
      expect(turn.trace.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    });

    it("names the model and reports what the turn cost", async () => {
      const withUsage = {
        model: "claude-sonnet-4-6",
        choices: [{ message: { content: "Done." } }],
        usage: { prompt_tokens: 1500, completion_tokens: 40, total_tokens: 1540 },
      };
      const { llm } = scriptedLlm([withUsage]);
      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "hi");

      expect(turn.trace.model).toBe("claude-sonnet-4-6");
      expect(turn.trace.rounds[0]!.usage).toEqual({ prompt_tokens: 1500, completion_tokens: 40, total_tokens: 1540 });
      expect(turn.trace.rounds[0]!.durationMs).toBeGreaterThanOrEqual(0);
      expect(turn.trace.toolsOffered).toContain("rewrite_section");
    });

    it("elides attached bytes rather than storing megabytes of base64", async () => {
      const { reference, references } = await (async () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const hash = (await xxhash128(bytes)).replace(/^0+/, "");
        await oxen.uploadVersionChunk(REPO, hash, 0, bytes);
        const saved = await saveUploadedReference(oxen, view, CONVERSATION, {
          hash,
          filename: "shot.png",
          mime: "image/png",
          byteSize: bytes.byteLength,
          numChunks: 1,
        });
        return { reference: saved, references: createReferenceLibrary(oxen, view, CONVERSATION) };
      })();
      const parts = await references.contentParts([reference]);

      const { llm } = scriptedLlm([say("Nice reference.")]);
      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm, references }, [], [
        ...parts,
        { type: "text", text: "build from this" },
      ]);

      const asText = JSON.stringify(turn.trace.messages);
      expect(asText).toContain("<elided");
      expect(asText).not.toContain("iVBORw");
      expect(asText).toContain("build from this");
    });
  });

  describe("streaming", () => {
    /**
     * The panel builds the live message by concatenating deltas, then swaps in
     * the saved reply when the turn lands. If those two disagree the user sees
     * text reflow for no reason — and, when a round's narration ran straight
     * into the next one's, sentences fused: "…every band clearly.I can see…".
     */
    async function streamsSameTextAsReply(responses: object[]) {
      const { llm } = scriptedLlm(responses);
      const streamed: string[] = [];
      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "punch up the hero", (event) => {
        if (event.type === "delta") streamed.push(event.text);
      });
      return { streamed: streamed.join(""), turn };
    }

    /** Narration *and* a tool call in one round — the shape that exposed the bug. */
    const narrateThenCall = (content: string) => ({
      model: "m",
      choices: [
        {
          message: {
            content,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "rewrite_section",
                  arguments: JSON.stringify({ sectionSlug: "hero", label: "Punchier", markdown: "# Ship it\n" }),
                },
              },
            ],
          },
        },
      ],
    });

    it("separates narration from consecutive rounds instead of fusing sentences", async () => {
      const { streamed, turn } = await streamsSameTextAsReply([
        narrateThenCall("Let me read the section first to capture every band clearly."),
        say("I can see all 7 bands clearly. Here's the rewrite."),
      ]);

      expect(streamed).toBe(turn.reply);
      expect(streamed).toContain("clearly.\n\nI can see");
      expect(streamed).not.toContain("clearly.I can see");
    });

    it("adds no separator before the first narration, or for a single round", async () => {
      const { streamed, turn } = await streamsSameTextAsReply([say("Three angles: speed, trust, delight.")]);
      expect(streamed).toBe(turn.reply);
      expect(streamed).toBe("Three angles: speed, trust, delight.");
    });

    it("adds no separator when an earlier round was pure tool call, with nothing said", async () => {
      const { streamed, turn } = await streamsSameTextAsReply([
        toolCall("rewrite_section", { sectionSlug: "hero", label: "Punchier", markdown: "# Ship it\n" }),
        say("Rewrote the hero."),
      ]);
      expect(streamed).toBe(turn.reply);
      expect(streamed).toBe("Rewrote the hero.");
    });

    it("holds across three rounds of narration", async () => {
      const { streamed, turn } = await streamsSameTextAsReply([
        narrateThenCall("First I'll look."),
        narrateThenCall("Now the rewrite."),
        say("Done — sharper promise."),
      ]);
      expect(streamed).toBe(turn.reply);
      expect(streamed).toBe("First I'll look.\n\nNow the rewrite.\n\nDone — sharper promise.");
    });
  });

  describe("reference material", () => {
    /** Attaches a screenshot to this conversation and hands back the tool context. */
    async function withReference() {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const hash = (await xxhash128(bytes)).replace(/^0+/, "");
      await oxen.uploadVersionChunk(REPO, hash, 0, bytes);
      const reference = await saveUploadedReference(oxen, view, CONVERSATION, {
        hash,
        filename: "competitor.png",
        mime: "image/png",
        byteSize: bytes.byteLength,
        numChunks: 1,
      });
      return {
        reference,
        dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        references: createReferenceLibrary(oxen, view, CONVERSATION),
      };
    }

    it("carries an attached image into the turn's user message", async () => {
      const { reference, dataUrl, references } = await withReference();
      const { llm, requests } = scriptedLlm([say("Nice reference — here's what I'd take from it.")]);

      await runAgentTurn({ oxen, view, pageSlug: "home", llm, references }, [], [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: "build the page from this" },
      ]);

      const userMessage = (requests[0]!.messages as { role: string; content: unknown }[]).at(-1)!;
      expect(userMessage.role).toBe("user");
      // media leads, prose follows — the ordering the API asks for
      expect(userMessage.content).toEqual([
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: "build the page from this" },
      ]);
    });

    it("read_reference puts the image back in front of the model", async () => {
      const { reference, dataUrl, references } = await withReference();
      const { llm, requests } = scriptedLlm([
        toolCall("read_reference", { referenceId: reference.id }),
        say("Checked it again — the pricing table is a 3-up."),
      ]);

      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm, references }, [], "look at it again");

      expect(turn.mutated).toBe(false);
      const followUp = (requests[1]!.messages as { role: string; content: unknown }[]).at(-1)!;
      expect(followUp.role).toBe("user");
      expect(followUp.content).toContainEqual({ type: "image_url", image_url: { url: dataUrl } });
    });

    it("tells the agent when a reference id no longer resolves", async () => {
      const { references } = await withReference();
      const { llm, requests } = scriptedLlm([
        toolCall("read_reference", { referenceId: "ref_gone" }),
        say("That one's gone — mind re-attaching it?"),
      ]);

      await runAgentTurn({ oxen, view, pageSlug: "home", llm, references }, [], "look at the deck");

      expect(JSON.stringify(requests[1]!.messages)).toContain("No reference with id");
    });

    it("design_section shows the reference to the designer, not just its description", async () => {
      const { reference, dataUrl, references } = await withReference();
      const { llm, requests } = scriptedLlm([
        toolCall("design_section", {
          sectionSlug: "hero",
          instruction: "match the reference's split hero",
          referenceIds: [reference.id],
        }),
        say(`<section class="wf-section" data-copy="hero"><div class="wf-container wf-split"><div class="wf-stack" data-overflow><h1 class="wf-h1" data-element="h1"></h1></div><div class="wf-media" aria-hidden="true"></div></div></section>`),
        say("Hero is a split now, matching the reference."),
      ]);

      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm, references }, [], "make it look like this");

      expect(turn.mutated).toBe(true);
      expect(await readWireframe(oxen, view, "home")).toContain("wf-split");
      // the designer's own request carried the pixels and the composition brief
      const designerMessages = requests[1]!.messages as { role: string; content: unknown }[];
      const designerPrompt = designerMessages.at(-1)!;
      expect(designerPrompt.content).toContainEqual({ type: "image_url", image_url: { url: dataUrl } });
      // …and the brief telling it to reproduce that reference, placeholders and all
      // (the wording itself is covered by wireframe/references.test.ts)
      const prompt = JSON.stringify(designerPrompt.content);
      expect(prompt).toContain("REFERENCE MATCHING");
      expect(prompt).toContain("wf-media");
    });

    it("designs anyway, and says so, when a named reference is missing", async () => {
      const { references } = await withReference();
      const { llm, requests } = scriptedLlm([
        toolCall("redesign_page", { instruction: "more rhythm", referenceIds: ["ref_gone"] }),
        say(`<section class="wf-section wf-section-tint" data-copy="hero"><div class="wf-container wf-center" data-overflow><h1 class="wf-h1" data-element="h1"></h1></div></section>`),
        say("Tinted the hero."),
      ]);

      const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm, references }, [], "give it rhythm");

      expect(turn.mutated).toBe(true);
      // the layout request has no image part — and the agent is told why
      expect(JSON.stringify(requests[1]!.messages)).not.toContain("image_url");
      expect(JSON.stringify(requests[2]!.messages)).toContain("no longer available");
    });

    it("degrades gracefully where there is no reference library at all (MCP)", async () => {
      const { llm, requests } = scriptedLlm([
        toolCall("read_reference", { referenceId: "ref_anything" }),
        say("I don't have that here."),
      ]);
      await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "read the reference");
      expect(JSON.stringify(requests[1]!.messages)).toContain("No reference with id");
    });
  });
});
