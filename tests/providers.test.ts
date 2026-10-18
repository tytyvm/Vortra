// Provider adapters: request translation (tools, images, tool results) and parsing of
// sample streamed responses in each provider's documented format. No network calls.
import { afterEach, describe, expect, it } from "vitest";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { GeminiProvider } from "@/lib/llm/gemini";
import { createProvider, modelFor } from "@/lib/llm";
import { MockProvider } from "@/lib/llm/mock";
import { OpenAIProvider } from "@/lib/llm/openai";
import type { ChatMessage, ChatRequest, ToolDef } from "@/lib/llm/types";
import { fakeFetch, fixture } from "./helpers";

const tools: ToolDef[] = [
  { name: "log_weight", description: "Log a weigh-in", parameters: { type: "object", properties: { weight: { type: "number" } }, required: ["weight"] } },
];
const img = { type: "image" as const, mimeType: "image/jpeg", data: "QUJD" };
const conversation: ChatMessage[] = [
  { role: "user", content: [{ type: "text", text: "Here's lunch" }, img] },
  { role: "assistant", text: "Logging.", toolCalls: [{ id: "call_1", name: "log_weight", args: { weight: 180 }, meta: { thoughtSignature: "sig==" } }] },
  { role: "tool", results: [{ callId: "call_1", name: "log_weight", content: '{"ok":true,"avg_7d":181}' }] },
];
const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "test-model",
  system: [{ text: "You are Vortra.", cache: true }, { text: "Context here." }],
  messages: conversation,
  tools,
  maxTokens: 500,
  ...over,
});

