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
        },
      ],
    };
    expect(parseDocFile(serializeDocFile(doc))).toEqual(doc);
  });

  it("backfills a versions list for docs written before versioning", () => {
    const legacy = JSON.stringify({
      version: 1,
      sections: [{ slug: "hero", title: "Hero", activeVersion: "original", wireframeSlot: null }],
    });
    const doc = parseDocFile(legacy);
    expect(doc.sections[0]!.versions).toEqual([{ slug: "original", label: "Original" }]);
  });
});
