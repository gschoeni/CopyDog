import type { NextRequest } from "next/server";
import { z } from "zod";

import { ContentStoreUnavailableError, requireProjectAccess } from "@/lib/content/access";

/**
 * One chunk of a reference upload, on its way to Oxen's version store.
 *
 * A route handler's request body caps at 4.5 MB, so a 20 MB PDF can't arrive
 * in one piece. Oxen's own large-file protocol solves this and we simply
 * forward to it: the browser hashes the file (XXH3-128), slices it, and PUTs
 * each slice here with its byte offset; Oxen reassembles on `complete` (see
 * the attach route) and verifies the bytes against that hash. This handler is
 * therefore stateless — it holds no partial uploads and remembers nothing
 * between chunks.
 *
 * Writing to the version store requires a write seat on the project, the same
 * as any other edit. The content-addressed id means a chunk can only ever
 * land under the hash of its own bytes.
 */

const query = z.object({
  hash: z.string().regex(/^[0-9a-f]{1,32}$/),
  offset: z.coerce.number().int().nonnegative(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  let access;
  try {
    access = await requireProjectAccess(projectId, { write: true });
  } catch (err) {
    if (err instanceof ContentStoreUnavailableError) {
      return Response.json({ error: "The content store is unreachable — is the Oxen server running?" }, { status: 503 });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Invalid chunk request" }, { status: 400 });
  }
  const { hash, offset } = parsed.data;

  const chunk = new Uint8Array(await request.arrayBuffer());
  if (chunk.byteLength === 0) {
    return Response.json({ error: "Empty chunk" }, { status: 400 });
  }

  try {
    await access.oxen.uploadVersionChunk(access.view.repo, hash, offset, chunk);
  } catch (err) {
    console.error("reference chunk upload failed", err);
    return Response.json({ error: "Upload failed — please try again." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
