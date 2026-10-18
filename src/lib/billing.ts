// Optional Stripe subscriptions (STRIPE_ENABLED=true). Uses Stripe's REST API via fetch.
// When disabled, nothing here is ever called.
import crypto from "node:crypto";
import { config } from "./config";
import { prisma } from "./db";

async function stripe(path: string, params: Record<string, string>) {
  const c = config().billing;
  if (!c.enabled) throw new Error("billing disabled");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`stripe ${path} failed (${res.status})`);
  return res.json() as Promise<{ url: string }>;
}

export async function createCheckout(user: { id: string; email: string; stripeCustomerId: string | null }) {
  const c = config();
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": c.billing.priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: user.id,
    success_url: `${c.appUrl}/settings?billing=success`,
    cancel_url: `${c.appUrl}/settings`,
  };
  if (user.stripeCustomerId) params.customer = user.stripeCustomerId;
  else params.customer_email = user.email;
  return (await stripe("checkout/sessions", params)).url;
}

export async function createPortal(customerId: string) {
  return (await stripe("billing_portal/sessions", { customer: customerId, return_url: `${config().appUrl}/settings` })).url;
}

/** Verify a Stripe-Signature header (t=...,v1=...) against the raw body. */
export function verifyStripeSignature(payload: string, header: string, secret: string, toleranceSec = 300, now = Date.now()) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export async function handleStripeEvent(event: { type: string; data: { object: any } }) {
  const o = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      if (o.client_reference_id) {
        await prisma.user.updateMany({
          where: { id: o.client_reference_id },
          data: { plan: "pro", stripeCustomerId: o.customer ?? undefined },
        });
      }
      break;
    case "customer.subscription.updated":
    case "customer.subscription.created":
      await prisma.user.updateMany({
        where: { stripeCustomerId: o.customer },
        data: { plan: ["active", "trialing"].includes(o.status) ? "pro" : "free" },
      });
      break;
    case "customer.subscription.deleted":
      await prisma.user.updateMany({ where: { stripeCustomerId: o.customer }, data: { plan: "free" } });
      break;
  }
}
