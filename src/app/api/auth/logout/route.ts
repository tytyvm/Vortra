import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE, sessionCookie } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "bad origin" }, 403);
  const jar = await cookies();
  await destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.set(sessionCookie("", 0));
  return json({ ok: true });
}
