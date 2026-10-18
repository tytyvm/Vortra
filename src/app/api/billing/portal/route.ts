import { createPortal } from "@/lib/billing";
import { config } from "@/lib/config";
import { json, requireUser } from "@/lib/http";

export async function POST(req: Request) {
  if (!config().billing.enabled) return json({ error: "billing disabled" }, 404);
  const auth = await requireUser(req, { mutating: true });
  if ("error" in auth) return auth.error;
  if (!auth.user.stripeCustomerId) return json({ error: "no subscription" }, 400);
  return json({ url: await createPortal(auth.user.stripeCustomerId) });
}
