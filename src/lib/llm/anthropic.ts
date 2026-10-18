// Anthropic Messages API adapter (streaming).
import { ensureOk, readSSE, safeParseArgs } from "./sse";
import type { ChatMessage, ChatRequest, ChatResult, FetchLike, LLMProvider, ToolCall, ToolDef } from "./types";
import { estimateRequestTokens, estimateTokens } from "./types";

export function toAnthropicSystem(system: ChatRequest["system"]) {
  return system
    .filter((s) => s.text)
    .map((s) => ({ type: "text", text: s.text, ...(s.cache ? { cache_control: { type: "ephemeral" } } : {}) }));
}

export function toAnthropicMessages(messages: ChatMessage[]) {
  const out: { role: "user" | "assistant"; content: Record<string, unknown>[] }[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({
        role: "user",
        content: m.content.map((c) =>
          c.type === "text"
            ? { type: "text", text: c.text }
            : { type: "image", source: { type: "base64", media_type: c.mimeType, data: c.data } },
        ),
      });
    } else if (m.role === "assistant") {
      const content: Record<string, unknown>[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const t of m.toolCalls ?? []) content.push({ type: "tool_use", id: t.id, name: t.name, input: t.args ?? {} });
      out.push({ role: "assistant", content });
    } else {
      out.push({
        role: "user",
        content: m.results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.callId,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      });
    }
  }
  return out;
}

export function toAnthropicTools(tools: ToolDef[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  constructor(private opts: { apiKey: string; baseUrl: string; fetchImpl?: FetchLike }) {}

  buildBody(req: ChatRequest) {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: toAnthropicSystem(req.system),
      messages: toAnthropicMessages(req.messages),
      stream: true,
    };
    if (req.tools?.length) body.tools = toAnthropicTools(req.tools);
    return body;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(this.buildBody(req)),
      signal: req.signal,
    });
    await ensureOk(this.name, res);

    let text = "";
    let stopReason = "end_turn";
    let input = 0;
    let cached = 0;
    let output = 0;
    let gotUsage = false;
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();

    for await (const { data } of readSSE(res)) {
      let ev: any;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      switch (ev.type) {
        case "message_start": {
          const u = ev.message?.usage ?? {};
          cached = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          input = (u.input_tokens ?? 0) + cached;
          output = u.output_tokens ?? 0;
          gotUsage = true;
          break;
        }
        case "content_block_start":
          blocks.set(ev.index, {
            type: ev.content_block?.type,
            id: ev.content_block?.id,
            name: ev.content_block?.name,
            json: "",
          });
          break;
        case "content_block_delta": {
          const b = blocks.get(ev.index);
          if (ev.delta?.type === "text_delta") {
            text += ev.delta.text;
            req.onText?.(ev.delta.text);
          } else if (ev.delta?.type === "input_json_delta" && b) {
            b.json += ev.delta.partial_json ?? "";
          }
          break;
        }
        case "message_delta":
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
          if (ev.usage?.output_tokens != null) output = ev.usage.output_tokens;
          break;
        case "error":
          throw new Error(`anthropic stream error (${ev.error?.type ?? "unknown"})`);
      }
    }

    const toolCalls: ToolCall[] = [...blocks.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, b]) => b.type === "tool_use")
      .map(([, b]) => ({ id: b.id!, name: b.name!, args: safeParseArgs(b.json) }));

    return {
      text,
      toolCalls,
      stopReason,
      usage: gotUsage
        ? { inputTokens: input, outputTokens: output, cachedInputTokens: cached }
        : { inputTokens: estimateRequestTokens(req), outputTokens: estimateTokens(text), cachedInputTokens: 0 },
    };
  }
}
