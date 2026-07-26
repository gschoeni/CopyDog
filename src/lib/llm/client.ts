/**
 * Thin wrapper over Oxen.ai's OpenAI-compatible chat completions API.
 * https://docs.oxen.ai/examples/inference/chat_completions
 *
 * Server-side only: the API key must never reach the browser.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

/**
 * A part of a multimodal message. Documents and images must come BEFORE text
 * parts — the provider is explicit about that ordering producing better
 * results. `file` carries PDFs: either inline base64 (`file_data`, a
 * `data:application/pdf;base64,…` URL) or a publicly fetchable `file_url`.
 * https://docs.oxen.ai/examples/inference/chat_completions#documents-pdfs
 */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename?: string; file_data?: string; file_url?: string } };

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentPart[] | null;
  /** assistant messages may carry tool calls */
  tool_calls?: LlmToolCall[];
  /** tool result messages reference the call they answer */
  tool_call_id?: string;
}

/**
 * Builds a user message body from optional attachments plus prose, keeping
 * images and documents ahead of the text as the API asks. With no
 * attachments it stays a plain string, so text-only callers are unchanged.
 */
export function userContent(parts: LlmContentPart[] | undefined, text: string): string | LlmContentPart[] {
  return parts?.length ? [...parts, { type: "text", text }] : text;
}

export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Whatever the provider reported about the call. Deliberately open: the
 * endpoint returns `cost`, `currency`, and `prompt_tokens_details.cached_tokens`
 * alongside the token counts, and a narrower type silently threw those away.
 */
export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: LlmToolCall[];
  model: string;
  usage?: LlmUsage;
  /**
   * The model's thinking, when the provider exposes it. Probed against Oxen's
   * endpoint on 2026-07-26 with `reasoning_effort`, `reasoning: {effort}`,
   * Anthropic's `thinking`, and `include_reasoning`: none produced a reasoning
   * field on the response, for either Claude or Gemini. So this is null today
   * — it is read here (under every name the ecosystem uses) so that the day
   * the endpoint surfaces it, traces capture it without a code change.
   */
  reasoning: string | null;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmClientConfig {
  /** Oxen.ai inference key (`OXEN_API_KEY`). */
  apiKey: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ChatOptions {
  model: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens?: number;
  temperature?: number;
}

export class LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LlmClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://hub.oxen.ai/api/ai").replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async chat(options: ChatOptions): Promise<ChatCompletionResult> {
    const res = await this.request(options, false);
    const data = (await res.json()) as CompletionPayload;
    return parseCompletion(data);
  }

  /**
   * Like chat(), but streams: `onDelta` fires per content token, and the
   * resolved result is the fully assembled message (content + tool calls).
   * Falls back transparently when the server answers with plain JSON —
   * some providers (and our e2e stub) ignore `stream: true`.
   */
  async chatStream(options: ChatOptions, onDelta: (text: string) => void): Promise<ChatCompletionResult> {
    const res = await this.request(options, true);
    if (!res.headers.get("content-type")?.includes("text/event-stream")) {
      const result = parseCompletion((await res.json()) as CompletionPayload);
      if (result.content) onDelta(result.content);
      return result;
    }
    if (!res.body) throw new LlmError("LLM stream had no body", 502);
    return consumeSse(res.body, onDelta);
  }

  private async request(options: ChatOptions, stream: boolean): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        tools: options.tools,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        ...(stream ? { stream: true } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LlmError(`LLM request failed: ${res.status}`, res.status, body);
    }
    return res;
  }
}

interface CompletionMessage {
  content: string | null;
  tool_calls?: LlmToolCall[];
  /** Whichever name this provider uses for thinking, if it exposes it at all. */
  reasoning_content?: string | null;
  reasoning?: string | null;
  thinking?: string | null;
}

interface CompletionPayload {
  model: string;
  choices: { message: CompletionMessage }[];
  usage?: LlmUsage;
}

/** Thinking arrives under one of three names depending on the provider. */
function readReasoning(message: {
  reasoning_content?: string | null;
  reasoning?: string | null;
  thinking?: string | null;
}): string | null {
  const value = message.reasoning_content ?? message.reasoning ?? message.thinking;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseCompletion(data: CompletionPayload): ChatCompletionResult {
  const message = data.choices[0]?.message;
  if (message === undefined) {
    throw new LlmError("LLM response contained no choices", 502, JSON.stringify(data));
  }
  return {
    content: message.content ?? "",
    toolCalls: message.tool_calls ?? [],
    model: data.model,
    usage: data.usage,
    reasoning: readReasoning(message),
  };
}

interface StreamChunk {
  model?: string;
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      thinking?: string | null;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: ChatCompletionResult["usage"];
}

/** Assembles an OpenAI-style SSE stream back into one completion. */
async function consumeSse(body: ReadableStream<Uint8Array>, onDelta: (text: string) => void): Promise<ChatCompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let content = "";
  let reasoning = "";
  let model = "";
  let usage: ChatCompletionResult["usage"];
  const toolCalls: LlmToolCall[] = [];
  let buffer = "";

  const handleChunk = (chunk: StreamChunk) => {
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      content += delta.content;
      onDelta(delta.content);
    }
    // thinking accumulates but never streams to the panel — it belongs in the
    // trace, not in the reply the user reads
    reasoning += readReasoning(delta) ?? "";
    for (const fragment of delta.tool_calls ?? []) {
      const index = fragment.index ?? toolCalls.length;
      const call = (toolCalls[index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (fragment.id) call.id = fragment.id;
      if (fragment.function?.name) call.function.name += fragment.function.name;
      if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          handleChunk(JSON.parse(payload) as StreamChunk);
        } catch {
          // a malformed keepalive chunk shouldn't kill the whole reply
        }
      }
    }
  }

  return { content, toolCalls: toolCalls.filter(Boolean), model, usage, reasoning: reasoning || null };
}
