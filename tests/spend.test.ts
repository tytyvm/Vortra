import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCoachTurn } from "@/lib/coach/agent";
import { checkSpend, recordUsage, SPEND_MESSAGES } from "@/lib/coach/spend";
import { estimateCostUsd, priceFor } from "@/lib/config";
import { prisma } from "@/lib/db";
import { setProviderOverride } from "@/lib/llm";
import { MockProvider } from "@/lib/llm/mock";
import { makeUser, NOW, resetDb } from "./helpers";

describe("price table", () => {
  it("matches exact ids, then longest prefix, then default", () => {
    expect(priceFor("gpt-4o-mini")).toMatchObject({ input: 0.15, output: 0.6 });
    expect(priceFor("gpt-4o-mini-2024-07-18")).toMatchObject({ input: 0.15 });
    expect(priceFor("claude-sonnet-4-5")).toMatchObject({ input: 3, output: 15 });
    expect(priceFor("some-unknown-model")).toMatchObject({ input: 3, output: 15 });
  });

  it("estimates cost with cached input pricing", () => {
    // 1M input (half cached) + 100k output on gpt-4o-mini
    expect(estimateCostUsd("gpt-4o-mini", 1_000_000, 100_000, 500_000)).toBeCloseTo(0.5 * 0.15 + 0.5 * 0.075 + 0.1 * 0.6, 6);
  });
});

describe("spend ceilings", () => {
  beforeEach(resetDb);
  afterEach(() => {
    delete process.env.USER_MONTHLY_LIMIT_USD;
    delete process.env.APP_DAILY_LIMIT_USD;
    delete process.env.STRIPE_ENABLED;
  });

  it("records tokens and estimated cost for every model call", async () => {
    const user = await makeUser();
    setProviderOverride(new MockProvider({ script: [{ toolCalls: [{ name: "log_weight", args: { weight: 180, unit: "lb" } }] }, { text: "Logged." }] }));
    await runCoachTurn({ userId: user.id, text: "180 lb", now: NOW });
    const rows = await prisma.usage.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.inputTokens > 0 && r.model === "mock-coach" && r.kind === "chat")).toBe(true);
  });

  it("blocks a user over the monthly ceiling with a friendly message and no model call", async () => {
    const user = await makeUser();
    process.env.USER_MONTHLY_LIMIT_USD = "1";
    await recordUsage({ userId: user.id, kind: "chat", provider: "openai", model: "gpt-4o", usage: { inputTokens: 200_000, outputTokens: 60_000, cachedInputTokens: 0 } }); // $1.10
    const mock = new MockProvider({ script: [{ text: "should not be used" }] });
    setProviderOverride(mock);
    const events: unknown[] = [];
    const r = await runCoachTurn({ userId: user.id, text: "hi", now: new Date(), onEvent: (e) => events.push(e) });
    expect(mock.requests).toHaveLength(0);
    expect(r.reply).toBe(SPEND_MESSAGES.user);
    expect(events).toContainEqual({ type: "notice", text: SPEND_MESSAGES.user });
  });

  it("ignores last month's spend", async () => {
    const user = await makeUser();
    process.env.USER_MONTHLY_LIMIT_USD = "1";
    await prisma.usage.create({ data: { userId: user.id, kind: "chat", provider: "x", model: "x", inputTokens: 1, outputTokens: 1, costUsd: 50, createdAt: new Date("2026-09-30T12:00:00Z") } });
    expect(await checkSpend(user.id, "free", new Date("2026-10-18T12:00:00Z"))).toBeNull();
  });

  it("blocks everyone when the app-wide daily ceiling is hit", async () => {
    const a = await makeUser();
    const b = await makeUser();
    process.env.APP_DAILY_LIMIT_USD = "2";
    await prisma.usage.create({ data: { userId: a.id, kind: "chat", provider: "x", model: "x", inputTokens: 1, outputTokens: 1, costUsd: 2.5 } });
    expect(await checkSpend(b.id, "free")).toBe(SPEND_MESSAGES.app);
    // yesterday's spend doesn't count
    await prisma.usage.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 86400_000) } });
    expect(await checkSpend(b.id, "free")).toBeNull();
  });

  it("uses plan limits when billing is enabled", async () => {
    const user = await makeUser();
    process.env.STRIPE_ENABLED = "true";
    await prisma.usage.create({ data: { userId: user.id, kind: "chat", provider: "x", model: "x", inputTokens: 1, outputTokens: 1, costUsd: 0.6 } });
    expect(await checkSpend(user.id, "free")).toBe(SPEND_MESSAGES.userBilling); // free = $0.50
    expect(await checkSpend(user.id, "pro")).toBeNull(); // pro = $5
  });

  it("stops mid-turn if a ceiling is reached between tool rounds", async () => {
    const user = await makeUser();
    process.env.USER_MONTHLY_LIMIT_USD = "0.000001";
    const mock = new MockProvider({ script: [{ toolCalls: [{ name: "log_weight", args: { weight: 180, unit: "lb" } }] }, { text: "never" }] });
    // make the first call cost something
    const orig = mock.chat.bind(mock);
    mock.chat = async (req) => ({ ...(await orig(req)), usage: { inputTokens: 100_000, outputTokens: 0, cachedInputTokens: 0 } });
    setProviderOverride(mock);
    process.env.LLM_MODEL = "gpt-4o";
    const r = await runCoachTurn({ userId: user.id, text: "180", now: new Date() });
    delete process.env.LLM_MODEL;
    expect(mock.requests).toHaveLength(1);
    expect(await prisma.weightLog.count({ where: { userId: user.id } })).toBe(1); // the tool still ran
    expect(r.reply).toBe("");
  });
});
