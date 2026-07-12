/**
 * Thin wrapper over Oxen.ai's OpenAI-compatible chat completions API.
 * https://docs.oxen.ai/examples/inference/chat_completions
 *
 * Server-side only: the API key must never reach the browser.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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

export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: LlmToolCall[];
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
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

/** Model routing per task, tunable in one place. */
export const LLM_MODELS = {
  /** wireframe generation & HTML conversion */
  wireframe: "claude-sonnet-4-6",
  /** copywriting: rewrites, alternates, brainstorms */
  copy: "claude-sonnet-4-6",
  /** vision: screenshots / PDFs to structure */
  vision: "claude-sonnet-4-6",
} as const;

export class LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LlmClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://hub.oxen.ai/api/ai").replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async chat(options: {
    model: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<ChatCompletionResult> {
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
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LlmError(`LLM request failed: ${res.status}`, res.status, body);
    }
    const data = (await res.json()) as {
      model: string;
      choices: { message: { content: string | null; tool_calls?: LlmToolCall[] } }[];
      usage?: ChatCompletionResult["usage"];
    };
    const message = data.choices[0]?.message;
    if (message === undefined) {
      throw new LlmError("LLM response contained no choices", 502, JSON.stringify(data));
    }
    return {
      content: message.content ?? "",
      toolCalls: message.tool_calls ?? [],
      model: data.model,
      usage: data.usage,
    };
  }
}
