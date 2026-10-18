import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

/** GET ?format=json (everything) or ?format=csv&table=meals|exercise|weight|messages|plans */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.user.id;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";
  const omitUser = { userId: false } as const;
  const [profile, messages, meals, exercise, weight, plans, usage] = await Promise.all([
    prisma.profile.findUnique({ where: { userId }, omit: omitUser }),
    prisma.message.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, omit: omitUser }),
    prisma.mealLog.findMany({ where: { userId }, orderBy: { loggedAt: "asc" }, omit: omitUser }),
    prisma.exerciseLog.findMany({ where: { userId }, orderBy: { loggedAt: "asc" }, omit: omitUser }),
    prisma.weightLog.findMany({ where: { userId }, orderBy: { loggedAt: "asc" }, omit: omitUser }),
    prisma.plan.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, omit: omitUser }),
    prisma.usage.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, omit: omitUser }),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const tables: Record<string, Record<string, unknown>[]> = { meals, exercise, weight, messages, plans, usage };
    const table = url.searchParams.get("table") ?? "meals";
    if (!tables[table]) return new Response("unknown table", { status: 400 });
    return new Response(csv(tables[table]), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="vortra-${table}-${stamp}.csv"` },
    });
  }
  const data = {
    exportedAt: new Date().toISOString(),
    account: { email: auth.user.email, timezone: auth.user.timezone, createdAt: auth.user.createdAt, plan: auth.user.plan },
    profile: profile ? { ...profile, data: JSON.parse(profile.data) } : null,
    meals: meals.map((m) => ({ ...m, items: JSON.parse(m.items) })),
    exercise: exercise.map((x) => ({ ...x, sets: JSON.parse(x.sets) })),
    weight,
    plans: plans.map((p) => ({ ...p, data: JSON.parse(p.data) })),
    messages,
    usage,
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="vortra-export-${stamp}.json"` },
  });
}
