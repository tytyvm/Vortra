// Data shaped for the UI (Today panel and History page).
import { prisma } from "./db";
import { todaySnapshot } from "./coach/logs";
import { getProfile } from "./coach/profile";
import { formatSets, parseJSON, totalsOf, type MealItem, type SetRow } from "./coach/totals";
import { addDays, localDay, localTime } from "./time";

export async function todayView(userId: string, tz: string) {
  const [snap, profile] = await Promise.all([todaySnapshot(userId, tz), getProfile(userId)]);
  return {
    day: snap.day,
    totals: snap.totals,
    targets: profile.data.targets ?? null,
    exercises: snap.exercises.map((x) => ({ id: x.id, exercise: x.exercise, summary: formatSets(x.sets) })),
    lastWeight: snap.lastWeight ? { weight: snap.lastWeight.weight, unit: snap.lastWeight.unit, day: snap.lastWeight.day } : null,
  };
}
export type TodayView = Awaited<ReturnType<typeof todayView>>;

export async function historyView(userId: string, tz: string, days: number) {
  const today = localDay(new Date(), tz);
  const from = addDays(today, -(days - 1));
  const where = { userId, day: { gte: from, lte: today } };
  const [meals, exercises, weights] = await Promise.all([
    prisma.mealLog.findMany({ where, orderBy: { loggedAt: "asc" } }),
    prisma.exerciseLog.findMany({ where, orderBy: { loggedAt: "asc" } }),
    prisma.weightLog.findMany({ where, orderBy: { loggedAt: "asc" } }),
  ]);
  const dayKeys = [...new Set([...meals, ...exercises, ...weights].map((r) => r.day))].sort().reverse();
  return dayKeys.map((day) => {
    const dm = meals.filter((m) => m.day === day);
    return {
      day,
      totals: totalsOf(dm),
      meals: dm.map((m) => ({
        id: m.id,
        time: localTime(m.loggedAt, tz),
        meal: m.meal,
        items: parseJSON<MealItem[]>(m.items, []),
        kcal: m.kcal,
        protein_g: m.proteinG,
        carbs_g: m.carbsG,
        fat_g: m.fatG,
        fiber_g: m.fiberG,
        notes: m.notes,
      })),
      exercises: exercises
        .filter((x) => x.day === day)
        .map((x) => ({ id: x.id, time: localTime(x.loggedAt, tz), exercise: x.exercise, sessionType: x.sessionType, sets: parseJSON<SetRow[]>(x.sets, []), notes: x.notes })),
      weights: weights
        .filter((w) => w.day === day)
        .map((w) => ({ id: w.id, time: localTime(w.loggedAt, tz), weight: w.weight, unit: w.unit, notes: w.notes })),
    };
  });
}
export type HistoryDay = Awaited<ReturnType<typeof historyView>>[number];
