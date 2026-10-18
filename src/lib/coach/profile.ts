import { prisma } from "../db";
import type { ProfileFields } from "./schemas";
import { parseJSON, type Macros } from "./totals";

export type ProfileData = Record<string, unknown> & { targets?: Partial<Macros> };

export async function getProfile(userId: string): Promise<{ data: ProfileData; summary: string }> {
  const p = await prisma.profile.findUnique({ where: { userId } });
  return { data: parseJSON<ProfileData>(p?.data ?? "{}", {}), summary: p?.summary ?? "" };
}

/** Merge changed fields into the profile. null deletes a field; targets merge key by key. */
export function mergeProfile(current: ProfileData, fields: ProfileFields): ProfileData {
  const next: ProfileData = { ...current };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (v === null) {
      delete next[k];
    } else if (k === "targets" && typeof v === "object") {
      next.targets = { ...(current.targets ?? {}), ...(v as Partial<Macros>) };
    } else {
      next[k] = v;
    }
  }
  return next;
}

export async function saveProfile(userId: string, data: ProfileData) {
  const json = JSON.stringify(data);
  await prisma.profile.upsert({ where: { userId }, create: { userId, data: json }, update: { data: json } });
}

export async function saveSummary(userId: string, summary: string) {
  await prisma.profile.upsert({ where: { userId }, create: { userId, summary }, update: { summary } });
}

export async function currentPlan(userId: string) {
  return prisma.plan.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
}
