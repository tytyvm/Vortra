import crypto from "node:crypto";
import { runRecaps } from "@/lib/coach/recaps";
import { config } from "@/lib/config";
import { json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Call hourly from your scheduler: POST with "Authorization: Bearer $CRON_SECRET". */
export async function POST(req: Request) {
  const c = config().recaps;
  if (!c.enabled) return json({ error: "recaps disabled" }, 404);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${c.cronSecret}`);
  if (!c.cronSecret || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return json({ error: "unauthorized" }, 401);
  }
  return json(await runRecaps());
}
