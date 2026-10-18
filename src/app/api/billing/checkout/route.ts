import { createCheckout } from "@/lib/billing";
import { config } from "@/lib/config";
import { json, requireUser } from "@/lib/http";

export async function POST(req: Request) {
  if (!config().billing.enabled) return json({ error: "billing disabled" }, 404);
  const auth = await requireUser(req, { mutating: true });
  if ("error" in auth) return auth.error;
  return json({ url: await createCheckout(auth.user) });
}
