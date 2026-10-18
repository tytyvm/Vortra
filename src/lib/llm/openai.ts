// OpenAI Chat Completions adapter. Also used for xAI and any OpenAI-compatible server
// (OpenRouter, Groq, Together, Mistral, DeepSeek, Ollama, LM Studio, vLLM...).
import { ensureOk, readSSE, safeParseArgs } from "./sse";
import type { ChatMessage, ChatRequest, ChatResult, FetchLike, LLMProvider, ToolCall, ToolDef } from "./types";
import { estimateRequestTokens, estimateTokens } from "./types";

export interface OpenAIOptions {
  name: string; // "openai" | "xai" | "openai-compatible"
  apiKey: string;
  baseUrl: string;
  /** OpenAI's newer models want max_completion_tokens; most compatible servers want max_tokens. */
  tokenParam: "max_tokens" | "max_completion_tokens";
  streamUsage: boolean;
  fetchImpl?: FetchLike;
}

export function toOpenAIMessages(system: ChatRequest["system"], messages: ChatMessage[]) {
  const out: Record<string, unknown>[] = [];
  const sys = system.map((s) => s.text).join("\n\n");
  if (sys) out.push({ role: "system", content: sys });
  for (const m of messages) {
    if (m.role === "user") {
      const hasImage = m.content.some((c) => c.type === "image");
      if (!hasImage) {
        out.push({ role: "user", content: m.content.map((c) => (c.type === "text" ? c.text : "")).join("\n") });
      } else {
        out.push({
          role: "user",
          content: m.content.map((c) =>
            c.type === "text"
              ? { type: "text", text: c.text }
              : { type: "image_url", image_url: { url: `data:${c.mimeType};base64,${c.data}` } },
          ),
        });
      }
    } else if (m.role === "assistant") {
      const msg: Record<string, unknown> = { role: "assistant", content: m.text || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) },
        }));
      }
      out.push(msg);
    } else {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.callId, content: r.content });
    }
  }
  return out;
}

export function toOpenAITools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  constructor(private opts: OpenAIOptions) {
    this.name = opts.name;
  }

  buildBody(req: ChatRequest) {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.system, req.messages),
      stream: true,
      [this.opts.tokenParam]: req.maxTokens,
    };
    if (this.opts.streamUsage) body.stream_options = { include_usage: true };
    if (req.tools?.length) body.tools = toOpenAITools(req.tools);
    return body;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const f = this.opts.fetchImpl ?? fetch;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(this.buildBody(req)),
      signal: req.signal,
    });
    await ensureOk(this.name, res);

    let text = "";
    let stopReason = "stop";
    let usage: ChatResult["usage"] | null = null;
    const calls = new Map<number, { id: string; name: string; args: string }>();

    for await (const { data } of readSSE(res)) {
      if (data === "[DONE]") break;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        req.onText?.(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const cur = calls.get(i) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(i, cur);
      }
      if (choice.finish_reason) stopReason = choice.finish_reason;
    }

    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, args: safeParseArgs(c.args) }));

    return {
      text,
      toolCalls,
      stopReason,
      usage: usage ?? {
        inputTokens: estimateRequestTokens(req),
        outputTokens: estimateTokens(text),
        cachedInputTokens: 0,
      },
    };
  }
}
