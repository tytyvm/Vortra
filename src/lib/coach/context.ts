// Builds what the model sees each turn: instructions, profile, today, last 7 days,
// running summary, and recent messages (trimmed oldest-first to fit the input budget).
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import type { ChatMessage, SystemBlock } from "../llm/types";
import { estimateMessageTokens } from "../llm/types";
import { localDay, localTime, localWeekday } from "../time";
import { recentLines, todaySnapshot } from "./logs";
import { currentPlan, getProfile } from "./profile";
import { exerciseLine, mealLine, remaining, weightLine } from "./totals";

export function loadPrompt(name: string): string {
  // Read on every call so edits to prompts/*.md apply without a rebuild or restart.
  return fs.readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8").trim();
}

const fmtMacros = (m: Partial<Record<"kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g", number>> | null | undefined) =>
  m
    ? [
        m.kcal != null ? `${m.kcal} kcal` : null,
        m.protein_g != null ? `P ${m.protein_g} g` : null,
        m.carbs_g != null ? `C ${m.carbs_g} g` : null,
        m.fat_g != null ? `F ${m.fat_g} g` : null,
        m.fiber_g != null ? `Fiber ${m.fiber_g} g` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : "not set";

export async function buildContextBlock(userId: string, tz: string, now: Date): Promise<string> {
  const [profile, plan, today, lines] = await Promise.all([
    getProfile(userId),
    currentPlan(userId),
    todaySnapshot(userId, tz, now),
    recentLines(userId, tz, now, 7),
  ]);
  const targets = profile.data.targets;
  const out: string[] = [];
  out.push("# Current context (computed by the app from the user's data)");
  out.push(`Now: ${localWeekday(now, tz)} ${localDay(now, tz)} ${localTime(now, tz)} (${tz})`);
  out.push("\n## Profile");
  out.push(Object.keys(profile.data).length ? JSON.stringify(profile.data) : "Empty: this is a new user, start setup.");
  out.push("\n## Current training plan");
  out.push(plan ? plan.text.slice(0, 2000) : "None saved.");
  out.push(`\n## Today (${today.day})`);
  out.push(`Totals: ${fmtMacros(today.totals)}`);
  out.push(`Targets: ${fmtMacros(targets)}`);
  const rem = remaining(today.totals, targets);
  if (rem) out.push(`Remaining: ${fmtMacros(rem)}`);
  out.push("Meals:" + (today.meals.length ? "\n" + today.meals.map((m) => `- ${mealLine(m, tz)}`).join("\n") : " none yet"));
  out.push("Exercise:" + (today.exercises.length ? "\n" + today.exercises.map((x) => `- ${exerciseLine(x, tz)}`).join("\n") : " none yet"));
  if (today.weights.length) out.push("Weigh-ins:\n" + today.weights.map((w) => `- ${weightLine(w, tz)}`).join("\n"));
  if (today.lastWeight && today.lastWeight.day !== today.day)
    out.push(`Last weigh-in: ${today.lastWeight.day} ${today.lastWeight.weight} ${today.lastWeight.unit}`);
  out.push("\n## Last 7 days");
  out.push(lines.join("\n"));
  out.push("\n## Running summary of older conversation");
  out.push(profile.summary || "(empty)");
  return out.join("\n");
}

export async function buildSystem(userId: string, tz: string, now: Date): Promise<SystemBlock[]> {
  return [
    { text: loadPrompt("coach"), cache: true },
    { text: await buildContextBlock(userId, tz, now) },
  ];
}

/** Recent stored messages as chat messages (photos from past turns are not re-sent). */
export async function loadHistory(userId: string, limit: number, beforeId?: string): Promise<ChatMessage[]> {
  const rows = await prisma.message.findMany({
    where: { userId, ...(beforeId ? { NOT: { id: beforeId } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse().map((r) =>
    r.role === "user"
      ? { role: "user", content: [{ type: "text", text: r.content + (r.hasImage ? "\n[photo attached]" : "") }] }
      : { role: "assistant", text: r.content },
  );
}

/**
 * Drop the oldest messages until the history fits in `budgetTokens`, make sure it starts
 * with a user message, and merge consecutive same-role text messages (some providers require
 * strict alternation).
 */
export function trimHistory(history: ChatMessage[], budgetTokens: number): ChatMessage[] {
  const msgs = [...history];
  let total = msgs.reduce((n, m) => n + estimateMessageTokens(m), 0);
  while (msgs.length && total > budgetTokens) total -= estimateMessageTokens(msgs.shift()!);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const merged: ChatMessage[] = [];
  for (const m of msgs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === "user" && m.role === "user") {
      prev.content = [...prev.content, ...m.content];
    } else if (prev && prev.role === "assistant" && m.role === "assistant" && !prev.toolCalls && !m.toolCalls) {
      prev.text = `${prev.text}\n\n${m.text}`;
    } else {
      merged.push(m.role === "user" ? { ...m, content: [...m.content] } : { ...m });
    }
  }
  return merged;
}
