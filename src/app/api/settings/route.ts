import { z } from "zod";
import { getProfile, currentPlan } from "@/lib/coach/profile";
import { userMonthlyLimit, userMonthSpend } from "@/lib/coach/spend";
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";
import { isValidTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const u = auth.user;
  const c = config();
  const [profile, plan, spent] = await Promise.all([getProfile(u.id), currentPlan(u.id), userMonthSpend(u.id)]);
  return json({
    email: u.email,
    timezone: u.timezone,
    recapDaily: u.recapDaily,
    recapWeekly: u.recapWeekly,
    recapsAvailable: c.recaps.enabled,
    billingEnabled: c.billing.enabled,
    plan: u.plan,
    hasCustomer: !!u.stripeCustomerId,
    usage: { spentUsd: Math.round(spent * 100) / 100, limitUsd: userMonthlyLimit(u.plan) },
    profile: profile.data,
    trainingPlan: plan?.text ?? null,
  });
}

const patch = z.object({
  timezone: z.string().max(64).refine(isValidTimeZone, "invalid time zone").optional(),
  recapDaily: z.boolean().optional(),
  recapWeekly: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireUser(req, { mutating: true });
  if ("error" in auth) return auth.error;
  const p = patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "invalid settings" }, 400);
  await prisma.user.update({ where: { id: auth.user.id }, data: p.data });
  return json({ ok: true });
}
