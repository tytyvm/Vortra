import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCoachTurn } from "@/lib/coach/agent";
import { buildContextBlock, trimHistory } from "@/lib/coach/context";
import { prisma } from "@/lib/db";
import { setProviderOverride } from "@/lib/llm";
import { MockProvider } from "@/lib/llm/mock";
import { estimateRequestTokens, type ChatMessage } from "@/lib/llm/types";
import { makeUser, NOW, resetDb } from "./helpers";

const u = (t: string): ChatMessage => ({ role: "user", content: [{ type: "text", text: t }] });
const a = (t: string): ChatMessage => ({ role: "assistant", text: t });

describe("context trimming", () => {
  it("drops the oldest messages first to fit the budget", () => {
    const hist = [u("a".repeat(400)), a("b".repeat(400)), u("c".repeat(400)), a("d".repeat(400))]; // ~104 tokens each
    const out = trimHistory(hist, 220);
    expect(out.map((m) => (m.role === "user" ? m.content[0] : m.role === "assistant" ? m.text : null))).toEqual([{ type: "text", text: "c".repeat(400) }, "d".repeat(400)]);
  });

  it("never starts with an assistant message and merges same-role neighbors", () => {
    const out = trimHistory([a("recap"), u("one"), u("two"), a("x"), a("y")], 10_000);
    expect(out).toEqual([
      { role: "user", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] },
      { role: "assistant", text: "x\n\ny" },
    ]);
  });

  it("returns empty when nothing fits", () => {
    expect(trimHistory([u("hello there")], 0)).toEqual([]);
  });
});

describe("what the model receives", () => {
  beforeEach(resetDb);
  afterEach(() => {
    delete process.env.HISTORY_MESSAGES;
    delete process.env.MAX_INPUT_TOKENS;
  });

  it("includes profile, today with entry ids, 7-day lines and summary", async () => {
    const user = await makeUser("America/New_York");
    await prisma.profile.create({ data: { userId: user.id, data: JSON.stringify({ goal: "lose fat", targets: { kcal: 2000, protein_g: 160 } }), summary: "Has a wedding Nov 20." } });
    await prisma.mealLog.create({ data: { id: "m_test1", userId: user.id, day: "2026-10-18", loggedAt: new Date("2026-10-18T12:00:00Z"), meal: "breakfast", items: JSON.stringify([{ name: "Oats", portion: "1 cup", kcal: 300 }]), kcal: 300, proteinG: 10, carbsG: 54, fatG: 5, fiberG: 8 } });
    const ctx = await buildContextBlock(user.id, user.timezone, NOW);
    expect(ctx).toContain("Now: Sun 2026-10-18 14:00 (America/New_York)");
    expect(ctx).toContain('"goal":"lose fat"');
    expect(ctx).toContain("Totals: 300 kcal, P 10 g, C 54 g, F 5 g, Fiber 8 g");
    expect(ctx).toContain("Remaining: 1700 kcal, P 150 g");
    expect(ctx).toContain("- m_test1 08:00 breakfast: Oats (1 cup) | 300 kcal P10 C54 F5 Fib8");
    expect(ctx).toContain("2026-10-17 Sat: no food logged");
    expect(ctx).toContain("Has a wedding Nov 20.");
  });

  it("sends only the last N messages and trims oldest to the input budget", async () => {
    const user = await makeUser();
    for (let i = 0; i < 30; i++) {
      await prisma.message.create({ data: { userId: user.id, role: i % 2 ? "assistant" : "user", content: `msg ${i} ` + "x".repeat(200), createdAt: new Date(NOW.getTime() - (30 - i) * 60_000) } });
    }
    process.env.HISTORY_MESSAGES = "10";
    const mock = new MockProvider({ script: [{ text: "ok" }] });
    setProviderOverride(mock);
    await runCoachTurn({ userId: user.id, text: "new message", now: NOW });
    const sent = mock.requests[0].messages;
    const texts = sent.map((m) => (m.role === "user" ? m.content.map((c) => (c.type === "text" ? c.text : "")).join("|") : m.role === "assistant" ? m.text : ""));
    expect(texts[texts.length - 1]).toBe("new message");
    expect(texts.join(" ")).not.toContain("msg 19 ");
    expect(texts[0].startsWith("msg 20 ")).toBe(true);
    expect(sent.length).toBe(11);

    // Now a tight budget: the system prompt and tools use most of it, so old history goes first.
    const mock2 = new MockProvider({ script: [{ text: "ok" }] });
    setProviderOverride(mock2);
    const fixed = JSON.stringify(mock.requests[0].system).length / 4 + JSON.stringify(mock.requests[0].tools).length / 4;
    process.env.MAX_INPUT_TOKENS = String(Math.ceil(fixed + 200));
    await runCoachTurn({ userId: user.id, text: "another", now: NOW });
    const sent2 = mock2.requests[0].messages;
    expect(sent2.length).toBeLessThan(sent.length);
    expect(estimateRequestTokens(mock2.requests[0])).toBeLessThanOrEqual(Number(process.env.MAX_INPUT_TOKENS) + 10);
    expect(sent2[0].role).toBe("user");
    const last = sent2[sent2.length - 1];
    expect(last.role === "user" && last.content.some((c) => c.type === "text" && c.text === "another")).toBe(true);
  });
});
