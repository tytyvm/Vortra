import { json, requireUser } from "@/lib/http";
import { historyView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 14));
  return json({ days: await historyView(auth.user.id, auth.user.timezone, days) });
}
