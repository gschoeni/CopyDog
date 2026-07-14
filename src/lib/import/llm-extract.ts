import { z } from "zod";

import { elementSchema } from "@/lib/copy/elements";
import { LLM_MODELS, type LlmClient, type LlmMessage } from "@/lib/llm/client";

import type { ExtractedSection } from "./extract";

/**
 * LLM-powered copy extraction: better sectioning and copy judgment than the
 * deterministic extractor, and the only path for screenshots. Output is
 * zod-validated; callers fall back to the deterministic extractor on failure.
 */

const extractionSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        elements: z.array(elementSchema).min(1).max(40),
      }),
    )
    .min(1)
    .max(12),
});

const SYSTEM_PROMPT = `You extract website copy into structured sections for a copywriting tool.

Return ONLY a JSON object (no fences, no prose): {"sections":[{"title":"...","elements":[...]}]}
Each element is one of:
  {"type":"h1"|"h2"|"h3"|"h4"|"h5"|"h6","text":"..."}
  {"type":"p","text":"..."}
  {"type":"eyebrow","text":"..."}          (short overline above a heading)
  {"type":"button","label":"...","url":"..."}  (calls to action)
  {"type":"bullets","items":["...","..."]}\n  {"type":"numbered","items":["...","..."]}\n  {"type":"quote","text":"..."}          (pull quotes, testimonials)
Rules:
- Capture the page's real marketing copy in reading order; skip navigation, cookie banners, legal footers.
- Group elements into the page's natural sections (hero, features, testimonial, CTA…). Title each section briefly.
- Keep the author's words exactly; inline **bold** / *italic* markdown may be used where the source emphasizes.`;

export async function extractSectionsWithLlm(llm: LlmClient, html: string): Promise<ExtractedSection[]> {
  return runExtraction(llm, LLM_MODELS.copy, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Extract the copy from this page HTML:\n\n${truncate(html, 150_000)}` },
  ]);
}

export async function extractSectionsFromImage(llm: LlmClient, imageDataUrl: string): Promise<ExtractedSection[]> {
  return runExtraction(llm, LLM_MODELS.vision, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: "Extract the copy from this design/screenshot:" },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ]);
}

async function runExtraction(llm: LlmClient, model: string, messages: LlmMessage[]): Promise<ExtractedSection[]> {
  const result = await llm.chat({ model, messages, maxTokens: 8000, temperature: 0 });
  const raw = result.content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = extractionSchema.parse(JSON.parse(raw));
  return parsed.sections;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}
