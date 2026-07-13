import { describe, expect, it } from "vitest";

import { parseDocFile, serializeDocFile, type DocFile } from "./doc";

describe("doc file", () => {
  it("round-trips a doc with versions", () => {
    const doc: DocFile = {
      version: 1,
      sections: [
        {
          slug: "hero",
          title: "Hero",
          activeVersion: "punchy",
          versions: [
            { slug: "original", label: "Original" },
            { slug: "punchy", label: "Punchy" },
          ],
          wireframeSlot: "hero-slot",
          pinned: false,
        },
      ],
    };
    expect(parseDocFile(serializeDocFile(doc))).toEqual(doc);
  });

  it("backfills versions and pinned for docs written before those fields", () => {
    const legacy = JSON.stringify({
      version: 1,
      sections: [{ slug: "hero", title: "Hero", activeVersion: "original", wireframeSlot: null }],
    });
    const doc = parseDocFile(legacy);
    expect(doc.sections[0]!.versions).toEqual([{ slug: "original", label: "Original" }]);
    expect(doc.sections[0]!.pinned).toBe(false);
  });
});
