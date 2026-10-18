// Database operations for meal, exercise and weight logs. Shared by the model's tools
// and the History page so both paths validate and re-total the same way.
import { prisma } from "../db";
import { newId } from "../ids";
import { addDays, localDay, localTime, zonedToUtc } from "../time";
import {
  exerciseChanges,
  logExerciseArgs,
  logMealArgs,
  logWeightArgs,
  mealChanges,
  weightChanges,
  type LogExerciseArgs,
  type LogMealArgs,
  type LogWeightArgs,
} from "./schemas";
import {
  dayLines,
  exerciseLine,
  formatSets,
  mealLine,
  parseJSON,
  sevenDayAverage,
  sumItems,
  toKg,
  fromKg,
  totalsOf,
  weightLine,
  type MealItem,
} from "./totals";

export class EntryError extends Error {}

export function resolveWhen(tz: string, now: Date, date?: string, time?: string) {
  const today = localDay(now, tz);
  const day = date ?? today;
  const t = time ?? (day === today ? localTime(now, tz) : "12:00");
  return { day, loggedAt: zonedToUtc(day, t, tz) };
}

export async function createMeal(userId: string, tz: string, args: LogMealArgs, now = new Date()) {
  const { day, loggedAt } = resolveWhen(tz, now, args.date, args.time);
  const t = sumItems(args.items as MealItem[]);
  return prisma.mealLog.create({
    data: {
      id: newId("m"),
      userId,
      day,
      loggedAt,
      meal: args.meal,
      items: JSON.stringify(args.items),
      kcal: t.kcal,
      proteinG: t.protein_g,
      carbsG: t.carbs_g,
      fatG: t.fat_g,
      fiberG: t.fiber_g,
      notes: args.notes ?? null,
    },
  });
}

export async function createExercise(userId: string, tz: string, args: LogExerciseArgs, now = new Date()) {
  const { day, loggedAt } = resolveWhen(tz, now, args.date, args.time);
  return prisma.exerciseLog.create({
    data: {
      id: newId("x"),
      userId,
      day,
      loggedAt,
      exercise: args.exercise.trim(),
      sets: JSON.stringify(args.sets),
      sessionType: args.session_type ?? null,
      notes: args.notes ?? null,
    },
  });
}

export async function createWeight(userId: string, tz: string, args: LogWeightArgs, now = new Date()) {
  const { day, loggedAt } = resolveWhen(tz, now, args.date, args.time);
  return prisma.weightLog.create({
    data: {
      id: newId("w"),
      userId,
      day,
      loggedAt,
      weight: args.weight,
      unit: args.unit,
      weightKg: toKg(args.weight, args.unit),
      notes: args.notes ?? null,
    },
  });
}

export function entryType(id: string): "meal" | "exercise" | "weight" | null {
  if (id.startsWith("m_")) return "meal";
  if (id.startsWith("x_")) return "exercise";
  if (id.startsWith("w_")) return "weight";
  return null;
}

