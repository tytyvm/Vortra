// Provider factory: picks an adapter from config. Switching models needs only env changes.
import { config, providerExtras, providerSettings, type ModelChoice, type ProviderName } from "../config";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import type { LLMProvider } from "./types";

let override: LLMProvider | null = null;
/** Tests and scripts can inject a provider (e.g. a scripted MockProvider). */
export function setProviderOverride(p: LLMProvider | null) {
  override = p;
}

export function createProvider(name: ProviderName): LLMProvider {
  if (override) return override;
  const s = providerSettings(name);
  const x = providerExtras();
  switch (name) {
    case "mock":
      return new MockProvider();
    case "openai":
      return new OpenAIProvider({ name, ...s, tokenParam: "max_completion_tokens", streamUsage: true });
    case "xai":
      return new OpenAIProvider({ name, ...s, tokenParam: "max_tokens", streamUsage: true });
    case "openai-compatible":
      return new OpenAIProvider({ name, ...s, tokenParam: "max_tokens", streamUsage: x.compatStreamUsage });
    case "anthropic":
      return new AnthropicProvider(s);
    case "gemini":
      return new GeminiProvider({ ...s, thinkingBudget: x.geminiThinkingBudget });
    default:
      throw new Error(`Unknown LLM_PROVIDER "${name}"`);
  }
}

export type Purpose = "chat" | "photo" | "recap";

/** Pick the model for a purpose. Returns null for photos when no vision-capable model is configured. */
export function modelFor(purpose: Purpose): ModelChoice | null {
  const c = config().llm;
  if (purpose === "recap") return c.recap;
  if (purpose === "photo") {
    if (c.photo) return c.photo;
    return c.main.vision ? c.main : null;
  }
  return c.main;
}

export * from "./types";
