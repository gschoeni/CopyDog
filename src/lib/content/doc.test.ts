import { describe, expect, it } from "vitest";

import { parseDocFile, serializeDocFile, type DocFile } from "./doc";

describe("doc file", () => {
  it("round-trips v2 content (element runs + sections)", () => {
    const doc: DocFile = {
      version: 2,
      content: [
        { kind: "elements", slug: "run-0" },
        {
          kind: "section",
          slug: "hero",
          title: "Hero",
          activeVersion: "punchy",
          versions: [
            { slug: "original", label: "Original" },
            { slug: "punchy", label: "Punchy" },
          ],
          linked: true,
        },
        { kind: "elements", slug: "run-1" },
        {
          kind: "section",
          slug: "spare",
          title: "Spare copy",
          activeVersion: "original",
          versions: [{ slug: "original", label: "Original" }],
          linked: false,
        },
      ],
    };
    expect(parseDocFile(serializeDocFile(doc))).toEqual(doc);
  });

  it("upgrades v1 docs to all-linked section content", () => {
    const legacy = JSON.stringify({
      version: 1,
      sections: [
        { slug: "hero", title: "Hero", activeVersion: "original", wireframeSlot: "hero", pinned: true },
      ],
    });
    const doc = parseDocFile(legacy);
    expect(doc).toEqual({
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
});
