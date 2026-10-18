import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getProfile } from "@/lib/coach/profile";
import { executeTool, toolDefs } from "@/lib/coach/tools";
import { makeUser, NOW, resetDb } from "./helpers";

const TZ = "America/New_York";
const call = (name: string, args: unknown) => ({ id: `c_${name}`, name, args });

describe("tool calls write correct rows", () => {
  beforeEach(resetDb);

  it("exposes every tool with a JSON schema", () => {
    const names = toolDefs().map((t) => t.name);
    expect(names).toEqual(["log_meal", "log_exercise", "log_weight", "edit_entry", "delete_entry", "get_logs", "update_profile", "save_plan", "update_summary"]);
    for (const t of toolDefs()) expect(t.parameters.type).toBe("object");
  });

  it("log_meal stores items, totals, local day and returns running totals vs targets", async () => {
    const u = await makeUser(TZ);
    await prisma.profile.create({ data: { userId: u.id, data: JSON.stringify({ targets: { kcal: 2200, protein_g: 170 } }) } });
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    const r = await executeTool(ctx, call("log_meal", {
      meal: "breakfast",
      time: "08:15",
      items: [
        { name: "Egg", portion: "2 large", kcal: 144, protein_g: 12.6, carbs_g: 0.8, fat_g: 9.6 },
        { name: "Dave's Killer Bread", portion: "1 slice", kcal: 110, protein_g: 5, carbs_g: 22, fat_g: 1.5, fiber_g: 5 },
      ],
    }));
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.content);
    expect(out.id).toMatch(/^m_/);
    expect(out.today).toEqual({ kcal: 254, protein_g: 17.6, carbs_g: 22.8, fat_g: 11.1, fiber_g: 5 });
    expect(out.remaining).toEqual({ kcal: 1946, protein_g: 152.4 });

    const row = await prisma.mealLog.findUniqueOrThrow({ where: { id: out.id } });
    expect(row).toMatchObject({ userId: u.id, day: "2026-10-18", meal: "breakfast", kcal: 254, proteinG: 17.6, fiberG: 5 });
    expect(row.loggedAt.toISOString()).toBe("2026-10-18T12:15:00.000Z");
    expect(JSON.parse(row.items)).toHaveLength(2);
  });

  it("rejects invalid arguments without writing anything", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    const bad = [
      call("log_meal", { meal: "brunchtime", items: [{ name: "x", kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }] }),
      call("log_meal", { meal: "lunch", items: [] }),
      call("log_meal", { meal: "lunch", items: [{ name: "x", kcal: -5, protein_g: 1, carbs_g: 1, fat_g: 1 }] }),
      call("log_meal", { __invalid_json: "{oops" }),
      call("log_weight", { weight: 5, unit: "lb" }),
      call("log_weight", { weight: 180, unit: "stone" }),
      call("log_exercise", { exercise: "Squat", sets: [] }),
      call("log_meal", { meal: "lunch", date: "yesterday", items: [{ name: "x", kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }] }),
      call("not_a_tool", {}),
    ];
    for (const c of bad) {
      const r = await executeTool(ctx, c);
      expect(r.isError, c.name).toBe(true);
      expect(JSON.parse(r.content).error).toBeTruthy();
    }
    expect(await prisma.mealLog.count()).toBe(0);
    expect(await prisma.weightLog.count()).toBe(0);
    expect(await prisma.exerciseLog.count()).toBe(0);
  });

  it("coerces numeric strings from models", async () => {
    const u = await makeUser(TZ);
    const r = await executeTool({ userId: u.id, tz: TZ, now: NOW }, call("log_weight", { weight: "182.4", unit: "lb" }));
    expect(r.isError).toBe(false);
    expect((await prisma.weightLog.findFirstOrThrow()).weight).toBe(182.4);
  });

  it("log_exercise stores every set and returns the previous session", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    await executeTool(ctx, call("log_exercise", { exercise: "Bench Press", date: "2026-10-15", sets: [{ weight: 135, reps: 8, unit: "lb" }, { weight: 155, reps: 5, unit: "lb" }] }));
    const r = await executeTool(ctx, call("log_exercise", {
      exercise: "bench press",
      session_type: "push day",
      sets: [
        { weight: 155, reps: 6, unit: "lb" },
        { weight: 0, reps: 12, unit: "bodyweight", notes: "dips" },
        { weight: 25, reps: 12, unit: "lb", notes: "per arm" },
      ],
    }));
    const out = JSON.parse(r.content);
    expect(out.previous.summary).toBe("2026-10-15: 135x8, 155x5 lb");
    const row = await prisma.exerciseLog.findUniqueOrThrow({ where: { id: out.id } });
    expect(row.sessionType).toBe("push day");
    expect(JSON.parse(row.sets)).toHaveLength(3);
    expect(JSON.parse(row.sets)[2].notes).toBe("per arm");
  });

  it("log_weight returns change since last and the 7-day average", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    await executeTool(ctx, call("log_weight", { weight: 184, unit: "lb", date: "2026-10-14" }));
    await executeTool(ctx, call("log_weight", { weight: 183, unit: "lb", date: "2026-10-16" }));
    const out = JSON.parse((await executeTool(ctx, call("log_weight", { weight: 182.4, unit: "lb" }))).content);
    expect(out.change_since_last).toBe(-0.6);
    expect(out.avg_7d).toBe(183.1);
    const row = await prisma.weightLog.findUniqueOrThrow({ where: { id: out.id } });
    expect(row.weightKg).toBeCloseTo(82.736, 2);
  });

  it("update_profile merges fields and targets; null clears", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    await executeTool(ctx, call("update_profile", { fields: { age: 34, goal: "build muscle", injuries: "left knee", targets: { kcal: 2600, protein_g: 170 } } }));
    await executeTool(ctx, call("update_profile", { fields: { injuries: null, targets: { fiber_g: 35 } } }));
    const p = await getProfile(u.id);
    expect(p.data).toEqual({ age: 34, goal: "build muscle", targets: { kcal: 2600, protein_g: 170, fiber_g: 35 } });
  });

  it("save_plan and update_summary persist", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    await executeTool(ctx, call("save_plan", { plan: { days: [{ day: "Mon", focus: "Upper" }] }, text: "Mon: Upper" }));
    await executeTool(ctx, call("update_summary", { text: "Training for a 10k in December." }));
    expect((await prisma.plan.findFirstOrThrow({ where: { userId: u.id } })).text).toBe("Mon: Upper");
    expect((await getProfile(u.id)).summary).toBe("Training for a 10k in December.");
    const tooLong = await executeTool(ctx, call("update_summary", { text: "x".repeat(1300) }));
    expect(tooLong.isError).toBe(true);
  });

  it("get_logs returns compact rows with ids in range and filter", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    await executeTool(ctx, call("log_meal", { meal: "lunch", date: "2026-10-10", items: [{ name: "Chipotle burrito bowl", kcal: 750, protein_g: 45, carbs_g: 80, fat_g: 25 }] }));
    await executeTool(ctx, call("log_meal", { meal: "dinner", date: "2026-10-12", items: [{ name: "Salmon", kcal: 400, protein_g: 40, carbs_g: 0, fat_g: 25 }] }));
    const all = JSON.parse((await executeTool(ctx, call("get_logs", { type: "meals", from_date: "2026-10-01", to_date: "2026-10-18" }))).content);
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0]).toMatch(/^2026-10-10 m_\w+ 12:00 lunch: Chipotle burrito bowl \| 750 kcal P45 C80 F25 Fib0$/);
    const f = JSON.parse((await executeTool(ctx, call("get_logs", { type: "meals", from_date: "2026-10-01", to_date: "2026-10-18", filter: "SALMON" }))).content);
    expect(f.rows).toHaveLength(1);
  });

  it("isolates users: one user's tools cannot touch another's entries", async () => {
    const a = await makeUser(TZ);
    const b = await makeUser(TZ);
    const r = JSON.parse((await executeTool({ userId: a.id, tz: TZ, now: NOW }, call("log_weight", { weight: 180, unit: "lb" }))).content);
    const ctxB = { userId: b.id, tz: TZ, now: NOW };
    expect((await executeTool(ctxB, call("delete_entry", { entry_id: r.id }))).isError).toBe(true);
    expect((await executeTool(ctxB, call("edit_entry", { entry_id: r.id, changes: { weight: 100 } }))).isError).toBe(true);
    const logs = JSON.parse((await executeTool(ctxB, call("get_logs", { type: "weight", from_date: "2000-01-01", to_date: "2100-01-01" }))).content);
    expect(logs.rows).toHaveLength(0);
    expect((await prisma.weightLog.findUniqueOrThrow({ where: { id: r.id } })).weight).toBe(180);
  });
});
