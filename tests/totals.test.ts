import { beforeEach, describe, expect, it } from "vitest";
import { createExercise, createMeal, createWeight, recentLines, todaySnapshot } from "@/lib/coach/logs";
import { dayLines, remaining, sevenDayAverage, sumItems, totalsOf, toKg } from "@/lib/coach/totals";
import { localDay, zonedToUtc } from "@/lib/time";
import { makeUser, NOW, resetDb } from "./helpers";

const TZ = "America/New_York";
const item = (kcal: number, p: number, c: number, f: number, fiber = 0) => ({ name: "x", portion: "", kcal, protein_g: p, carbs_g: c, fat_g: f, fiber_g: fiber });

describe("pure totals", () => {
  it("sums meal items and rounds", () => {
    expect(sumItems([item(144.4, 12.62, 0.8, 9.6), item(80, 3, 14, 1, 1.25)])).toEqual({ kcal: 224, protein_g: 15.6, carbs_g: 14.8, fat_g: 10.6, fiber_g: 1.3 });
  });

  it("computes remaining vs targets only for set targets", () => {
    const t = { kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 50, fiber_g: 20 };
    expect(remaining(t, { kcal: 2200, protein_g: 170 })).toEqual({ kcal: 700, protein_g: 70 });
    expect(remaining(t, null)).toBeNull();
  });

  it("builds one line per day, oldest first, with gaps", () => {
    const meals = [
      { id: "m_1", day: "2026-10-17", loggedAt: new Date(), meal: "lunch", items: "[]", kcal: 600, proteinG: 40, carbsG: 60, fatG: 20, fiberG: 8 },
      { id: "m_2", day: "2026-10-17", loggedAt: new Date(), meal: "dinner", items: "[]", kcal: 800, proteinG: 50, carbsG: 70, fatG: 30, fiberG: 10 },
      { id: "m_3", day: "2026-10-11", loggedAt: new Date(), meal: "dinner", items: "[]", kcal: 500, proteinG: 30, carbsG: 50, fatG: 15, fiberG: 5 },
      { id: "m_4", day: "2026-10-18", loggedAt: new Date(), meal: "dinner", items: "[]", kcal: 999, proteinG: 1, carbsG: 1, fatG: 1, fiberG: 1 }, // today: excluded
    ];
    const ex = [{ id: "x_1", day: "2026-10-16", loggedAt: new Date(), exercise: "Squat", sets: "[]" }];
    const w = [
      { id: "w_1", day: "2026-10-17", loggedAt: new Date("2026-10-17T11:00:00Z"), weight: 182.4, unit: "lb", weightKg: toKg(182.4, "lb") },
      { id: "w_0", day: "2026-10-17", loggedAt: new Date("2026-10-17T10:00:00Z"), weight: 183, unit: "lb", weightKg: toKg(183, "lb") },
    ];
    const lines = dayLines("2026-10-18", 7, meals, ex, w);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("2026-10-11 Sun: 500 kcal P30 C50 F15 Fib5");
    expect(lines[1]).toBe("2026-10-12 Mon: no food logged");
    expect(lines[5]).toBe("2026-10-16 Fri: no food logged | workout: Squat");
    expect(lines[6]).toBe("2026-10-17 Sat: 1400 kcal P90 C130 F50 Fib18 | weight 182.4 lb"); // latest weigh-in of the day
  });

  it("averages weights over the last 7 days in the requested unit", () => {
    const w = [
      { id: "a", day: "2026-10-18", loggedAt: new Date(), weight: 180, unit: "lb", weightKg: toKg(180, "lb") },
      { id: "b", day: "2026-10-14", loggedAt: new Date(), weight: 182, unit: "lb", weightKg: toKg(182, "lb") },
      { id: "c", day: "2026-10-11", loggedAt: new Date(), weight: 190, unit: "lb", weightKg: toKg(190, "lb") }, // 7 days back: excluded
    ];
    expect(sevenDayAverage(w, "2026-10-18", "lb")).toBe(181);
    expect(sevenDayAverage(w, "2026-10-18", "kg")).toBe(82.1);
    expect(sevenDayAverage([], "2026-10-18", "lb")).toBeNull();
  });

  it("totals of no meals are zero", () => {
    expect(totalsOf([])).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  });
});

describe("time zones", () => {
  it("assigns local days and converts local times to UTC", () => {
    expect(localDay(new Date("2026-10-19T02:30:00Z"), TZ)).toBe("2026-10-18");
    expect(zonedToUtc("2026-10-18", "08:15", TZ).toISOString()).toBe("2026-10-18T12:15:00.000Z");
    expect(zonedToUtc("2026-01-10", "08:15", TZ).toISOString()).toBe("2026-01-10T13:15:00.000Z"); // EST
  });
});

describe("totals from the database", () => {
  beforeEach(resetDb);

  it("computes today's totals and the 7-day lines from logs", async () => {
    const u = await makeUser(TZ);
    await createMeal(u.id, TZ, { meal: "breakfast", items: [item(300, 20, 30, 10, 4)] }, NOW);
    await createMeal(u.id, TZ, { meal: "lunch", items: [item(650, 45, 60, 22, 9), item(100, 1, 25, 0, 3)] }, NOW);
    await createMeal(u.id, TZ, { meal: "dinner", date: "2026-10-17", items: [item(900, 60, 80, 30, 10)] }, NOW);
    await createExercise(u.id, TZ, { exercise: "Deadlift", date: "2026-10-16", sets: [{ weight: 315, reps: 5, unit: "lb" }] }, NOW);
    await createWeight(u.id, TZ, { weight: 181.2, unit: "lb", date: "2026-10-15" }, NOW);

    const snap = await todaySnapshot(u.id, TZ, NOW);
    expect(snap.day).toBe("2026-10-18");
    expect(snap.totals).toEqual({ kcal: 1050, protein_g: 66, carbs_g: 115, fat_g: 32, fiber_g: 16 });
    expect(snap.meals).toHaveLength(2);
    expect(snap.lastWeight?.weight).toBe(181.2);

    const lines = await recentLines(u.id, TZ, NOW);
    expect(lines).toEqual([
      "2026-10-11 Sun: no food logged",
      "2026-10-12 Mon: no food logged",
      "2026-10-13 Tue: no food logged",
      "2026-10-14 Wed: no food logged",
      "2026-10-15 Thu: no food logged | weight 181.2 lb",
      "2026-10-16 Fri: no food logged | workout: Deadlift",
      "2026-10-17 Sat: 900 kcal P60 C80 F30 Fib10",
    ]);
  });
});
