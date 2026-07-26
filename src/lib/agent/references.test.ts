import { xxhash128 } from "hash-wasm";
import { beforeEach, describe, expect, it } from "vitest";

import { referenceBlobPath, referencePath } from "@/lib/content/site";
import {
  ensureDraftView,
  hasUnpublishedChanges,
  publishDraft,
  writeSectionVersion,
  type DraftView,
} from "@/lib/content/store";
import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import {
  assertUploadable,
  createReferenceLibrary,
  ReferenceAttachError,
  referenceDescriptor,
  saveUploadedReference,
  saveUrlReference,
  type StoredReference,
} from "./references";

const AUTHOR = { name: "greg", email: "greg@copydog.app" };
const CONVERSATION = "11111111-2222-3333-4444-555555555555";
const REPO = "refs-x1";

/** Oxen's version id: XXH3-128, Rust `{:x}` formatting. */
const versionId = async (bytes: Uint8Array) => (await xxhash128(bytes)).replace(/^0+/, "");

describe("assertUploadable", () => {
  it("accepts images and pdfs, ignoring charset noise", () => {
    expect(assertUploadable({ mime: "image/png", byteSize: 10 })).toEqual({ media: "image" });
    expect(assertUploadable({ mime: "application/pdf; charset=binary", byteSize: 10 })).toEqual({ media: "pdf" });
  });

  it.each([
    ["an unsupported type", { mime: "text/plain", byteSize: 10 }],
    ["an empty file", { mime: "image/png", byteSize: 0 }],
    ["an image past its ceiling", { mime: "image/png", byteSize: 11_000_000 }],
    ["a pdf past its ceiling", { mime: "application/pdf", byteSize: 25_000_000 }],
  ])("rejects %s", (_case, upload) => {
    expect(() => assertUploadable(upload)).toThrow(ReferenceAttachError);
  });

  it("lets a pdf be far larger than an image — the model's limits, not ours", () => {
    expect(() => assertUploadable({ mime: "application/pdf", byteSize: 20_000_000 })).not.toThrow();
    expect(() => assertUploadable({ mime: "image/png", byteSize: 20_000_000 })).toThrow();
  });
});

