import { describe, expect, it } from "vitest";

import { parseChatMarkdown } from "./chat-markdown";

describe("parseChatMarkdown", () => {
  it("splits paragraphs on blank lines and keeps intra-paragraph breaks", () => {
    expect(parseChatMarkdown("First line\nsecond line\n\nNext paragraph")).toEqual([
      { kind: "p", text: "First line\nsecond line" },
      { kind: "p", text: "Next paragraph" },
    ]);
  });

  it("parses tight lists directly after a paragraph (no blank line)", () => {
    expect(parseChatMarkdown("**Current structure issues:**\n- No clear narrative\n- Dead weight")).toEqual([
      { kind: "p", text: "**Current structure issues:**" },
      { kind: "bullets", items: ["No clear narrative", "Dead weight"] },
    ]);
  });

  it("parses numbered lists with . or ) markers", () => {
    expect(parseChatMarkdown("1. Hero — instant clarity\n2) Problem — the pain")).toEqual([
      { kind: "numbered", items: ["Hero — instant clarity", "Problem — the pain"] },
    ]);
  });

  it("parses headings, rules, and quotes", () => {
    expect(parseChatMarkdown("## Plan\n---\n> ship it")).toEqual([
      { kind: "heading", level: 2, text: "Plan" },
      { kind: "hr" },
      { kind: "quote", text: "ship it" },
    ]);
  });

  it("keeps fenced code verbatim, unclosed fences included", () => {
    expect(parseChatMarkdown("```\n# not a heading\n- not a bullet\n```")).toEqual([
      { kind: "code", text: "# not a heading\n- not a bullet" },
    ]);
    expect(parseChatMarkdown("```\nstill open")).toEqual([{ kind: "code", text: "still open" }]);
  });

  it("treats * bullets as bullets but *** alone as a rule", () => {
    expect(parseChatMarkdown("* one\n* two\n***")).toEqual([
      { kind: "bullets", items: ["one", "two"] },
      { kind: "hr" },
    ]);
  });

  it("renders plain conversational replies as a single paragraph", () => {
    expect(parseChatMarkdown("Done — the second section now has exactly 2 image placeholders.")).toEqual([
      { kind: "p", text: "Done — the second section now has exactly 2 image placeholders." },
    ]);
  });
});
