// Usage recording and spend ceilings.
import { config, estimateCostUsd } from "../config";
import { prisma } from "../db";
import type { Usage } from "../llm/types";

export async function recordUsage(args: {
  userId: string | null;
  kind: "chat" | "photo" | "recap";
  provider: string;
  model: string;
  usage: Usage;
}) {
  const costUsd = estimateCostUsd(args.model, args.usage.inputTokens, args.usage.outputTokens, args.usage.cachedInputTokens);
  await prisma.usage.create({
    data: {
      userId: args.userId,
      kind: args.kind,
      provider: args.provider,
      model: args.model,
      inputTokens: args.usage.inputTokens,
      outputTokens: args.usage.outputTokens,
      costUsd,
    },
  });
  return costUsd;
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function userMonthSpend(userId: string, now = new Date()) {
  const r = await prisma.usage.aggregate({ where: { userId, createdAt: { gte: monthStart(now) } }, _sum: { costUsd: true } });
  return r._sum.costUsd ?? 0;
}

export async function appDaySpend(now = new Date()) {
  const r = await prisma.usage.aggregate({ where: { createdAt: { gte: dayStart(now) } }, _sum: { costUsd: true } });
  return r._sum.costUsd ?? 0;
}

export function userMonthlyLimit(plan: string): number {
  const c = config();
  if (!c.billing.enabled) return c.limits.userMonthlyUsd;
  return (c.billing.plans[plan] ?? c.billing.plans.free).monthlyUsd;
}

export const SPEND_MESSAGES = {
  user: "You've reached this month's coaching limit, so I can't reply right now. Your logs are safe, and the limit resets on the 1st of next month.",
  userBilling: "You've reached this month's coaching limit on your plan. Your logs are safe. You can upgrade in Settings, or the limit resets on the 1st of next month.",
  app: "Vortra is taking a short break because today's usage limit was reached. Please try again tomorrow. Your logs are safe.",
};

/** Returns a friendly message when a ceiling is hit, or null when the call may proceed. */
export async function checkSpend(userId: string, plan: string, now = new Date()): Promise<string | null> {
  const c = config();
  if ((await appDaySpend(now)) >= c.limits.appDailyUsd) return SPEND_MESSAGES.app;
  if ((await userMonthSpend(userId, now)) >= userMonthlyLimit(plan)) {
    return c.billing.enabled && plan !== "pro" ? SPEND_MESSAGES.userBilling : SPEND_MESSAGES.user;
  }
  return null;
}