describe("references in the draft workspace", () => {
  let stub: OxenStub;
  let oxen: OxenClient;
  let view: DraftView;

  beforeEach(async () => {
    stub = new OxenStub();
    oxen = new OxenClient({ token: "t", namespace: "ns", baseUrl: "https://stub.oxen.local", fetchImpl: stub.fetch });
    await provisionProjectRepo(oxen, { repoName: REPO, author: AUTHOR });
    view = await ensureDraftView(oxen, REPO, "greg");
  });

  /** Uploads bytes the way the browser does: hash, chunk, then finalize. */
  async function uploadInChunks(
    bytes: Uint8Array,
    options: { filename: string; mime: string; chunkSize?: number },
  ): Promise<StoredReference> {
    const chunkSize = options.chunkSize ?? 1_000_000;
    const hash = await versionId(bytes);
    let numChunks = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      await oxen.uploadVersionChunk(REPO, hash, offset, bytes.subarray(offset, offset + chunkSize));
      numChunks++;
    }
    return saveUploadedReference(oxen, view, CONVERSATION, {
      hash,
      filename: options.filename,
      mime: options.mime,
      byteSize: bytes.byteLength,
      numChunks,
    });
  }

  /** Bigger than one chunk, and not compressible into a coincidence. */
  const bigPdf = () => {
    const bytes = new Uint8Array(2_500_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 13) % 251;
    return bytes;
  };

  it("assembles a multi-chunk upload into one staged file, byte for byte", async () => {
    const bytes = bigPdf();
    const reference = await uploadInChunks(bytes, { filename: "brand deck.pdf", mime: "application/pdf" });

    expect(reference).toMatchObject({ version: 2, media: "pdf", label: "brand deck.pdf", byteSize: 2_500_000 });
    expect(reference.blobPath).toBe(referenceBlobPath(CONVERSATION, reference.id, "brand-deck.pdf"));

    const stored = await oxen.readWorkspaceFileBytes(REPO, view.workspaceId, reference.blobPath!);
    expect(stored.byteLength).toBe(bytes.byteLength);
    expect(Buffer.from(stored).equals(Buffer.from(bytes))).toBe(true);
  });

  it("size is bounded by the model, not by one request — 20 MB arrives fine", async () => {
    const bytes = new Uint8Array(20_000_000);
    for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i % 251;
    const reference = await uploadInChunks(bytes, {
      filename: "huge.pdf",
      mime: "application/pdf",
      chunkSize: 3_500_000,
    });
    expect(reference.byteSize).toBe(20_000_000);
    const stored = await oxen.readWorkspaceFileBytes(REPO, view.workspaceId, reference.blobPath!);
    expect(stored.byteLength).toBe(20_000_000);
  });

  it("refuses an upload whose bytes don't match the hash it claimed", async () => {
    const bytes = bigPdf();
    const wrongHash = await versionId(new Uint8Array([1, 2, 3]));
    await oxen.uploadVersionChunk(REPO, wrongHash, 0, bytes);
    await expect(
      saveUploadedReference(oxen, view, CONVERSATION, {
        hash: wrongHash,
        filename: "tampered.pdf",
        mime: "application/pdf",
        byteSize: bytes.byteLength,
        numChunks: 1,
      }),
    ).rejects.toThrow(ReferenceAttachError);
  });

  it("refuses an upload that lost a chunk", async () => {
    const bytes = bigPdf();
    const hash = await versionId(bytes);
    await oxen.uploadVersionChunk(REPO, hash, 0, bytes.subarray(0, 1_000_000));
    // second chunk never arrives, but the client claims two
    await expect(
      saveUploadedReference(oxen, view, CONVERSATION, {
        hash,
        filename: "truncated.pdf",
        mime: "application/pdf",
        byteSize: bytes.byteLength,
        numChunks: 2,
      }),
    ).rejects.toThrow(ReferenceAttachError);
  });

  it("keeps a directory-traversal filename out of the path", async () => {
    const reference = await uploadInChunks(new Uint8Array([1, 2, 3]), {
      filename: "../../etc/passwd.png",
      mime: "image/png",
    });
    expect(reference.label).toBe("passwd.png");
    expect(reference.blobPath).toBe(referenceBlobPath(CONVERSATION, reference.id, "passwd.png"));
    expect(reference.blobPath).not.toContain("..");
  });

  describe("from a URL", () => {
    const serving = (body: BodyInit, contentType: string): typeof fetch =>
      async () => new Response(body, { status: 200, headers: { "Content-Type": contentType } });

    it("extracts a page's copy into a text reference with no blob", async () => {
      const html = `<main>
        <section><h1>Ship faster</h1><p>Docs that keep up with the code.</p></section>
        <section><h2>Why teams switch</h2><p>Because reviews stop being a bottleneck.</p></section>
      </main>`;
      const reference = await saveUrlReference(oxen, view, CONVERSATION, "https://www.example.com/pricing", {
        fetchImpl: serving(html, "text/html"),
      });
      expect(reference).toMatchObject({ media: "text", label: "example.com", blobPath: null });
      expect(reference.sourceUrl).toBe("https://www.example.com/pricing");
      expect(reference.text).toContain("Ship faster");
      expect(reference.text).toContain("Why teams switch");
    });

    it("stores a direct image url as a blob, no chunking needed", async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
      const reference = await saveUrlReference(oxen, view, CONVERSATION, "https://example.com/img/hero.png", {
        fetchImpl: serving(png, "image/png"),
      });
      expect(reference).toMatchObject({ media: "image", label: "hero.png" });
      const stored = await oxen.readWorkspaceFileBytes(REPO, view.workspaceId, reference.blobPath!);
      expect(Buffer.from(stored).equals(Buffer.from(png))).toBe(true);
    });

    it("surfaces fetch failures and empty pages as attach errors", async () => {
      await expect(
        saveUrlReference(oxen, view, CONVERSATION, "https://example.com/d.json", {
          fetchImpl: serving("{}", "application/json"),
        }),
      ).rejects.toThrow(ReferenceAttachError);
      await expect(
        saveUrlReference(oxen, view, CONVERSATION, "https://example.com/blank", {
          fetchImpl: serving("<main></main>", "text/html"),
        }),
      ).rejects.toThrow("No copy found");
    });
  });

  describe("reading for the model", () => {
    it("renders images, documents, and page copy — media before text", async () => {
      const image = await uploadInChunks(new Uint8Array([1, 2, 3]), { filename: "hero.png", mime: "image/png" });
      const pdf = await uploadInChunks(new Uint8Array([4, 5, 6]), { filename: "deck.pdf", mime: "application/pdf" });
      const page = await saveUrlReference(oxen, view, CONVERSATION, "https://example.com/x", {
        fetchImpl: async () =>
          new Response("<main><section><h1>Payments</h1><p>Body copy here.</p></section></main>", {
            headers: { "Content-Type": "text/html" },
          }),
      });

      const library = createReferenceLibrary(oxen, view, CONVERSATION);
      const parts = await library.contentParts([page, image, pdf]);

      expect(parts.map((part) => part.type)).toEqual(["image_url", "file", "text"]);
      expect(parts[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } });
      expect(parts[1]).toEqual({
        type: "file",
        file: { filename: "deck.pdf", file_data: "data:application/pdf;base64,BAUG" },
      });
      expect(JSON.stringify(parts[2])).toContain("Payments");
    });

    it("round-trips through the library and scopes to the conversation", async () => {
      const saved = await uploadInChunks(new Uint8Array([9]), { filename: "a.png", mime: "image/png" });
      const library = createReferenceLibrary(oxen, view, CONVERSATION);
      expect(await library.load(saved.id)).toEqual(saved);
      expect(await library.load("ref_nope")).toBeNull();
      expect(await library.loadMany([saved.id, "ref_nope"])).toEqual([saved]);

      const other = createReferenceLibrary(oxen, view, "99999999-2222-3333-4444-555555555555");
      expect(await other.load(saved.id)).toBeNull();
    });

    it("skips a reference whose bytes have gone missing rather than failing the turn", async () => {
      const saved = await uploadInChunks(new Uint8Array([9]), { filename: "a.png", mime: "image/png" });
      await oxen.deleteWorkspaceFiles(REPO, view.workspaceId, [saved.blobPath!]);
      const parts = await createReferenceLibrary(oxen, view, CONVERSATION).contentParts([saved]);
      expect(parts).toEqual([]);
    });

    it("makes a descriptor the client can hold without the payload", async () => {
      const saved = await uploadInChunks(new Uint8Array([9]), { filename: "a.png", mime: "image/png" });
      expect(referenceDescriptor(saved)).toEqual({
        kind: "reference",
        id: saved.id,
        media: "image",
        label: "a.png",
        sourceUrl: null,
      });
    });
  });

  describe("staying out of the publish path", () => {
    it("does not count as an unpublished change", async () => {
      await uploadInChunks(bigPdf(), { filename: "deck.pdf", mime: "application/pdf" });
      expect(await hasUnpublishedChanges(oxen, view)).toBe(false);

      await writeSectionVersion(oxen, view, "home", "hero", "original", "# Real edit\n");
      expect(await hasUnpublishedChanges(oxen, view)).toBe(true);
    });

    it("is pruned by publish — manifest and blob both", async () => {
      const saved = await uploadInChunks(bigPdf(), { filename: "deck.pdf", mime: "application/pdf" });
      await writeSectionVersion(oxen, view, "home", "hero", "original", "# Real edit\n");
      await publishDraft(oxen, view, { message: "publish", author: AUTHOR });

      expect(stub.fileAt(REPO, view.branch, "pages/home/sections/hero/original.md")).toContain("Real edit");
      expect(stub.fileAt(REPO, view.branch, referencePath(CONVERSATION, saved.id))).toBeUndefined();
      expect(stub.bytesAt(REPO, view.branch, saved.blobPath!)).toBeUndefined();
      expect(await createReferenceLibrary(oxen, view, CONVERSATION).load(saved.id)).toBeNull();
    });
  });
});
