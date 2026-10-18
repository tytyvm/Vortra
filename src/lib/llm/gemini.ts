// Google Gemini (Generative Language API) adapter, streaming via alt=sse.
import { ensureOk, readSSE } from "./sse";
import type { ChatMessage, ChatRequest, ChatResult, FetchLike, LLMProvider, ToolCall, ToolDef } from "./types";
import { estimateRequestTokens, estimateTokens } from "./types";

export function toGeminiContents(messages: ChatMessage[]) {
  const out: { role: "user" | "model"; parts: Record<string, unknown>[] }[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({
        role: "user",
        parts: m.content.map((c) =>
          c.type === "text" ? { text: c.text } : { inlineData: { mimeType: c.mimeType, data: c.data } },
        ),
      });
    } else if (m.role === "assistant") {
      const parts: Record<string, unknown>[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const t of m.toolCalls ?? []) {
        const part: Record<string, unknown> = { functionCall: { name: t.name, args: t.args ?? {} } };
        // Gemini thinking models require the thought signature to be sent back unchanged.
        if (t.meta?.thoughtSignature) part.thoughtSignature = t.meta.thoughtSignature;
        parts.push(part);
      }
      if (parts.length) out.push({ role: "model", parts });
    } else {
      out.push({
        role: "user",
        parts: m.results.map((r) => {
          let response: unknown;
          try {
            response = JSON.parse(r.content);
          } catch {
            response = r.content;
          }
          return {
            functionResponse: {
              name: r.name,
              response:
                response && typeof response === "object" && !Array.isArray(response) ? response : { result: response },
            },
          };
        }),
      });
    }
  }
  return out;
}

export function toGeminiTools(tools: ToolDef[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.parameters,
      })),
    },
  ];
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  constructor(private opts: { apiKey: string; baseUrl: string; thinkingBudget?: number; fetchImpl?: FetchLike }) {}

  buildBody(req: ChatRequest) {
    const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens };
    if (this.opts.thinkingBudget != null) generationConfig.thinkingConfig = { thinkingBudget: this.opts.thinkingBudget };
    const body: Record<string, unknown> = {
      contents: toGeminiContents(req.messages),
      generationConfig,
    };
    const sys = req.system.map((s) => s.text).join("\n\n");
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    if (req.tools?.length) body.tools = toGeminiTools(req.tools);
    return body;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const f = this.opts.fetchImpl ?? fetch;
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
      body: JSON.stringify(this.buildBody(req)),
      signal: req.signal,
    });
    await ensureOk(this.name, res);

    let text = "";
    let stopReason = "STOP";
    let usage: ChatResult["usage"] | null = null;
    const toolCalls: ToolCall[] = [];

    for await (const { data } of readSSE(res)) {
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usageMetadata) {
        const u = chunk.usageMetadata;
        usage = {
          inputTokens: u.promptTokenCount ?? 0,
          // thinking tokens are billed as output
          outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
          cachedInputTokens: u.cachedContentTokenCount ?? 0,
        };
      }
      const cand = chunk.candidates?.[0];
      if (!cand) continue;
      for (const part of cand.content?.parts ?? []) {
        if (part.thought) continue;
        if (typeof part.text === "string" && part.text) {
          text += part.text;
          req.onText?.(part.text);
        }
        if (part.functionCall) {
          toolCalls.push({
            id: part.functionCall.id ?? `gem_${toolCalls.length}_${Date.now().toString(36)}`,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
            ...(part.thoughtSignature ? { meta: { thoughtSignature: part.thoughtSignature } } : {}),
          });
        }
      }
      if (cand.finishReason) stopReason = cand.finishReason;
    }

    return {
      text,
      toolCalls,
      stopReason,
      usage: usage ?? { inputTokens: estimateRequestTokens(req), outputTokens: estimateTokens(text), cachedInputTokens: 0 },
    };
  }
}
