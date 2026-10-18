// Pure functions: totals, compact lines and day summaries computed from log rows.
import { addDays, weekdayOf } from "../time";

export interface Macros {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface MealRow {
  id: string;
  day: string;
  loggedAt: Date;
  meal: string;
  items: string; // JSON
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  notes?: string | null;
}
export interface ExerciseRow {
  id: string;
  day: string;
  loggedAt: Date;
  exercise: string;
  sets: string; // JSON
  sessionType?: string | null;
  notes?: string | null;
}
export interface WeightRow {
  id: string;
  day: string;
  loggedAt: Date;
  weight: number;
  unit: string;
  weightKg: number;
  notes?: string | null;
}

export interface MealItem {
  name: string;
  portion?: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  sugar_g?: number;
}
export interface SetRow {
  weight?: number;
  reps?: number;
  unit?: string;
  duration_min?: number;
  distance?: number;
  distance_unit?: string;
  notes?: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export const KG_PER_LB = 0.45359237;
export const toKg = (w: number, unit: string) => (unit === "kg" ? w : w * KG_PER_LB);
export const fromKg = (kg: number, unit: string) => (unit === "kg" ? kg : kg / KG_PER_LB);

export function sumItems(items: MealItem[]): Macros {
  const t = items.reduce(
    (a, i) => ({
      kcal: a.kcal + (i.kcal || 0),
      protein_g: a.protein_g + (i.protein_g || 0),
      carbs_g: a.carbs_g + (i.carbs_g || 0),
      fat_g: a.fat_g + (i.fat_g || 0),
      fiber_g: a.fiber_g + (i.fiber_g || 0),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  );
  return roundMacros(t);
}

export function roundMacros(t: Macros): Macros {
  return { kcal: Math.round(t.kcal), protein_g: r1(t.protein_g), carbs_g: r1(t.carbs_g), fat_g: r1(t.fat_g), fiber_g: r1(t.fiber_g) };
}

export function totalsOf(meals: Pick<MealRow, "kcal" | "proteinG" | "carbsG" | "fatG" | "fiberG">[]): Macros {
  return roundMacros(
    meals.reduce(
      (a, m) => ({
        kcal: a.kcal + m.kcal,
        protein_g: a.protein_g + m.proteinG,
        carbs_g: a.carbs_g + m.carbsG,
        fat_g: a.fat_g + m.fatG,
        fiber_g: a.fiber_g + m.fiberG,
      }),
      { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    ),
  );
}

export function remaining(totals: Macros, targets?: Partial<Macros> | null): Partial<Macros> | null {
  if (!targets) return null;
  const out: Partial<Macros> = {};
  for (const k of ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const) {
    const t = targets[k];
    if (typeof t === "number") out[k] = k === "kcal" ? Math.round(t - totals[k]) : r1(t - totals[k]);
  }
  return Object.keys(out).length ? out : null;
}

export function parseJSON<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function formatSet(s: SetRow): string {
  const parts: string[] = [];
  if (s.unit === "bodyweight" || (!s.weight && s.reps)) parts.push(s.weight ? `BW+${s.weight}x${s.reps}` : `BWx${s.reps}`);
  else if (s.weight || s.reps) parts.push(`${s.weight ?? 0}x${s.reps ?? 0}`);
  if (s.duration_min) parts.push(`${s.duration_min}min`);
  if (s.distance) parts.push(`${s.distance}${s.distance_unit ?? ""}`);
  let out = parts.join(" ");
  if (s.notes) out += ` (${s.notes})`;
  return out || "set";
}

export function formatSets(setsJson: string): string {
  const sets = parseJSON<SetRow[]>(setsJson, []);
  const unit = sets.find((s) => s.unit && s.unit !== "bodyweight")?.unit;
  return sets.map(formatSet).join(", ") + (unit ? ` ${unit}` : "");
}

const hhmm = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export function mealLine(m: MealRow, tz: string): string {
  const items = parseJSON<MealItem[]>(m.items, []);
  const names = items.map((i) => (i.portion ? `${i.name} (${i.portion})` : i.name)).join("; ");
  return `${m.id} ${hhmm(m.loggedAt, tz)} ${m.meal}: ${names} | ${Math.round(m.kcal)} kcal P${r1(m.proteinG)} C${r1(m.carbsG)} F${r1(m.fatG)} Fib${r1(m.fiberG)}`;
}

export function exerciseLine(x: ExerciseRow, tz: string): string {
  return `${x.id} ${hhmm(x.loggedAt, tz)} ${x.exercise}${x.sessionType ? ` [${x.sessionType}]` : ""}: ${formatSets(x.sets)}`;
}

export function weightLine(w: WeightRow, tz: string): string {
  return `${w.id} ${hhmm(w.loggedAt, tz)} ${w.weight} ${w.unit}`;
}

/**
 * One compact line per day for the `days` days BEFORE `today`, oldest first.
 * e.g. "2026-10-12 Mon: 2150 kcal P160 C200 F70 Fib30 | workout: Bench press, Squat | weight 182.4 lb"
 */
export function dayLines(
  today: string,
  days: number,
  meals: MealRow[],
  exercises: ExerciseRow[],
  weights: WeightRow[],
): string[] {
  const lines: string[] = [];
  for (let i = days; i >= 1; i--) {
    const d = addDays(today, -i);
    const dm = meals.filter((m) => m.day === d);
    const dx = exercises.filter((x) => x.day === d);
    const dw = weights.filter((w) => w.day === d).sort((a, b) => +a.loggedAt - +b.loggedAt);
    const parts: string[] = [];
    if (dm.length) {
      const t = totalsOf(dm);
      parts.push(`${t.kcal} kcal P${t.protein_g} C${t.carbs_g} F${t.fat_g} Fib${t.fiber_g}`);
    } else parts.push("no food logged");
    if (dx.length) parts.push(`workout: ${[...new Set(dx.map((x) => x.exercise))].join(", ")}`);
    if (dw.length) {
      const w = dw[dw.length - 1];
      parts.push(`weight ${w.weight} ${w.unit}`);
    }
    lines.push(`${d} ${weekdayOf(d)}: ${parts.join(" | ")}`);
  }
  return lines;
}

/** Mean weight (in `unit`) of entries whose day is within the 7 days ending `today`. */
export function sevenDayAverage(weights: WeightRow[], today: string, unit: string): number | null {
  const from = addDays(today, -6);
  const w = weights.filter((x) => x.day >= from && x.day <= today);
  if (!w.length) return null;
  return r1(w.reduce((a, x) => a + fromKg(x.weightKg, unit), 0) / w.length);
}
