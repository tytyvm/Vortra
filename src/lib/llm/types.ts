// Provider-neutral chat types. Every adapter translates to and from these.

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string /* base64, no data: prefix */ };

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  /** Provider-specific data that must be echoed back (e.g. Gemini thought signatures). */
  meta?: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  content: string; // JSON string
  isError?: boolean;
}

export type ChatMessage =
  | { role: "user"; content: ContentPart[] }
  | { role: "assistant"; text: string; toolCalls?: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface SystemBlock {
  text: string;
  /** Hint that this block is stable across calls (used for prompt caching where supported). */
  cache?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (object)
}

export interface ChatRequest {
  model: string;
  system: SystemBlock[];
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens: number;
  /** Called with text deltas as they stream in. */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: string;
}

export interface LLMProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Rough token estimate (~4 chars per token). Used for trimming and as a usage fallback. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
export const IMAGE_TOKEN_ESTIMATE = 1100;

export function estimateMessageTokens(m: ChatMessage): number {
  if (m.role === "user")
    return 4 + m.content.reduce((n, c) => n + (c.type === "text" ? estimateTokens(c.text) : IMAGE_TOKEN_ESTIMATE), 0);
  if (m.role === "assistant") return 4 + estimateTokens(m.text) + estimateTokens(JSON.stringify(m.toolCalls ?? []));
  return 4 + m.results.reduce((n, r) => n + estimateTokens(r.content), 0);
}

export function estimateRequestTokens(req: Pick<ChatRequest, "system" | "messages" | "tools">): number {
  return (
    req.system.reduce((n, s) => n + estimateTokens(s.text), 0) +
    req.messages.reduce((n, m) => n + estimateMessageTokens(m), 0) +
    estimateTokens(JSON.stringify(req.tools ?? []))
  );
}
