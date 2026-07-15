import type { AgentEvent } from "./run";

/**
 * The ndjson protocol between the chat route and the assistant panel:
 * agent progress events plus the turn's terminal frames.
 */
export type ChatStreamEvent =
  | AgentEvent
  | { type: "done"; reply: string; mutated: boolean }
  | { type: "error"; error: string };
