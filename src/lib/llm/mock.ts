// Mock provider for local development and tests. No network access.
//
// NOTE: the keyword matching below exists ONLY to make the mock feel realistic offline.
// The real app never parses messages: real models decide what to do from prompts/coach.md.
//
// Two modes:
//  - scripted: pass `script` (a queue of responses) for deterministic tests
//  - heuristic: default; returns plausible tool calls and replies for manual testing
import type { ChatMessage, ChatRequest, ChatResult, LLMProvider, ToolCall } from "./types";
import { estimateRequestTokens, estimateTokens } from "./types";

export type ScriptedResponse = { text?: string; toolCalls?: { id?: string; name: string; args: unknown }[] };

const FOODS: Record<string, { portion: string; kcal: number; p: number; c: number; f: number; fiber: number }> = {
  egg: { portion: "1 large egg", kcal: 72, p: 6.3, c: 0.4, f: 4.8, fiber: 0 },
  toast: { portion: "1 slice", kcal: 80, p: 3, c: 14, f: 1, fiber: 1 },
  banana: { portion: "1 medium", kcal: 105, p: 1.3, c: 27, f: 0.4, fiber: 3.1 },
  chicken: { portion: "4 oz cooked", kcal: 187, p: 35, c: 0, f: 4, fiber: 0 },
  rice: { portion: "1 cup cooked", kcal: 205, p: 4.3, c: 45, f: 0.4, fiber: 0.6 },
  oatmeal: { portion: "1 cup cooked", kcal: 154, p: 5.5, c: 27, f: 2.6, fiber: 4 },
  oats: { portion: "1/2 cup dry", kcal: 150, p: 5, c: 27, f: 2.5, fiber: 4 },
  shake: { portion: "1 scoop whey + water", kcal: 120, p: 24, c: 3, f: 1.5, fiber: 0 },
  yogurt: { portion: "1 cup Greek, nonfat", kcal: 130, p: 23, c: 8, f: 0, fiber: 0 },
  apple: { portion: "1 medium", kcal: 95, p: 0.5, c: 25, f: 0.3, fiber: 4.4 },
  salad: { portion: "1 bowl with dressing", kcal: 180, p: 4, c: 12, f: 13, fiber: 4 },
  pizza: { portion: "1 slice", kcal: 285, p: 12, c: 36, f: 10, fiber: 2.5 },
  burger: { portion: "1 burger", kcal: 550, p: 30, c: 40, f: 28, fiber: 2 },
  salmon: { portion: "5 oz cooked", kcal: 290, p: 36, c: 0, f: 15, fiber: 0 },
  avocado: { portion: "1/2 avocado", kcal: 120, p: 1.5, c: 6, f: 11, fiber: 5 },
  coffee: { portion: "12 oz with splash of milk", kcal: 20, p: 1, c: 2, f: 1, fiber: 0 },
};

function lastUserText(messages: ChatMessage[]): { text: string; hasImage: boolean } {
  const m = messages[messages.length - 1];
  if (!m || m.role !== "user") return { text: "", hasImage: false };
  return {
    text: m.content.map((c) => (c.type === "text" ? c.text : "")).join(" "),
    hasImage: m.content.some((c) => c.type === "image"),
  };
}

function fmt(n: unknown) {
  return typeof n === "number" ? Math.round(n).toLocaleString("en-US") : "?";
}

