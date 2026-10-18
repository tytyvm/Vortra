// Tool argument schemas. Defined once with zod: used to validate every tool call before
// anything is written to the DB, and converted to JSON Schema for the model.
import { z } from "zod";
import { DAY_RE, TIME_RE } from "../time";

const num = (max: number) => z.coerce.number().min(0).max(max);
const day = z.string().regex(DAY_RE, "use YYYY-MM-DD").describe("Local date YYYY-MM-DD. Omit for today.");
const time = z.string().regex(TIME_RE, "use HH:MM 24h").describe("Local time HH:MM (24h). Omit for now.");
const notes = z.string().max(300);

export const MEALS = ["breakfast", "lunch", "dinner", "snack", "other"] as const;

export const mealItem = z.object({
  name: z.string().min(1).max(120).describe("Food name, with brand/restaurant if known"),
  portion: z.string().max(120).default("").describe('Portion with the assumption stated, e.g. "4 oz cooked (assumed)"'),
  kcal: num(5000),
  protein_g: num(500),
  carbs_g: num(1000),
  fat_g: num(500),
  fiber_g: num(200).optional(),
  sugar_g: num(500).optional(),
});

export const logMealArgs = z.object({
  items: z.array(mealItem).min(1).max(40),
  meal: z.enum(MEALS),
  date: day.optional(),
  time: time.optional(),
  notes: notes.optional(),
});

export const exerciseSet = z.object({
  weight: num(2000).default(0).describe("Load per set (per dumbbell for DB work). 0 for bodyweight."),
  reps: z.coerce.number().int().min(0).max(1000).default(0),
  unit: z.enum(["lb", "kg", "bodyweight"]).default("lb"),
  duration_min: num(1440).optional().describe("For timed or cardio sets"),
  distance: num(1000).optional(),
  distance_unit: z.enum(["mi", "km", "m"]).optional(),
  notes: z.string().max(120).optional().describe('e.g. "drop set", "per arm", "RPE 8", "assisted"'),
});

export const logExerciseArgs = z.object({
  exercise: z.string().min(1).max(100),
  sets: z.array(exerciseSet).min(1).max(50),
  session_type: z.string().max(60).optional().describe('e.g. "push day", "leg day", "run"'),
  date: day.optional(),
  time: time.optional(),
  notes: notes.optional(),
});

export const logWeightArgs = z.object({
  weight: z.coerce.number().min(20).max(1500),
  unit: z.enum(["lb", "kg"]),
  date: day.optional(),
  time: time.optional(),
  notes: notes.optional(),
});

export const mealChanges = logMealArgs.partial();
export const exerciseChanges = logExerciseArgs.partial();
export const weightChanges = logWeightArgs.partial();

export const editEntryArgs = z.object({
  entry_id: z.string().min(3).max(40).describe('Entry id like "m_ab12cd34ef56" from the log lists or get_logs'),
  changes: z
    .record(z.string(), z.unknown())
    .describe(
      "Fields to change. Meals: items (full replacement list), meal, date, time, notes. " +
        "Exercise: exercise, sets (full replacement list), session_type, date, time, notes. Weight: weight, unit, date, time, notes.",
    ),
});

export const deleteEntryArgs = z.object({ entry_id: z.string().min(3).max(40) });

export const getLogsArgs = z.object({
  type: z.enum(["meals", "exercise", "weight"]),
  from_date: z.string().regex(DAY_RE),
  to_date: z.string().regex(DAY_RE),
  filter: z.string().max(60).optional().describe("Case-insensitive text match on food, meal or exercise name"),
});

const statValue = z.union([z.string().max(200), z.number(), z.null()]);

export const targets = z.object({
  kcal: num(10000).optional(),
  protein_g: num(1000).optional(),
  carbs_g: num(2000).optional(),
  fat_g: num(1000).optional(),
  fiber_g: num(300).optional(),
});

export const profileFields = z
  .object({
    name: statValue.optional().describe("What the user likes to be called"),
    age: statValue.optional(),
    sex: statValue.optional(),
    height: statValue.optional().describe('e.g. "5 ft 10 in" or "178 cm"'),
    weight: statValue.optional().describe("Starting/current weight with unit"),
    units: z.enum(["imperial", "metric"]).nullable().optional(),
    activity_level: statValue.optional(),
    training_frequency: statValue.optional(),
    experience: statValue.optional(),
    equipment: statValue.optional(),
    schedule: statValue.optional(),
    goal: statValue.optional().describe("lose fat | build muscle | maintain | performance, plus details"),
    maintenance_kcal: statValue.optional(),
    targets: targets.nullable().optional(),
    food_preferences: statValue.optional(),
    injuries: statValue.optional(),
    notes: statValue.optional().describe("Anything else relevant and lasting"),
  })
  .describe("Only include fields that change. null clears a field.");

export const updateProfileArgs = z.object({ fields: profileFields });

export const savePlanArgs = z.object({
  plan: z
    .record(z.string(), z.unknown())
    .describe("Structured plan, e.g. {name, days_per_week, days:[{day, focus, exercises:[{name, sets, reps, notes}]}], progression}"),
  text: z.string().min(1).max(4000).describe("The same plan as short readable text"),
});

export const updateSummaryArgs = z.object({
  text: z.string().max(1200).describe("Running summary of older conversation, max ~150 words"),
});

export type LogMealArgs = z.infer<typeof logMealArgs>;
export type LogExerciseArgs = z.infer<typeof logExerciseArgs>;
export type LogWeightArgs = z.infer<typeof logWeightArgs>;
export type ProfileFields = z.infer<typeof profileFields>;

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return tidy(js) as Record<string, unknown>;
}

// Fields with defaults are optional for the model; drop keywords some providers dislike.
function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== "object") return node;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) if (k !== "propertyNames") o[k] = tidy(v);
  const props = o.properties as Record<string, Record<string, unknown>> | undefined;
  if (props && Array.isArray(o.required)) {
    o.required = (o.required as string[]).filter((k) => !(props[k] && "default" in props[k]));
  }
  return o;
}

/** Turn a zod error into a short message the model can act on. */
export function zodMessage(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "args"}: ${i.message}`)
    .join("; ");
}
