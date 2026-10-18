// The tools the model can call. Each call is validated with zod before touching the DB.
// Results are compact JSON with code-computed numbers (totals, remaining, averages) so
// the model reports accurate running totals.
import type { z } from "zod";
import { prisma } from "../db";
import type { ToolCall, ToolDef, ToolResult } from "../llm/types";
import { localDay } from "../time";
import {
  createExercise,
  createMeal,
  createWeight,
  deleteEntry,
  editEntry,
  EntryError,
  getLogs,
  previousExercise,
  todaySnapshot,
  weightStats,
} from "./logs";
import { getProfile, mergeProfile, saveProfile, saveSummary } from "./profile";
import {
  deleteEntryArgs,
  editEntryArgs,
  getLogsArgs,
  jsonSchema,
  logExerciseArgs,
  logMealArgs,
  logWeightArgs,
  savePlanArgs,
  updateProfileArgs,
  updateSummaryArgs,
  zodMessage,
} from "./schemas";
import { remaining } from "./totals";

interface ToolSpec {
  description: string;
  schema: z.ZodType;
}

const SPECS: Record<string, ToolSpec> = {
  log_meal: {
    description:
      "Log food the user ATE (not planned). One call per meal/snack with every item estimated. Returns the entry id, today's totals and what's left vs targets.",
    schema: logMealArgs,
  },
  log_exercise: {
    description:
      "Log one exercise with all its sets (weight x reps, bodyweight, per-arm, drop sets via notes, cardio via duration/distance). Returns the previous session of this exercise for a progression cue.",
    schema: logExerciseArgs,
  },
  log_weight: {
    description: "Log a weigh-in. Returns change since the previous weigh-in and the 7-day average.",
    schema: logWeightArgs,
  },
  edit_entry: { description: "Correct a logged meal, exercise or weight entry by id. Totals are recomputed.", schema: editEntryArgs },
  delete_entry: { description: "Delete a logged entry by id.", schema: deleteEntryArgs },
  get_logs: {
    description: "Fetch the user's logs for a date range (inclusive, local dates) as compact rows with ids. Use for questions about history.",
    schema: getLogsArgs,
  },
  update_profile: {
    description: "Save goals, stats, targets (kcal, protein_g, carbs_g, fat_g, fiber_g), preferences and injuries. Only send fields that change.",
    schema: updateProfileArgs,
  },
  save_plan: { description: "Save the user's current weekly training plan (replaces the previous one).", schema: savePlanArgs },
  update_summary: {
    description:
      "Replace the running summary of older conversation (max ~150 words): lasting context not already in the profile or logs, e.g. what they struggle with, upcoming events, what you agreed to try.",
    schema: updateSummaryArgs,
  },
};

export const TOOL_NAMES = Object.keys(SPECS);

let toolDefsCache: ToolDef[] | null = null;
export function toolDefs(): ToolDef[] {
  toolDefsCache ??= Object.entries(SPECS).map(([name, s]) => ({
    name,
    description: s.description,
    parameters: jsonSchema(s.schema),
  }));
  return toolDefsCache;
}

export interface ToolContext {
  userId: string;
  tz: string;
  now: Date;
}

async function todayPayload(ctx: ToolContext) {
  const [snap, profile] = await Promise.all([todaySnapshot(ctx.userId, ctx.tz, ctx.now), getProfile(ctx.userId)]);
  return { today: snap.totals, remaining: remaining(snap.totals, profile.data.targets) };
}

export async function executeTool(ctx: ToolContext, call: ToolCall): Promise<ToolResult> {
  const result = (content: unknown, isError = false): ToolResult => ({
    callId: call.id,
    name: call.name,
    content: JSON.stringify(content),
    isError,
  });
  const spec = SPECS[call.name];
  if (!spec) return result({ error: `unknown tool ${call.name}` }, true);
  const parsed = spec.schema.safeParse(call.args);
  if (!parsed.success) return result({ error: `invalid arguments: ${zodMessage(parsed.error)}` }, true);
  const a = parsed.data as any;

  try {
    switch (call.name) {
      case "log_meal": {
        const row = await createMeal(ctx.userId, ctx.tz, a, ctx.now);
        return result({
          ok: true,
          id: row.id,
          day: row.day,
          entry: { kcal: row.kcal, protein_g: row.proteinG, carbs_g: row.carbsG, fat_g: row.fatG, fiber_g: row.fiberG },
          ...(row.day === localDay(ctx.now, ctx.tz) ? await todayPayload(ctx) : {}),
        });
      }
      case "log_exercise": {
        const row = await createExercise(ctx.userId, ctx.tz, a, ctx.now);
        const previous = await previousExercise(ctx.userId, row.exercise, row.day);
        return result({ ok: true, id: row.id, day: row.day, entry: { exercise: row.exercise, sets: a.sets }, previous });
      }
      case "log_weight": {
        const row = await createWeight(ctx.userId, ctx.tz, a, ctx.now);
        const stats = await weightStats(ctx.userId, ctx.tz, row, ctx.now);
        return result({ ok: true, id: row.id, day: row.day, entry: { weight: row.weight, unit: row.unit }, ...stats });
      }
      case "edit_entry": {
        const { row } = await editEntry(ctx.userId, ctx.tz, a.entry_id, a.changes);
        return result({ ok: true, id: row.id, day: row.day, ...(await todayPayload(ctx)) });
      }
      case "delete_entry": {
        await deleteEntry(ctx.userId, a.entry_id);
        return result({ ok: true, deleted: a.entry_id, ...(await todayPayload(ctx)) });
      }
      case "get_logs": {
        if (a.from_date > a.to_date) return result({ error: "from_date is after to_date" }, true);
        return result(await getLogs(ctx.userId, ctx.tz, a.type, a.from_date, a.to_date, a.filter));
      }
      case "update_profile": {
        const current = await getProfile(ctx.userId);
        const next = mergeProfile(current.data, a.fields);
        await saveProfile(ctx.userId, next);
        return result({ ok: true, profile: next });
      }
      case "save_plan": {
        const row = await prisma.plan.create({ data: { userId: ctx.userId, data: JSON.stringify(a.plan), text: a.text } });
        return result({ ok: true, plan_id: row.id });
      }
      case "update_summary": {
        await saveSummary(ctx.userId, a.text.trim());
        return result({ ok: true });
      }
    }
    return result({ error: "unhandled tool" }, true);
  } catch (e) {
    if (e instanceof EntryError) return result({ error: e.message }, true);
    throw e;
  }
}
