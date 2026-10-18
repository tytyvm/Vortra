import { json, requireUser } from "@/lib/http";
import { todayView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  return json(await todayView(auth.user.id, auth.user.timezone));
}
