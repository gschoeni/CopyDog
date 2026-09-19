import { createServer } from "node:http";

import { OxenStub } from "../../src/lib/oxen/stub";

/**
 * Serves the in-memory Oxen stub over HTTP so e2e tests can exercise the
 * full app loop (provision → autosave → publish) with no external Oxen.
 * State lives for the lifetime of the process — one Playwright run.
 */

const PORT = Number(process.env.OXEN_STUB_PORT ?? 3232);
const stub = new OxenStub();

/** Static fixture for URL-import e2e — a small landing page. */
const LANDING_FIXTURE = `<!DOCTYPE html>
<html><head><title>Fixture Landing</title></head>
<body>
  <main>
    <section>
      <p class="eyebrow">FIXTURE</p>
      <h1>Imported headline</h1>
      <p>This copy came from a real HTTP fetch during e2e.</p>
      <a class="btn" href="/go">Try it now</a>
    </section>
    <section>
      <h2>Details</h2>
      <ul><li>Point one</li><li>Point two</li></ul>
    </section>
  </main>
</body></html>`;

const server = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`{"ok":true}`);
    return;
  }
  if (req.url === "/fixtures/landing.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(LANDING_FIXTURE);
    return;
  }

  // Scripted chat-completions endpoint so agent e2e runs offline. Scenarios:
  //  - a section-layout request ("Design ONE wireframe section") answers with
  //    a split-layout fragment for the requested slug
  //  - a "Redesign the …" message with a section attached (the pane's pattern
  //    chips) designs that section; "undo" restores the previous layout
  //  - a user message mentioning layout ("split"/"design"/"layout") triggers a
  //    design_section tool call; anything else triggers rewrite_section
  //  - after tool results, a closing text reply
  // Streams SSE when the client asks for it (the real client always does).
  if (req.url === "/chat/completions" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      stream?: boolean;
      messages: { role: string; content?: unknown; tool_calls?: { function?: { name?: string } }[] }[];
    };
    const hadToolResult = body.messages.some((m) => m.role === "tool");
    const calledTools = body.messages.flatMap((m) => (m.tool_calls ?? []).map((c) => c.function?.name));
    const context = JSON.stringify(body.messages);
    const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
    // a message is either prose or attachment parts followed by prose — read
    // the text out of both shapes, and note which media actually came along
    const parts = (Array.isArray(lastUser?.content) ? lastUser.content : []) as {
      type: string;
      text?: string;
    }[];
    const lastUserText =
      typeof lastUser?.content === "string"
        ? lastUser.content
        : parts.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : [])).join("\n");
    const lastUserMedia = parts.map((part) => part.type);
    const slugMatch = context.match(/slug: ([a-z0-9-]+)/);
    const slug = slugMatch?.[1] ?? "hero";

    // the section designer's request names its target; a correction round
    // ("That layout was rejected: …") refers back to it
    const designRequest = body.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .find((text) => text.includes("Design ONE wireframe section"));
    const splitFor = (target: string) =>
      `<section class="wf-section" data-copy="${target}"><div class="wf-container wf-split-reverse wf-split"><div class="wf-stack" data-overflow><h1 class="wf-h1" data-element="h1"></h1><p class="wf-p" data-element="p"></p></div><div class="wf-media" aria-hidden="true"></div></div></section>`;

    let message: { content: string | null; tool_calls?: unknown[] };
    if (lastUserText.includes("Design ONE wireframe section") || (designRequest && /^That layout was rejected/.test(lastUserText))) {
      const target = (designRequest ?? lastUserText).match(/data-copy="([a-z0-9-]+)"/)?.[1] ?? slug;
      message = { content: splitFor(target) };
    } else if (/critique the structure/i.test(lastUserText)) {
      // markdown-rich reply for the chat renderer test
      message = {
        content: [
          "Here's my read on the page:",
          "",
          "---",
          "",
          "**Current structure issues:**",
          "- No clear narrative",
          "- Dead weight sections",
          "",
          "**Recommended arc:**",
          "1. **Hero** — instant clarity",
          "2. **Problem** — the pain",
          "",
          "Ship `copy` that earns its place. (stub)",
        ].join("\n"),
      };
    } else if (lastUserText.includes("attached reference material")) {
      // echo the reference back so tests can prove it reached the model, and
      // whether it arrived as real pixels rather than only as a description
      const label = lastUserText.match(/\d+\. "([^"]+)"/)?.[1] ?? "unknown";
      const media = lastUserMedia.includes("image_url") ? " (image)" : lastUserMedia.includes("file") ? " (pdf)" : "";
      message = { content: `Reference received: ${label}${media} (stub)` };
    } else if (!hadToolResult && lastUserText.includes("The user attached page context") && /^Redesign the "/m.test(lastUserText)) {
      // a "Redesign…" pattern chip: design the attached section
      const attached = lastUserText.match(/\(slug: ([a-z0-9-]+)\)/)?.[1] ?? slug;
      message = {
        content: null,
        tool_calls: [
          {
            id: "call_stub_design_attached",
            type: "function",
            function: {
              name: "design_section",
              arguments: JSON.stringify({ sectionSlug: attached, instruction: "split, media left" }),
            },
          },
        ],
      };
    } else if (/undo|go back|previous layout/i.test(lastUserText) && !hadToolResult) {
      message = {
        content: null,
        tool_calls: [{ id: "call_stub_undo", type: "function", function: { name: "undo_layout", arguments: "{}" } }],
      };
    } else if (!hadToolResult && lastUserText.includes("The user attached page context")) {
      // echo the attachment back so tests can prove the agent saw it
      const quoted = lastUserText.match(/"""\n([\s\S]*?)\n"""/)?.[1];
      const wholeSection = lastUserText.match(/The whole "([^"]+)" section/)?.[1];
      message = { content: `Context received: ${quoted ?? wholeSection ?? "unknown"} (stub)` };
    } else if (/show me choices|give me options/i.test(lastUserText)) {
      message = {
        content: null,
        tool_calls: [
          {
            id: "call_stub_choice",
            type: "function",
            function: {
              name: "ask_user_choice",
              arguments: JSON.stringify({
                question: "Which layout direction should I take?",
                options: [
                  { label: "Merge the sections", description: "Combine them into one focused split section." },
                  { label: "Keep them distinct", description: "Keep both bands and place them side by side." },
                ],
              }),
            },
          },
        ],
      };
    } else if (/I choose/i.test(lastUserText)) {
      message = { content: "Done — I’ll use that direction for the next revision. (stub)" };
    } else if (hadToolResult) {
      const wasDesign = calledTools.includes("design_section");
      const wasUndo = calledTools.includes("undo_layout");
      message = {
        content: wasUndo
          ? "Restored the earlier layout. (stub)"
          : wasDesign
            ? "Done — the section is a split with media beside the copy. (stub)"
            : "Done — I rewrote it with a stronger promise. (stub)",
      };
    } else if (/split|design|layout/i.test(lastUserText)) {
      message = {
        content: null,
        tool_calls: [
          {
            id: "call_stub_design",
            type: "function",
            function: {
              name: "design_section",
              arguments: JSON.stringify({ sectionSlug: slug, instruction: "make it a split with media beside the copy" }),
            },
          },
        ],
      };
    } else {
      message = {
        content: null,
        tool_calls: [
          {
            id: "call_stub_1",
            type: "function",
            function: {
              name: "rewrite_section",
              arguments: JSON.stringify({
                sectionSlug: slug,
                label: "Agent take",
                markdown: "# Rewritten by the assistant\n\nStub copy that proves the loop.\n",
              }),
            },
          },
        ],
      };
    }

    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (message.content) {
        // two chunks so the client's incremental assembly is exercised
        const mid = Math.ceil(message.content.length / 2);
        res.write(`data: ${JSON.stringify({ model: "stub-model", choices: [{ delta: { content: message.content.slice(0, mid) } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: message.content.slice(mid) } }] })}\n\n`);
      }
      for (const call of message.tool_calls ?? []) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...(call as object) }] } }] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ model: "stub-model", choices: [{ message }] }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((item) => [k, item] as [string, string]) : [[k, v] as [string, string]],
    ),
    body: body.length > 0 ? body : undefined,
  });

  const response = await stub.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, () => {
  console.log(`oxen stub listening on :${PORT}`);
});