function replyFromResults(messages: ChatMessage[]): string {
  const m = messages[messages.length - 1];
  if (!m || m.role !== "tool") return "";
  const lines: string[] = [];
  for (const r of m.results) {
    let d: any = {};
    try {
      d = JSON.parse(r.content);
    } catch {
      /* ignore */
    }
    if (r.isError || d.error) {
      lines.push(`I couldn't save that one (${d.error ?? "error"}). Mind rephrasing?`);
      continue;
    }
    switch (r.name) {
      case "log_meal": {
        const t = d.today ?? {};
        const left = d.remaining?.kcal;
        lines.push(
          `Logged ~${fmt(d.entry?.kcal)} kcal, ${fmt(d.entry?.protein_g)} g protein (estimate). ` +
            `Today: ${fmt(t.kcal)} kcal · P ${fmt(t.protein_g)} g · C ${fmt(t.carbs_g)} g · F ${fmt(t.fat_g)} g` +
            (left != null ? `, about ${fmt(left)} kcal left.` : "."),
        );
        break;
      }
      case "log_exercise":
        lines.push(
          `Logged ${d.entry?.exercise ?? "that"}: ${d.entry?.sets?.length ?? 0} sets.` +
            (d.previous ? ` Last time: ${d.previous.summary}. Try one more rep or a small weight bump.` : " First time logged, nice baseline."),
        );
        break;
      case "log_weight":
        lines.push(
          `Logged ${d.entry?.weight} ${d.entry?.unit}.` +
            (d.change_since_last != null ? ` Change since last: ${d.change_since_last > 0 ? "+" : ""}${d.change_since_last} ${d.entry?.unit}.` : "") +
            (d.avg_7d != null ? ` 7-day average: ${d.avg_7d} ${d.entry?.unit}.` : ""),
        );
        break;
      case "get_logs":
        lines.push(`I found ${d.rows?.length ?? 0} entries in that range. (Mock mode: a real model would analyze them.)`);
        break;
      case "update_profile":
        lines.push("Saved your profile and targets (estimates). You can change them anytime.");
        break;
      case "save_plan":
        lines.push("Saved your weekly plan. Ask me to adjust it anytime.");
        break;
      case "edit_entry":
      case "delete_entry":
        lines.push(`Done, updated. Today is now ~${fmt(d.today?.kcal)} kcal.`);
        break;
      default:
        break;
    }
  }
  return lines.join("\n\n");
}