/** Validate and apply changes to one of the user's entries. Throws EntryError with a readable message. */
export async function editEntry(userId: string, tz: string, id: string, changes: unknown) {
  const type = entryType(id);
  if (type === "meal") {
    const row = await prisma.mealLog.findFirst({ where: { id, userId } });
    if (!row) throw new EntryError(`no meal entry ${id}`);
    const c = mealChanges.safeParse(changes);
    if (!c.success) throw new EntryError(c.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const data: Record<string, unknown> = {};
    if (c.data.items) {
      const t = sumItems(c.data.items as MealItem[]);
      Object.assign(data, { items: JSON.stringify(c.data.items), kcal: t.kcal, proteinG: t.protein_g, carbsG: t.carbs_g, fatG: t.fat_g, fiberG: t.fiber_g });
    }
    if (c.data.meal) data.meal = c.data.meal;
    if (c.data.notes !== undefined) data.notes = c.data.notes;
    Object.assign(data, moveWhen(row, tz, c.data.date, c.data.time));
    return { type, row: await prisma.mealLog.update({ where: { id }, data }) };
  }
  if (type === "exercise") {
    const row = await prisma.exerciseLog.findFirst({ where: { id, userId } });
    if (!row) throw new EntryError(`no exercise entry ${id}`);
    const c = exerciseChanges.safeParse(changes);
    if (!c.success) throw new EntryError(c.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const data: Record<string, unknown> = {};
    if (c.data.exercise) data.exercise = c.data.exercise.trim();
    if (c.data.sets) data.sets = JSON.stringify(c.data.sets);
    if (c.data.session_type !== undefined) data.sessionType = c.data.session_type;
    if (c.data.notes !== undefined) data.notes = c.data.notes;
    Object.assign(data, moveWhen(row, tz, c.data.date, c.data.time));
    return { type, row: await prisma.exerciseLog.update({ where: { id }, data }) };
  }
  if (type === "weight") {
    const row = await prisma.weightLog.findFirst({ where: { id, userId } });
    if (!row) throw new EntryError(`no weight entry ${id}`);
    const c = weightChanges.safeParse(changes);
    if (!c.success) throw new EntryError(c.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const weight = c.data.weight ?? row.weight;
    const unit = c.data.unit ?? row.unit;
    const data: Record<string, unknown> = { weight, unit, weightKg: toKg(weight, unit) };
    if (c.data.notes !== undefined) data.notes = c.data.notes;
    Object.assign(data, moveWhen(row, tz, c.data.date, c.data.time));
    return { type, row: await prisma.weightLog.update({ where: { id }, data }) };
  }
  throw new EntryError(`unknown entry id ${id}`);
}

function moveWhen(row: { day: string; loggedAt: Date }, tz: string, date?: string, time?: string) {
  if (!date && !time) return {};
  const day = date ?? row.day;
  const t = time ?? localTime(row.loggedAt, tz);
  return { day, loggedAt: zonedToUtc(day, t, tz) };
}

export async function deleteEntry(userId: string, id: string) {
  const type = entryType(id);
  const where = { id, userId };
  const n =
    type === "meal"
      ? await prisma.mealLog.deleteMany({ where })
      : type === "exercise"
        ? await prisma.exerciseLog.deleteMany({ where })
        : type === "weight"
          ? await prisma.weightLog.deleteMany({ where })
          : { count: 0 };
  if (!n.count) throw new EntryError(`no entry ${id}`);
  return { type };
}

const MAX_ROWS = 300;

export async function getLogs(
  userId: string,
  tz: string,
  type: "meals" | "exercise" | "weight",
  from: string,
  to: string,
  filter?: string,
) {
  const where = { userId, day: { gte: from, lte: to } };
  const f = filter?.toLowerCase();
  if (type === "meals") {
    const rows = await prisma.mealLog.findMany({ where, orderBy: { loggedAt: "asc" }, take: 2000 });
    const hit = f ? rows.filter((r) => r.items.toLowerCase().includes(f) || r.meal.includes(f)) : rows;
    return { rows: hit.slice(-MAX_ROWS).map((r) => `${r.day} ${mealLine(r, tz)}`), truncated: hit.length > MAX_ROWS };
  }
  if (type === "exercise") {
    const rows = await prisma.exerciseLog.findMany({ where, orderBy: { loggedAt: "asc" }, take: 2000 });
    const hit = f ? rows.filter((r) => r.exercise.toLowerCase().includes(f) || (r.sessionType ?? "").toLowerCase().includes(f)) : rows;
    return { rows: hit.slice(-MAX_ROWS).map((r) => `${r.day} ${exerciseLine(r, tz)}`), truncated: hit.length > MAX_ROWS };
  }
  const rows = await prisma.weightLog.findMany({ where, orderBy: { loggedAt: "asc" }, take: 2000 });
  return { rows: rows.slice(-MAX_ROWS).map((r) => `${r.day} ${weightLine(r, tz)}`), truncated: rows.length > MAX_ROWS };
}

/** Today's entries and totals, computed from the logs. */
export async function todaySnapshot(userId: string, tz: string, now = new Date()) {
  const day = localDay(now, tz);
  const [meals, exercises, weights, lastWeight] = await Promise.all([
    prisma.mealLog.findMany({ where: { userId, day }, orderBy: { loggedAt: "asc" } }),
    prisma.exerciseLog.findMany({ where: { userId, day }, orderBy: { loggedAt: "asc" } }),
    prisma.weightLog.findMany({ where: { userId, day }, orderBy: { loggedAt: "asc" } }),
    prisma.weightLog.findFirst({ where: { userId }, orderBy: { loggedAt: "desc" } }),
  ]);
  return { day, totals: totalsOf(meals), meals, exercises, weights, lastWeight };
}

export async function recentLines(userId: string, tz: string, now = new Date(), days = 7) {
  const today = localDay(now, tz);
  const from = addDays(today, -days);
  const where = { userId, day: { gte: from, lt: today } };
  const [meals, exercises, weights] = await Promise.all([
    prisma.mealLog.findMany({ where }),
    prisma.exerciseLog.findMany({ where }),
    prisma.weightLog.findMany({ where }),
  ]);
  return dayLines(today, days, meals, exercises, weights);
}

/** Weight stats for the reply after a weigh-in: change vs previous entry and 7-day average. */
export async function weightStats(userId: string, tz: string, entry: { id: string; unit: string; weightKg: number; loggedAt: Date }, now = new Date()) {
  const today = localDay(now, tz);
  const prev = await prisma.weightLog.findFirst({
    where: { userId, id: { not: entry.id }, loggedAt: { lte: entry.loggedAt } },
    orderBy: { loggedAt: "desc" },
  });
  const recent = await prisma.weightLog.findMany({ where: { userId, day: { gte: addDays(today, -6), lte: today } } });
  const change = prev ? Math.round((fromKg(entry.weightKg, entry.unit) - fromKg(prev.weightKg, entry.unit)) * 10) / 10 : null;
  return {
    change_since_last: change,
    previous: prev ? { day: prev.day, weight: Math.round(fromKg(prev.weightKg, entry.unit) * 10) / 10 } : null,
    avg_7d: sevenDayAverage(recent, today, entry.unit),
    entries_in_avg: recent.length,
  };
}

/** Most recent earlier session of the same exercise (different day), for progression cues. */
export async function previousExercise(userId: string, exercise: string, beforeDay: string) {
  const rows = await prisma.exerciseLog.findMany({
    where: { userId, day: { lt: beforeDay } },
    orderBy: { loggedAt: "desc" },
    take: 300,
  });
  const name = exercise.trim().toLowerCase();
  const hit = rows.filter((r) => r.exercise.toLowerCase() === name);
  if (!hit.length) return null;
  const lastDay = hit[0].day;
  const sameDay = hit.filter((r) => r.day === lastDay).reverse();
  return { day: lastDay, summary: `${lastDay}: ${sameDay.map((r) => formatSets(r.sets)).join(" + ")}` };
}

export { logMealArgs, logExerciseArgs, logWeightArgs, parseJSON };
