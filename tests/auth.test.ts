import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestLogin, userFromSessionToken, verifyLogin } from "@/lib/auth";
import { verifyStripeSignature } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import crypto from "node:crypto";
import { resetDb } from "./helpers";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

describe("magic link sessions", () => {
  beforeEach(resetDb);

  it("issues single-use links that create a user and a session", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { devLink } = await requestLogin("  Someone@Example.com ");
    log.mockRestore();
    const token = new URL(devLink!).searchParams.get("token")!;
    const s = await verifyLogin(token);
    expect(s).not.toBeNull();
    expect((await userFromSessionToken(s!.sessionToken))?.email).toBe("someone@example.com");
    expect(await verifyLogin(token)).toBeNull(); // single use
    expect(await userFromSessionToken("not-a-token")).toBeNull();
    // tokens and sessions are stored hashed
    expect(await prisma.loginToken.findFirst({ where: { tokenHash: token } })).toBeNull();
    expect(await prisma.session.findFirst({ where: { id: s!.sessionToken } })).toBeNull();
  });

  it("rejects invalid emails", async () => {
    await expect(requestLogin("nope")).rejects.toThrow("invalid email");
  });

  it("account deletion removes all user data", async () => {
    const u = await prisma.user.create({ data: { email: "del@example.com" } });
    await prisma.message.create({ data: { userId: u.id, role: "user", content: "x" } });
    await prisma.weightLog.create({ data: { id: "w_del", userId: u.id, day: "2026-10-18", loggedAt: new Date(), weight: 1, unit: "lb", weightKg: 0.45 } });
    await prisma.usage.create({ data: { userId: u.id, kind: "chat", provider: "x", model: "x", inputTokens: 1, outputTokens: 1, costUsd: 0.01 } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.message.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.weightLog.count({ where: { id: "w_del" } })).toBe(0);
    const usage = await prisma.usage.findFirstOrThrow({ where: { costUsd: 0.01 } });
    expect(usage.userId).toBeNull(); // kept anonymized for app-wide spend accounting
  });
});

describe("misc security", () => {
  it("rate limits per key", () => {
    const k = `t-${Math.random()}`;
    expect([1, 2, 3].map(() => rateLimit(k, 2, 60_000, 1000))).toEqual([true, true, false]);
    expect(rateLimit(k, 2, 60_000, 70_000)).toBe(true);
  });

  it("verifies Stripe webhook signatures", () => {
    const payload = '{"type":"x"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", "whsec").update(`${t}.${payload}`).digest("hex");
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, "whsec")).toBe(true);
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, "other")).toBe(false);
    expect(verifyStripeSignature(payload, `t=${t - 1000},v1=${sig}`, "whsec")).toBe(false);
  });
});
