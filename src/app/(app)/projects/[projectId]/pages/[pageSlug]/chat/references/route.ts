import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  ReferenceAttachError,
  referenceDescriptor,
  saveUploadedReference,
  saveUrlReference,
  uploadManifestSchema,
} from "@/lib/agent/references";
import { ContentStoreUnavailableError, requireProjectAccess } from "@/lib/content/access";

/**
 * Attaches one piece of reference material to a conversation, in either of
 * the two shapes it can arrive in:
 *
 *   {url}     — we fetch it server-side (SSRF-guarded) and store what we get
 *   {upload}  — the browser already streamed the bytes to Oxen in chunks
 *               (see ./upload); this finalizes them into a staged file
 *
 * Either way the bytes land in the user's draft workspace under refs/ and the
 * browser gets back only a small descriptor to put on the composer as a chip
 * and send with the next message. Nothing large crosses this handler.
 */

const attachInput = z.union([
  z.object({ conversationId: z.uuid(), url: z.string().trim().min(1).max(2000) }),
  z.object({ conversationId: z.uuid(), upload: uploadManifestSchema }),
]);

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
  const { oxen, view } = access;

  const parsed = attachInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "That attachment isn't valid." }, { status: 400 });
  }
  const input = parsed.data;

  try {
    const reference =
      "url" in input
        ? await saveUrlReference(oxen, view, input.conversationId, input.url)
        : await saveUploadedReference(oxen, view, input.conversationId, input.upload);
    return Response.json({ reference: referenceDescriptor(reference) });
  } catch (err) {
    if (err instanceof ReferenceAttachError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("reference attach failed", err);
    return Response.json({ error: "Couldn't attach that. Please try again." }, { status: 500 });
  }
}