describe("OpenAI-style adapter (OpenAI, xAI, OpenAI-compatible)", () => {
  it("translates system, images, tool calls, tool results and tools", async () => {
    const { fetch, requests } = fakeFetch([fixture("openai-text.sse")]);
    const p = new OpenAIProvider({ name: "openai", apiKey: "k", baseUrl: "https://api.openai.com/v1", tokenParam: "max_completion_tokens", streamUsage: true, fetchImpl: fetch });
    await p.chat(req());
    const { url, init, body } = requests[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(body.max_completion_tokens).toBe(500);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages[0]).toEqual({ role: "system", content: "You are Vortra.\n\nContext here." });
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
    expect(body.messages[2].tool_calls[0]).toEqual({ id: "call_1", type: "function", function: { name: "log_weight", arguments: '{"weight":180}' } });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: '{"ok":true,"avg_7d":181}' });
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "log_weight", description: "Log a weigh-in", parameters: tools[0].parameters } });
  });

  it("parses streamed text and usage", async () => {
    const { fetch } = fakeFetch([fixture("openai-text.sse")]);
    const p = new OpenAIProvider({ name: "openai", apiKey: "k", baseUrl: "https://x/v1", tokenParam: "max_completion_tokens", streamUsage: true, fetchImpl: fetch });
    const deltas: string[] = [];
    const r = await p.chat(req({ onText: (d) => deltas.push(d) }));
    expect(r.text).toBe("Logged ~144 kcal (est.). Nice start!");
    expect(deltas.join("")).toBe(r.text);
    expect(r.usage).toEqual({ inputTokens: 1700, outputTokens: 12, cachedInputTokens: 0 });
  });

  it("assembles streamed parallel tool calls", async () => {
    const { fetch } = fakeFetch([fixture("openai-tool-call.sse")]);
    const p = new OpenAIProvider({ name: "openai", apiKey: "k", baseUrl: "https://x/v1", tokenParam: "max_completion_tokens", streamUsage: true, fetchImpl: fetch });
    const r = await p.chat(req());
    expect(r.toolCalls).toEqual([
      { id: "call_abc", name: "log_meal", args: { meal: "breakfast", items: [{ name: "Egg", portion: "2 large", kcal: 144, protein_g: 12.6, carbs_g: 0.8, fat_g: 9.6 }] } },
      { id: "call_def", name: "log_weight", args: { weight: 182.4, unit: "lb" } },
    ]);
    expect(r.stopReason).toBe("tool_calls");
    expect(r.usage).toEqual({ inputTokens: 1520, outputTokens: 64, cachedInputTokens: 1024 });
  });

  it("compatible servers use max_tokens, plain text user content, and optional usage", async () => {
    const { fetch, requests } = fakeFetch([fixture("openai-text.sse")]);
    const p = new OpenAIProvider({ name: "openai-compatible", apiKey: "", baseUrl: "http://localhost:11434/v1/", tokenParam: "max_tokens", streamUsage: false, fetchImpl: fetch });
    await p.chat(req({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }));
    expect(requests[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect((requests[0].init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(requests[0].body.max_tokens).toBe(500);
    expect(requests[0].body.stream_options).toBeUndefined();
    expect(requests[0].body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("raises a status-only error on HTTP failure", async () => {
    const { fetch } = fakeFetch(['{"error":{"type":"invalid_request_error","message":"user text echoed here"}}'], 400);
    const p = new OpenAIProvider({ name: "openai", apiKey: "k", baseUrl: "https://x/v1", tokenParam: "max_completion_tokens", streamUsage: true, fetchImpl: fetch });
    await expect(p.chat(req())).rejects.toThrow("openai request failed (400 invalid_request_error)");
    await expect(new OpenAIProvider({ name: "openai", apiKey: "k", baseUrl: "https://x/v1", tokenParam: "max_tokens", streamUsage: true, fetchImpl: fakeFetch(["x"], 500).fetch }).chat(req())).rejects.not.toThrow(/echoed/);
  });
});

describe("Anthropic adapter", () => {
  it("translates system blocks with cache control, images, tool_use and tool_result", async () => {
    const { fetch, requests } = fakeFetch([fixture("anthropic-tool-call.sse")]);
    const p = new AnthropicProvider({ apiKey: "ak", baseUrl: "https://api.anthropic.com/v1", fetchImpl: fetch });
    await p.chat(req());
    const { url, init, body } = requests[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("ak");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    expect(body.system).toEqual([
      { type: "text", text: "You are Vortra.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Context here." },
    ]);
    expect(body.max_tokens).toBe(500);
    expect(body.messages[0].content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Logging." },
        { type: "tool_use", id: "call_1", name: "log_weight", input: { weight: 180 } },
      ],
    });
    expect(body.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"ok":true,"avg_7d":181}' }] });
    expect(body.tools[0]).toEqual({ name: "log_weight", description: "Log a weigh-in", input_schema: tools[0].parameters });
  });

  it("parses streamed text, tool input JSON and usage including cache reads", async () => {
    const { fetch } = fakeFetch([fixture("anthropic-tool-call.sse")]);
    const p = new AnthropicProvider({ apiKey: "ak", baseUrl: "https://api.anthropic.com/v1", fetchImpl: fetch });
    const r = await p.chat(req());
    expect(r.text).toBe("Logging that now.");
    expect(r.toolCalls).toEqual([{ id: "toolu_01", name: "log_exercise", args: { exercise: "Bench press", sets: [{ weight: 135, reps: 8, unit: "lb" }] } }]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.usage).toEqual({ inputTokens: 1510, outputTokens: 58, cachedInputTokens: 1200 });
  });
});

describe("Gemini adapter", () => {
  it("translates system instruction, inline images, function calls with signatures, and function responses", async () => {
    const { fetch, requests } = fakeFetch([fixture("gemini-tool-call.sse")]);
    const p = new GeminiProvider({ apiKey: "gk", baseUrl: "https://generativelanguage.googleapis.com/v1beta", thinkingBudget: 0, fetchImpl: fetch });
    await p.chat(req({ model: "gemini-2.5-flash" }));
    const { url, init, body } = requests[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gk");
    expect(body.systemInstruction).toEqual({ parts: [{ text: "You are Vortra.\n\nContext here." }] });
    expect(body.generationConfig).toEqual({ maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } });
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "Here's lunch" }, { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }] });
    expect(body.contents[1]).toEqual({
      role: "model",
      parts: [{ text: "Logging." }, { functionCall: { name: "log_weight", args: { weight: 180 } }, thoughtSignature: "sig==" }],
    });
    expect(body.contents[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "log_weight", response: { ok: true, avg_7d: 181 } } }] });
    expect(body.tools).toEqual([{ functionDeclarations: [{ name: "log_weight", description: "Log a weigh-in", parametersJsonSchema: tools[0].parameters }] }]);
  });

  it("parses streamed text, function calls (keeping signatures) and usage with thinking tokens", async () => {
    const { fetch } = fakeFetch([fixture("gemini-tool-call.sse")]);
    const p = new GeminiProvider({ apiKey: "gk", baseUrl: "https://x/v1beta", fetchImpl: fetch });
    const r = await p.chat(req());
    expect(r.text).toBe("Got it. ");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ name: "log_weight", args: { weight: 82.5, unit: "kg" }, meta: { thoughtSignature: "c2lnbmF0dXJlLWJ5dGVz" } });
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 55, cachedInputTokens: 0 });
  });
});

describe("provider selection by environment", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("picks adapters and models from env with no code changes", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_MODEL = "claude-haiku-4-5";
    expect(modelFor("chat")).toEqual({ provider: "anthropic", model: "claude-haiku-4-5", vision: true });
    expect(createProvider("anthropic").name).toBe("anthropic");
    expect(createProvider("gemini").name).toBe("gemini");
    expect(createProvider("xai").name).toBe("xai");
    expect(createProvider("openai-compatible").name).toBe("openai-compatible");
    expect(createProvider("mock")).toBeInstanceOf(MockProvider);
    // recap model falls back to main; separate recap model when set
    expect(modelFor("recap")?.model).toBe("claude-haiku-4-5");
    process.env.LLM_RECAP_PROVIDER = "openai";
    process.env.LLM_RECAP_MODEL = "gpt-4o-mini";
    expect(modelFor("recap")).toMatchObject({ provider: "openai", model: "gpt-4o-mini" });
  });

  it("uses a separate photo model, or none when the main model has no vision", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_MODEL = "llama-3.1-8b-instant";
    process.env.LLM_VISION = "false";
    expect(modelFor("photo")).toBeNull();
    process.env.LLM_PHOTO_PROVIDER = "gemini";
    process.env.LLM_PHOTO_MODEL = "gemini-2.5-flash";
    expect(modelFor("photo")).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash" });
  });
});
