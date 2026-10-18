import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateRecap, recapDue, runRecaps } from "@/lib/coach/recaps";
import { prisma } from "@/lib/db";
import { setProviderOverride } from "@/lib/llm";
import { MockProvider } from "@/lib/llm/mock";
import { makeUser, resetDb } from "./helpers";

const base = { timezone: "America/New_York", recapDaily: true, recapWeekly: true, lastDailyRecap: null, lastWeeklyRecap: null };

describe("recap scheduling", () => {
  it("is due in the evening in the user's time zone, weekly on Sunday", () => {
    const satEvening = new Date("2026-10-18T00:30:00Z"); // Sat 20:30 New York
    const satAfternoon = new Date("2026-10-17T19:00:00Z"); // Sat 15:00
    const sunEvening = new Date("2026-10-19T00:30:00Z"); // Sun 20:30
    expect(recapDue(base, satAfternoon, 20)).toBeNull();
    expect(recapDue(base, satEvening, 20)).toBe("daily");
    expect(recapDue({ ...base, lastDailyRecap: "2026-10-17" }, satEvening, 20)).toBeNull();
    expect(recapDue(base, sunEvening, 20)).toBe("weekly");
    expect(recapDue({ ...base, recapWeekly: false }, sunEvening, 20)).toBe("daily");
    expect(recapDue({ ...base, recapDaily: false, recapWeekly: false }, satEvening, 20)).toBeNull();
  });
});

describe("recap job", () => {
  beforeEach(resetDb);
  afterEach(() => {
    delete process.env.RECAPS_ENABLED;
  });

  it("does nothing when disabled for the deployment", async () => {
    expect(await runRecaps()).toEqual({ sent: 0, skipped: "disabled" });
  });

  it("posts a recap message to active users who opted in, once per day", async () => {
    process.env.RECAPS_ENABLED = "true";
    const now = new Date("2026-10-18T00:30:00Z"); // Sat 20:30 New York
    const active = await makeUser();
    const optedOut = await makeUser();
    await prisma.user.update({ where: { id: optedOut.id }, data: { recapDaily: false, recapWeekly: false } });
    const inactive = await makeUser();
    for (const u of [active, optedOut]) await prisma.message.create({ data: { userId: u.id, role: "user", content: "hi", createdAt: new Date("2026-10-17T15:00:00Z") } });
    void inactive;
    const mock = new MockProvider({ script: [{ text: "Solid day: ~2,100 kcal (est.)." }] });
    setProviderOverride(mock);
    expect(await runRecaps(now)).toEqual({ sent: 1 });
    expect(mock.requests[0].tools).toBeUndefined();
    const recap = await prisma.message.findFirstOrThrow({ where: { userId: active.id, kind: "recap" } });
    expect(recap.content).toBe("Solid day: ~2,100 kcal (est.).");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: active.id } })).lastDailyRecap).toBe("2026-10-17");
    expect(await runRecaps(now)).toEqual({ sent: 0 });
    expect(await prisma.usage.count({ where: { kind: "recap" } })).toBe(1);
  });

  it("weekly recap uses two weeks of day lines", async () => {
    const u = await makeUser();
    const mock = new MockProvider({ script: [{ text: "Week recap." }] });
    setProviderOverride(mock);
    await generateRecap(u.id, "weekly", new Date("2026-10-19T00:30:00Z"));
    const sent = mock.requests[0].messages[0];
    const text = sent.role === "user" && sent.content[0].type === "text" ? sent.content[0].text : "";
    expect(text).toContain("Previous week:\n2026-10-05 Mon");
    expect(text).toContain("This week:\n2026-10-12 Mon");
    expect(text).toContain("2026-10-18 Sun: no food logged");
  });
});
