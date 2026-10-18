// Email magic-link login and HTTP-only cookie sessions.
import { cookies } from "next/headers";
import { config } from "./config";
import { prisma } from "./db";
import { sendEmail } from "./email";
import { randomToken, sha256 } from "./ids";

export const SESSION_COOKIE = "vortra_session";
const SESSION_DAYS = 30;
const LINK_MINUTES = 15;

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export async function requestLogin(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new Error("invalid email");
  const token = randomToken();
  await prisma.loginToken.create({
    data: { tokenHash: sha256(token), email, expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) },
  });
  const c = config();
  const link = `${c.appUrl.replace(/\/$/, "")}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: email,
    subject: "Your Vortra sign-in link",
    text: `Tap to sign in to Vortra:\n\n${link}\n\nThis link expires in ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
  });
  // Convenience for local mock mode only: show the link in the UI.
  return { devLink: c.email.provider === "console" && !c.isProd ? link : undefined };
}

/** Consume a login token. Returns a new session token, or null if invalid/expired/used. */
export async function verifyLogin(token: string): Promise<{ sessionToken: string; userId: string } | null> {
  const row = await prisma.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  const claimed = await prisma.loginToken.updateMany({ where: { tokenHash: row.tokenHash, usedAt: null }, data: { usedAt: new Date() } });
  if (!claimed.count) return null;
  const user = await prisma.user.upsert({ where: { email: row.email }, create: { email: row.email }, update: {} });
  const sessionToken = randomToken();
  await prisma.session.create({
    data: { id: sha256(sessionToken), userId: user.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) },
  });
  await prisma.loginToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { sessionToken, userId: user.id };
}

export function sessionCookie(value: string, maxAgeSeconds = SESSION_DAYS * 86400) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config().isProd,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function userFromSessionToken(token: string | undefined) {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
}

export async function currentUser() {
  const jar = await cookies();
  return userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export async function destroySession(token: string | undefined) {
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
}
