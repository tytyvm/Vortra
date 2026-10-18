import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_VISION_MESSAGE, runCoachTurn, type CoachEvent } from "@/lib/coach/agent";
import { prisma } from "@/lib/db";
import { setProviderOverride } from "@/lib/llm";
import { MockProvider } from "@/lib/llm/mock";
import { renderMarkdown } from "@/lib/markdown";
import { makeUser, NOW, resetDb } from "./helpers";

describe("coach turn (mock provider)", () => {
  beforeEach(resetDb);
  afterEach(() => {
    delete process.env.LLM_VISION;
    delete process.env.MAX_TOOL_ROUNDS;
  });

  it("runs tool round trips, streams text, and saves the conversation", async () => {
    const user = await makeUser();
    const mock = new MockProvider({
      script: [
        { toolCalls: [{ name: "log_meal", args: { meal: "lunch", items: [{ name: "Chipotle chicken bowl", portion: "standard", kcal: 680, protein_g: 52, carbs_g: 70, fat_g: 21, fiber_g: 12 }] } }] },
        { text: "Logged ~680 kcal (est.)." },
      ],
    });
    setProviderOverride(mock);
    const events: CoachEvent[] = [];
    const r = await runCoachTurn({ userId: user.id, text: "chipotle chicken bowl for lunch", now: NOW, onEvent: (e) => events.push(e) });

    expect(r.reply).toBe("Logged ~680 kcal (est.).");
    expect(events.filter((e) => e.type === "tool")).toEqual([{ type: "tool", name: "log_meal", ok: true }]);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe(r.reply);
    expect(events[events.length - 1]).toEqual({ type: "done" });

    // second request carried the assistant tool call and the tool result
    const second = mock.requests[1].messages;
    expect(second[second.length - 2]).toMatchObject({ role: "assistant", toolCalls: [{ name: "log_meal" }] });
    const toolMsg = second[second.length - 1];
    expect(toolMsg.role).toBe("tool");
    if (toolMsg.role === "tool") expect(JSON.parse(toolMsg.results[0].content).today.kcal).toBe(680);

    const msgs = await prisma.message.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "chipotle chicken bowl for lunch"],
      ["assistant", "Logged ~680 kcal (est.)."],
    ]);
    expect(await prisma.mealLog.count({ where: { userId: user.id } })).toBe(1);
  });

  it("feeds validation errors back to the model instead of writing bad rows", async () => {
    const user = await makeUser();
    const mock = new MockProvider({ script: [{ toolCalls: [{ name: "log_weight", args: { weight: "heavy" } }] }, { text: "What did the scale say?" }] });
    setProviderOverride(mock);
    const events: CoachEvent[] = [];
    await runCoachTurn({ userId: user.id, text: "weighed in", now: NOW, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: "tool", name: "log_weight", ok: false });
    const last = mock.requests[1].messages.at(-1)!;
    expect(last.role === "tool" && last.results[0].isError).toBe(true);
    expect(await prisma.weightLog.count()).toBe(0);
  });

  it("caps tool rounds and makes the last round tool-free", async () => {
    const user = await makeUser();
    process.env.MAX_TOOL_ROUNDS = "3";
    const loop = { toolCalls: [{ name: "get_logs", args: { type: "meals", from_date: "2026-10-01", to_date: "2026-10-18" } }] };
    const mock = new MockProvider({ script: [loop, loop, { text: "Here's your summary." }] });
    setProviderOverride(mock);
    const r = await runCoachTurn({ userId: user.id, text: "how was my week?", now: NOW });
    expect(mock.requests).toHaveLength(3);
    expect(mock.requests[2].tools).toBeUndefined();
    expect(r.reply).toBe("Here's your summary.");
  });

  it("asks for a description when no vision model is configured", async () => {
    const user = await makeUser();
    process.env.LLM_VISION = "false";
    const mock = new MockProvider({ script: [] });
    setProviderOverride(mock);
    const r = await runCoachTurn({ userId: user.id, text: "", image: { mimeType: "image/jpeg", data: "QUJD" }, now: NOW });
    expect(r.reply).toBe(NO_VISION_MESSAGE);
    expect(mock.requests).toHaveLength(0);
  });

  it("sends the photo to the model as an image part and doesn't resend old photos", async () => {
    const user = await makeUser();
    const mock = new MockProvider({ script: [{ text: "Looks like ~550 kcal." }, { text: "ok" }] });
    setProviderOverride(mock);
    await runCoachTurn({ userId: user.id, text: "lunch", image: { mimeType: "image/jpeg", data: "QUJD" }, now: NOW });
    const m = mock.requests[0].messages.at(-1)!;
    expect(m.role === "user" && m.content).toEqual([{ type: "text", text: "lunch" }, { type: "image", mimeType: "image/jpeg", data: "QUJD" }]);
    await runCoachTurn({ userId: user.id, text: "thanks", now: NOW });
    const hist = JSON.stringify(mock.requests[1].messages);
    expect(hist).not.toContain("QUJD");
    expect(hist).toContain("[photo attached]");
  });

  it("the default (heuristic) mock produces realistic logging turns", async () => {
    const user = await makeUser();
    setProviderOverride(new MockProvider());
    const r = await runCoachTurn({ userId: user.id, text: "I had 2 eggs and toast for breakfast", now: NOW });
    expect(r.reply).toMatch(/Logged ~224 kcal/);
    const r2 = await runCoachTurn({ userId: user.id, text: "Bench press 135x8, 155x6", now: NOW });
    expect(r2.reply).toMatch(/Logged Bench press: 2 sets/);
    expect(await prisma.exerciseLog.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("markdown rendering is safe", () => {
  it("escapes HTML and only links http(s)", () => {
    const html = renderMarkdown('**Hi** <img src=x onerror=alert(1)> [ok](https://example.com) [bad](javascript:alert(1))\n- a\n- b');
    expect(html).toContain("<strong>Hi</strong>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
  });
});

describe("heuristic mock covers setup", () => {
  beforeEach(resetDb);
  it("saves targets through update_profile", async () => {
    const user = await makeUser();
    setProviderOverride(new MockProvider());
    const r = await runCoachTurn({ userId: user.id, text: "My goal is to build muscle, set up my targets", now: NOW });
    expect(r.reply).toMatch(/Saved your profile/);
    const p = await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(JSON.parse(p.data).targets.kcal).toBe(2600);
  });
});
