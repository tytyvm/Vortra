import { handleStripeEvent, verifyStripeSignature } from "@/lib/billing";
import { config } from "@/lib/config";
import { json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const c = config().billing;
  if (!c.enabled) return json({ error: "billing disabled" }, 404);
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!c.webhookSecret || !verifyStripeSignature(payload, sig, c.webhookSecret)) return json({ error: "bad signature" }, 400);
  await handleStripeEvent(JSON.parse(payload));
  return json({ received: true });
}
