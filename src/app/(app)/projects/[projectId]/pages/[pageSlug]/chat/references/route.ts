import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  ReferenceAttachError,
  referenceDescriptor,
  resolveUploadedReference,
  resolveUrlReference,
  saveReference,
  uploadTooLargeMessage,
} from "@/lib/agent/references";
import { ContentStoreUnavailableError, requireProjectAccess } from "@/lib/content/access";

/**
 * Attaches one piece of reference material to a conversation — an uploaded
 * screenshot or PDF (multipart) or a URL (JSON). The bytes resolve here,
 * once, into the shape the model reads, and land in the user's draft
 * workspace under refs/; the browser gets back only a small descriptor to
 * put on the composer as a chip and to send with the next message.
 *
 * A route handler rather than a server action because uploads are megabytes
 * and server actions cap at 1 MB.
 */

const urlInput = z.object({ url: z.string().trim().min(1).max(2000) });

const conversationId = z.uuid();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; pageSlug: string }> },
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

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const { conversation, reference } = contentType.includes("multipart/form-data")
      ? await referenceFromUpload(request)
      : await referenceFromUrl(request);

    await saveReference(oxen, view, conversation, reference);
    return Response.json({ reference: referenceDescriptor(reference) });
  } catch (err) {
    if (err instanceof ReferenceAttachError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof z.ZodError) {
      return Response.json({ error: "That attachment isn't valid." }, { status: 400 });
    }
    console.error("reference attach failed", err);
    return Response.json({ error: "Couldn't attach that. Please try again." }, { status: 500 });
  }
}

async function referenceFromUpload(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Next rejects an over-limit body before we ever see the parts
    throw new ReferenceAttachError(uploadTooLargeMessage());
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ReferenceAttachError("No file was attached.");
  return {
    conversation: conversationId.parse(form.get("conversationId")),
    reference: resolveUploadedReference({
      filename: file.name,
      mime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }),
  };
}

async function referenceFromUrl(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as unknown;
  const { url } = urlInput.parse(body);
  const conversation = conversationId.parse((body as { conversationId?: unknown }).conversationId);
  return { conversation, reference: await resolveUrlReference(url) };
}
