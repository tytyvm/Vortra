import { cookies } from "next/headers";
import { sessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";
import { log } from "@/lib/log";

/** Permanently deletes the account and all its data. Body: {"confirm": "DELETE"} */
export async function POST(req: Request) {
  const auth = await requireUser(req, { mutating: true });
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== "DELETE") return json({ error: 'Type DELETE to confirm.' }, 400);
  await prisma.user.delete({ where: { id: auth.user.id } }); // cascades to all user data
  (await cookies()).set(sessionCookie("", 0));
  log.info("account_deleted");
  return json({ ok: true });
}
