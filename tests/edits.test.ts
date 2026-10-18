import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { executeTool } from "@/lib/coach/tools";
import { todaySnapshot } from "@/lib/coach/logs";
import { makeUser, NOW, resetDb } from "./helpers";

const TZ = "America/New_York";
const call = (name: string, args: unknown) => ({ id: "c", name, args });
const egg = (n: number) => ({ name: "Egg", portion: `${n} large`, kcal: 72 * n, protein_g: 6 * n, carbs_g: 0.5 * n, fat_g: 5 * n });

describe("edits and deletes re-total", () => {
  beforeEach(resetDb);

  it("editing items recomputes the entry and today's totals", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    const m1 = JSON.parse((await executeTool(ctx, call("log_meal", { meal: "breakfast", items: [egg(3)] }))).content);
    await executeTool(ctx, call("log_meal", { meal: "snack", items: [{ name: "Apple", kcal: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3, fiber_g: 4.4 }] }));
    expect((await todaySnapshot(u.id, TZ, NOW)).totals.kcal).toBe(216 + 95);

    const r = JSON.parse((await executeTool(ctx, call("edit_entry", { entry_id: m1.id, changes: { items: [egg(2)] } }))).content);
    expect(r.today.kcal).toBe(144 + 95);
    const row = await prisma.mealLog.findUniqueOrThrow({ where: { id: m1.id } });
    expect(row).toMatchObject({ kcal: 144, proteinG: 12, fatG: 10 });
  });

  it("deleting an entry removes it from totals", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    const m1 = JSON.parse((await executeTool(ctx, call("log_meal", { meal: "breakfast", items: [egg(3)] }))).content);
    await executeTool(ctx, call("log_meal", { meal: "lunch", items: [egg(1)] }));
    const r = JSON.parse((await executeTool(ctx, call("delete_entry", { entry_id: m1.id }))).content);
    expect(r.today.kcal).toBe(72);
    expect(await prisma.mealLog.count({ where: { userId: u.id } })).toBe(1);
  });

  it("moving an entry to another day moves its totals", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    const m = JSON.parse((await executeTool(ctx, call("log_meal", { meal: "dinner", items: [egg(2)] }))).content);
    const r = JSON.parse((await executeTool(ctx, call("edit_entry", { entry_id: m.id, changes: { date: "2026-10-17", time: "19:30" } }))).content);
    expect(r.today.kcal).toBe(0);
    const row = await prisma.mealLog.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.day).toBe("2026-10-17");
    expect(row.loggedAt.toISOString()).toBe("2026-10-17T23:30:00.000Z");
  });

  it("editing a weight recomputes kg; invalid changes are rejected", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    const w = JSON.parse((await executeTool(ctx, call("log_weight", { weight: 180, unit: "lb" }))).content);
    await executeTool(ctx, call("edit_entry", { entry_id: w.id, changes: { weight: 82, unit: "kg" } }));
    expect((await prisma.weightLog.findUniqueOrThrow({ where: { id: w.id } })).weightKg).toBe(82);
    const bad = await executeTool(ctx, call("edit_entry", { entry_id: w.id, changes: { weight: -3 } }));
    expect(bad.isError).toBe(true);
    const unknown = await executeTool(ctx, call("edit_entry", { entry_id: "q_123", changes: {} }));
    expect(unknown.isError).toBe(true);
  });

  it("editing exercise sets replaces them", async () => {
    const u = await makeUser(TZ);
    const ctx = { userId: u.id, tz: TZ, now: NOW };
    const x = JSON.parse((await executeTool(ctx, call("log_exercise", { exercise: "Squat", sets: [{ weight: 225, reps: 5, unit: "lb" }] }))).content);
    await executeTool(ctx, call("edit_entry", { entry_id: x.id, changes: { sets: [{ weight: 225, reps: 5, unit: "lb" }, { weight: 245, reps: 3, unit: "lb" }] } }));
    expect(JSON.parse((await prisma.exerciseLog.findUniqueOrThrow({ where: { id: x.id } })).sets)).toHaveLength(2);
  });
});
