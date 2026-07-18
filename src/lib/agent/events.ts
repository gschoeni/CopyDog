import type { ChatInteraction } from "./interactions";
import type { AgentEvent } from "./run";

/**
 * The ndjson protocol between the chat route and the assistant panel:
 * agent progress plus terminal frames. Interactive UI requests are a
 * first-class event rather than prose the client has to parse.
 */
export type ChatStreamEvent =
  | AgentEvent
  | { type: "interaction"; interaction: ChatInteraction }
  | { type: "done"; reply: string; mutated: boolean; interaction?: ChatInteraction }
  | { type: "error"; error: string };
