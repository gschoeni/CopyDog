import { beforeEach, describe, expect, it } from "vitest";

import { ensureDraftView, hasUnpublishedChanges, publishDraft, writeSectionVersion, type DraftView } from "@/lib/content/store";
import { referencePath } from "@/lib/content/site";
import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import {
  createReferenceLibrary,
  ReferenceAttachError,
  referenceContentParts,
  referenceDescriptor,
  resolveUploadedReference,
  resolveUrlReference,
  saveReference,
  type StoredReference,
} from "./references";

const AUTHOR = { name: "greg", email: "greg@copydog.app" };
const CONVERSATION = "11111111-2222-3333-4444-555555555555";

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);

describe("resolveUploadedReference", () => {
  it("turns an image into a data-url reference the model can read", () => {
    const reference = resolveUploadedReference({ filename: "hero shot.png", mime: "image/png", bytes: png() });
    expect(reference).toMatchObject({ media: "image", label: "hero shot.png", mime: "image/png", sourceUrl: null });
    expect(reference.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(reference.byteSize).toBe(5);
  });

  it("accepts a pdf and ignores charset noise on the mime type", () => {
    const reference = resolveUploadedReference({
      filename: "deck.pdf",
      mime: "application/pdf; charset=binary",
      bytes: new Uint8Array([1, 2]),
    });
    expect(reference.media).toBe("pdf");
    expect(reference.dataUrl).toMatch(/^data:application\/pdf;base64,/);
  });

  it("strips directory components out of a filename", () => {
    const reference = resolveUploadedReference({
      filename: "../../etc/passwd.png",
      mime: "image/png",
      bytes: png(),
    });
    expect(reference.label).toBe("passwd.png");
  });

  it.each([
    ["an unsupported type", { filename: "notes.txt", mime: "text/plain", bytes: png() }],
    ["an empty file", { filename: "empty.png", mime: "image/png", bytes: new Uint8Array() }],
    ["an oversized file", { filename: "huge.png", mime: "image/png", bytes: new Uint8Array(5_000_000) }],
  ])("rejects %s", (_case, upload) => {
    expect(() => resolveUploadedReference(upload)).toThrow(ReferenceAttachError);
  });
});

describe("resolveUrlReference", () => {
  const publicPage = (body: BodyInit, contentType: string): typeof fetch =>
    async () => new Response(body, { status: 200, headers: { "Content-Type": contentType } });

  it("extracts a page's copy into a text reference", async () => {
    const html = `<main>
      <section><h1>Ship faster</h1><p>Docs that keep up with the code.</p></section>
      <section><h2>Why teams switch</h2><p>Because reviews stop being a bottleneck.</p></section>
    </main>`;
    const reference = await resolveUrlReference("https://www.example.com/pricing", {
      fetchImpl: publicPage(html, "text/html"),
    });
    expect(reference.media).toBe("text");
    expect(reference.label).toBe("example.com");
    expect(reference.sourceUrl).toBe("https://www.example.com/pricing");
    expect(reference.text).toContain("Ship faster");
    expect(reference.text).toContain("Why teams switch");
    expect(reference.dataUrl).toBeNull();
  });

  it("takes a direct image url as pixels, named after the file", async () => {
    const reference = await resolveUrlReference("https://example.com/img/hero.png", {
      fetchImpl: publicPage(png(), "image/png"),
    });
    expect(reference).toMatchObject({ media: "image", label: "hero.png" });
    expect(reference.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("takes a direct pdf url as a document", async () => {
    const reference = await resolveUrlReference("https://example.com/brand.pdf", {
      fetchImpl: publicPage(new Uint8Array([1, 2, 3]), "application/pdf"),
    });
    expect(reference).toMatchObject({ media: "pdf", label: "brand.pdf" });
  });

  it("surfaces fetch failures as attach errors", async () => {
    await expect(
      resolveUrlReference("https://example.com/data.json", { fetchImpl: publicPage("{}", "application/json") }),
    ).rejects.toThrow(ReferenceAttachError);
  });

  it("refuses a page with no copy on it", async () => {
    await expect(
      resolveUrlReference("https://example.com/blank", { fetchImpl: publicPage("<main></main>", "text/html") }),
    ).rejects.toThrow("No copy found");
  });
});

describe("referenceContentParts", () => {
  const base = { version: 1 as const, byteSize: 1, sourceUrl: null };
  const image: StoredReference = {
    ...base,
    id: "ref_img",
    media: "image",
    label: "hero.png",
    mime: "image/png",
    dataUrl: "data:image/png;base64,AAAA",
    text: null,
  };
  const pdf: StoredReference = {
    ...base,
    id: "ref_pdf",
    media: "pdf",
    label: "brand.pdf",
    mime: "application/pdf",
    dataUrl: "data:application/pdf;base64,BBBB",
    text: null,
  };
  const page: StoredReference = {
    ...base,
    id: "ref_txt",
    media: "text",
    label: "stripe.com",
    mime: "text/html",
    dataUrl: null,
    text: "# Payments",
  };

  it("puts media ahead of text, as the API asks", () => {
    const parts = referenceContentParts([page, image, pdf]);
    expect(parts.map((part) => part.type)).toEqual(["image_url", "file", "text"]);
  });

  it("uses the documented shapes for images and documents", () => {
    expect(referenceContentParts([image])[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
    expect(referenceContentParts([pdf])[0]).toEqual({
      type: "file",
      file: { filename: "brand.pdf", file_data: "data:application/pdf;base64,BBBB" },
    });
  });

  it("is empty for nothing attached", () => {
    expect(referenceContentParts([])).toEqual([]);
  });

  it("makes a descriptor the client can hold without the payload", () => {
    expect(referenceDescriptor(image)).toEqual({
      kind: "reference",
      id: "ref_img",
      media: "image",
      label: "hero.png",
      sourceUrl: null,
    });
  });
});

describe("reference storage", () => {
  let stub: OxenStub;
  let oxen: OxenClient;
  let view: DraftView;
  const REPO = "refs-x1";

  beforeEach(async () => {
    stub = new OxenStub();
    oxen = new OxenClient({ token: "t", namespace: "ns", baseUrl: "https://stub.oxen.local", fetchImpl: stub.fetch });
    await provisionProjectRepo(oxen, { repoName: REPO, author: AUTHOR });
    view = await ensureDraftView(oxen, REPO, "greg");
  });

  const attach = async () => {
    const reference = resolveUploadedReference({ filename: "hero.png", mime: "image/png", bytes: png() });
    await saveReference(oxen, view, CONVERSATION, reference);
    return reference;
  };

  it("round-trips a reference through the draft workspace", async () => {
    const saved = await attach();
    const library = createReferenceLibrary(oxen, view, CONVERSATION);
    expect(await library.load(saved.id)).toEqual(saved);
  });

  it("returns null for ids it doesn't have, and drops them from loadMany", async () => {
    const saved = await attach();
    const library = createReferenceLibrary(oxen, view, CONVERSATION);
    expect(await library.load("ref_nope")).toBeNull();
    expect(await library.loadMany([saved.id, "ref_nope"])).toEqual([saved]);
  });

  it("scopes references to their conversation", async () => {
    const saved = await attach();
    const other = createReferenceLibrary(oxen, view, "99999999-2222-3333-4444-555555555555");
    expect(await other.load(saved.id)).toBeNull();
  });

  it("does not count as an unpublished change", async () => {
    await attach();
    expect(await hasUnpublishedChanges(oxen, view)).toBe(false);

    await writeSectionVersion(oxen, view, "home", "hero", "original", "# Real edit\n");
    expect(await hasUnpublishedChanges(oxen, view)).toBe(true);
  });

  it("is pruned by publish and never reaches the branch", async () => {
    const saved = await attach();
    await writeSectionVersion(oxen, view, "home", "hero", "original", "# Real edit\n");
    await publishDraft(oxen, view, { message: "publish", author: AUTHOR });

    expect(stub.fileAt(REPO, view.branch, "pages/home/sections/hero/original.md")).toContain("Real edit");
    expect(stub.fileAt(REPO, view.branch, referencePath(CONVERSATION, saved.id))).toBeUndefined();
    // and the reference is gone from the workspace too — re-attach after publishing
    expect(await createReferenceLibrary(oxen, view, CONVERSATION).load(saved.id)).toBeNull();
  });
});