function heuristic(req: ChatRequest, n: number): { text: string; toolCalls: ToolCall[] } {
  const prior = replyFromResults(req.messages);
  if (prior) return { text: prior, toolCalls: [] };

  const { text, hasImage } = lastUserText(req.messages);
  const t = text.toLowerCase();
  const id = (k: string) => `mock_${n}_${k}`;
  const can = (name: string) => req.tools?.some((x) => x.name === name);

  if (hasImage && can("log_meal")) {
    return {
      text: "",
      toolCalls: [
        {
          id: id("meal"),
          name: "log_meal",
          args: {
            meal: "lunch",
            items: [
              { name: "Grilled chicken (from photo)", portion: "~5 oz, assumed", kcal: 235, protein_g: 44, carbs_g: 0, fat_g: 5 },
              { name: "White rice", portion: "~1 cup, assumed", kcal: 205, protein_g: 4.3, carbs_g: 45, fat_g: 0.4, fiber_g: 0.6 },
            ],
            notes: "estimated from photo",
          },
        },
      ],
    };
  }

  const weightMatch = t.match(/(\d{2,3}(?:\.\d)?)\s*(lb|lbs|pounds|kg)\b/);
  if (weightMatch && /weigh|scale|weight/.test(t) && can("log_weight")) {
    return {
      text: "",
      toolCalls: [
        {
          id: id("w"),
          name: "log_weight",
          args: { weight: Number(weightMatch[1]), unit: weightMatch[2].startsWith("k") ? "kg" : "lb" },
        },
      ],
    };
  }

  const setRe = /(\d+(?:\.\d+)?)\s*(?:x|×|for)\s*(\d+)/g;
  const sets = [...t.matchAll(setRe)];
  if (sets.length && can("log_exercise")) {
    const name = text.split(/\d/)[0].replace(/[:,-]+\s*$/, "").trim() || "Exercise";
    return {
      text: "",
      toolCalls: [
        {
          id: id("x"),
          name: "log_exercise",
          args: {
            exercise: name.charAt(0).toUpperCase() + name.slice(1),
            sets: sets.map((s) => ({ weight: Number(s[1]), reps: Number(s[2]), unit: /kg/.test(t) ? "kg" : "lb" })),
          },
        },
      ],
    };
  }

  if (/\b(ate|had|eating|breakfast|lunch|dinner|snack)\b/.test(t) && !/\b(will|going to|plan to|later)\b/.test(t) && can("log_meal")) {
    const items = [];
    for (const [food, info] of Object.entries(FOODS)) {
      const m = t.match(new RegExp(`(\\d+)?\\s*${food}`));
      if (m) {
        const q = m[1] ? Number(m[1]) : 1;
        items.push({
          name: food.charAt(0).toUpperCase() + food.slice(1),
          portion: q > 1 ? `${q} x ${info.portion}` : info.portion,
          kcal: info.kcal * q,
          protein_g: +(info.p * q).toFixed(1),
          carbs_g: +(info.c * q).toFixed(1),
          fat_g: +(info.f * q).toFixed(1),
          fiber_g: +(info.fiber * q).toFixed(1),
        });
      }
    }
    if (!items.length) items.push({ name: "Mixed meal", portion: "1 plate, assumed", kcal: 500, protein_g: 25, carbs_g: 55, fat_g: 18, fiber_g: 5 });
    const meal = (t.match(/\b(breakfast|lunch|dinner|snack)\b/)?.[1] ?? "snack") as string;
    return { text: "", toolCalls: [{ id: id("meal"), name: "log_meal", args: { meal, items } }] };
  }

  if (/\b(plan|program|routine)\b/.test(t) && can("save_plan")) {
    return {
      text: "",
      toolCalls: [
        {
          id: id("plan"),
          name: "save_plan",
          args: {
            plan: {
              name: "3-day full body",
              days: [
                { day: "Mon", focus: "Full body A", exercises: [{ name: "Squat", sets: 3, reps: "6-8" }, { name: "Bench press", sets: 3, reps: "6-8" }, { name: "Row", sets: 3, reps: "8-10" }] },
                { day: "Wed", focus: "Full body B", exercises: [{ name: "Deadlift", sets: 3, reps: "5" }, { name: "Overhead press", sets: 3, reps: "6-8" }, { name: "Pull-up", sets: 3, reps: "AMRAP" }] },
                { day: "Fri", focus: "Full body C", exercises: [{ name: "Leg press", sets: 3, reps: "10" }, { name: "Incline DB press", sets: 3, reps: "8-10" }, { name: "Lat pulldown", sets: 3, reps: "10" }] },
              ],
            },
            text: "Mon: Squat 3x6-8, Bench 3x6-8, Row 3x8-10\nWed: Deadlift 3x5, OHP 3x6-8, Pull-ups 3xAMRAP\nFri: Leg press 3x10, Incline DB press 3x8-10, Pulldown 3x10",
          },
        },
      ],
    };
  }

  if (/\b(goal|years old|my stats|set up|setup)\b/.test(t) && can("update_profile")) {
    return {
      text: "",
      toolCalls: [
        {
          id: id("prof"),
          name: "update_profile",
          args: {
            fields: {
              goal: "build muscle",
              activity_level: "moderate",
              targets: { kcal: 2600, protein_g: 170, carbs_g: 300, fat_g: 80, fiber_g: 35 },
            },
          },
        },
      ],
    };
  }

  if (/\?\s*$/.test(t) && can("get_logs")) {
    return {
      text: "",
      toolCalls: [{ id: id("q"), name: "get_logs", args: { type: "meals", from_date: "2000-01-01", to_date: "2100-01-01" } }],
    };
  }

  if (!req.tools?.length) {
    return {
      text: "**Recap (mock):** You logged your meals and stayed close to target. Keep protein high tomorrow and aim for one extra serving of vegetables. Numbers are estimates.",
      toolCalls: [],
    };
  }

  return {
    text:
      "Hi! I'm Vortra, running in **mock mode** (no real AI connected). Try:\n\n" +
      "- \"I had 2 eggs and toast for breakfast\"\n- \"Bench press 135x8, 155x6\"\n- \"I weigh 182.4 lb this morning\"\n" +
      "- \"My goal is to build muscle, set up my targets\"\n- \"Make me a training plan\"",
    toolCalls: [],
  };
}

export class MockProvider implements LLMProvider {
  readonly name = "mock";
  private calls = 0;
  public requests: ChatRequest[] = [];
  constructor(private opts: { script?: ScriptedResponse[] } = {}) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    this.calls++;
    let out: { text: string; toolCalls: ToolCall[] };
    if (this.opts.script) {
      const next = this.opts.script.shift() ?? { text: "" };
      out = {
        text: next.text ?? "",
        toolCalls: (next.toolCalls ?? []).map((t, i) => ({ id: t.id ?? `scripted_${this.calls}_${i}`, name: t.name, args: t.args })),
      };
    } else {
      out = heuristic(req, this.calls);
    }
    if (out.text && req.onText) {
      for (const piece of out.text.match(/\S+\s*/g) ?? []) req.onText(piece);
    }
    return {
      text: out.text,
      toolCalls: out.toolCalls,
      stopReason: out.toolCalls.length ? "tool_use" : "stop",
      usage: { inputTokens: estimateRequestTokens(req), outputTokens: estimateTokens(out.text) + 20 * out.toolCalls.length, cachedInputTokens: 0 },
    };
  }
}
