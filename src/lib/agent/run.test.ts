import { beforeEach, describe, expect, it } from "vitest";

import { ensureDraftView, readDoc, readSectionVersion, writeDoc, writeSectionVersion, type DraftView } from "@/lib/content/store";
import { LlmClient } from "@/lib/llm/client";
import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import { runAgentTurn } from "./run";

const AUTHOR = { name: "greg", email: "greg@copydog.app" };
const REPO = "agent-x1";

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
      version: 1,
      sections: [
        {
          slug: "hero",
          title: "Hero",
          activeVersion: "original",
          versions: [{ slug: "original", label: "Original" }],
          wireframeSlot: null,
          pinned: false,
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
    expect(doc.sections[0]!.activeVersion).toBe("punchier");
    expect(doc.sections[0]!.versions.map((v) => v.label)).toEqual(["Original", "Punchier"]);
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

  it("plain replies pass through without mutation", async () => {
    const { llm } = scriptedLlm([
      { model: "m", choices: [{ message: { content: "Three angles: speed, trust, delight." } }] },
    ]);
    const turn = await runAgentTurn({ oxen, view, pageSlug: "home", llm }, [], "Brainstorm hero angles");
    expect(turn).toEqual({ reply: "Three angles: speed, trust, delight.", mutated: false });
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
});
