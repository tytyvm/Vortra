// All runtime settings come from environment variables (see .env.example).
// Read lazily on every call so tests and scripts can change process.env.
import fs from "node:fs";
import path from "node:path";

const env = (k: string, d = "") => (process.env[k] ?? "").trim() || d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && (process.env[k] ?? "").trim() !== "" ? v : d;
};
const bool = (k: string, d: boolean) => {
  const v = (process.env[k] ?? "").trim().toLowerCase();
  if (!v) return d;
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

export type ProviderName = "mock" | "openai" | "anthropic" | "gemini" | "xai" | "openai-compatible";

export interface ModelChoice {
  provider: ProviderName;
  model: string;
  vision: boolean;
}

function modelChoice(prefix: string, fallback?: ModelChoice): ModelChoice | undefined {
  const provider = env(`${prefix}_PROVIDER`) as ProviderName;
  const model = env(`${prefix}_MODEL`);
  if (!provider && !model) return fallback;
  return {
    provider: provider || fallback?.provider || "mock",
    model: model || fallback?.model || "mock-coach",
    vision: bool(`${prefix}_VISION`, true),
  };
}

export function config() {
  const main = modelChoice("LLM") ?? { provider: "mock" as ProviderName, model: "mock-coach", vision: true };
  const stripeEnabled = bool("STRIPE_ENABLED", false);
  return {
    appUrl: env("APP_URL", "http://localhost:3000"),
    isProd: process.env.NODE_ENV === "production",

    llm: {
      main,
      // Optional separate models. Unset -> fall back to the main model.
      recap: modelChoice("LLM_RECAP", main)!,
      photo: modelChoice("LLM_PHOTO"), // undefined -> main model handles photos (if vision)
    },

    limits: {
      maxOutputTokens: num("MAX_OUTPUT_TOKENS", 700),
      maxInputTokens: num("MAX_INPUT_TOKENS", 12000),
      historyMessages: num("HISTORY_MESSAGES", 10),
      maxToolRounds: num("MAX_TOOL_ROUNDS", 6),
      maxMessageChars: num("MAX_MESSAGE_CHARS", 4000),
      maxImageBytes: num("MAX_IMAGE_BYTES", 1_500_000),
      userMonthlyUsd: num("USER_MONTHLY_LIMIT_USD", 5),
      appDailyUsd: num("APP_DAILY_LIMIT_USD", 25),
      chatPerMinute: num("CHAT_RATE_LIMIT_PER_MIN", 12),
    },

    recaps: {
      enabled: bool("RECAPS_ENABLED", false),
      scheduler: env("RECAPS_SCHEDULER", "external"), // "external" (cron hits /api/cron/recaps) | "internal"
      hour: num("RECAP_HOUR", 20), // local hour for the evening recap
      email: bool("RECAPS_EMAIL", false),
      cronSecret: env("CRON_SECRET"),
    },

    email: {
      provider: env("EMAIL_PROVIDER", "console"), // console | resend | postmark
      from: env("EMAIL_FROM", "Vortra <login@example.com>"),
      resendKey: env("RESEND_API_KEY"),
      postmarkToken: env("POSTMARK_SERVER_TOKEN"),
    },

    billing: {
      enabled: stripeEnabled,
      secretKey: env("STRIPE_SECRET_KEY"),
      webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
      priceId: env("STRIPE_PRICE_ID"),
      // Plan limits. With billing off, everyone gets USER_MONTHLY_LIMIT_USD.
      plans: {
        free: { monthlyUsd: num("PLAN_FREE_MONTHLY_USD", 0.5), photos: bool("PLAN_FREE_PHOTOS", true) },
        pro: { monthlyUsd: num("PLAN_PRO_MONTHLY_USD", 5), photos: true },
      } as Record<string, { monthlyUsd: number; photos: boolean }>,
    },
  };
}

export function providerSettings(provider: ProviderName) {
  const generic = env("LLM_API_KEY");
  switch (provider) {
    case "openai":
      return { apiKey: env("OPENAI_API_KEY", generic), baseUrl: env("OPENAI_BASE_URL", "https://api.openai.com/v1") };
    case "anthropic":
      return { apiKey: env("ANTHROPIC_API_KEY", generic), baseUrl: env("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1") };
    case "gemini":
      return {
        apiKey: env("GEMINI_API_KEY", generic),
        baseUrl: env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"),
      };
    case "xai":
      return { apiKey: env("XAI_API_KEY", generic), baseUrl: env("XAI_BASE_URL", "https://api.x.ai/v1") };
    case "openai-compatible":
      return {
        apiKey: env("OPENAI_COMPATIBLE_API_KEY", generic),
        baseUrl: env("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:11434/v1"),
      };
    default:
      return { apiKey: "", baseUrl: "" };
  }
}

/** Extra provider knobs that some models need. */
export function providerExtras() {
  return {
    compatStreamUsage: bool("OPENAI_COMPATIBLE_STREAM_USAGE", true),
    geminiThinkingBudget: process.env.GEMINI_THINKING_BUDGET ? num("GEMINI_THINKING_BUDGET", 0) : undefined,
  };
}

type Price = { input: number; output: number; cachedInput?: number };
let priceCache: { mtime: number; table: Record<string, Price> } | null = null;

export function priceTable(): Record<string, Price> {
  const file = path.join(process.cwd(), "config", "prices.json");
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (!priceCache || priceCache.mtime !== mtime) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      delete raw._note;
      priceCache = { mtime, table: raw };
    }
    return priceCache.table;
  } catch {
    return { default: { input: 3, output: 15 } };
  }
}

export function priceFor(model: string): Price {
  const table = priceTable();
  if (table[model]) return table[model];
  let best: string | null = null;
  for (const key of Object.keys(table)) {
    if (key !== "default" && model.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? table[best] : table.default ?? { input: 3, output: 15 };
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0) {
  const p = priceFor(model);
  const cached = Math.min(cachedInputTokens, inputTokens);
  const cost =
    ((inputTokens - cached) * p.input + cached * (p.cachedInput ?? p.input) + outputTokens * p.output) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}
