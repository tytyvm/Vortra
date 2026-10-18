import { requestLogin } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/http";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "bad origin" }, 403);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email : "";
  if (!rateLimit(`login-ip:${ip}`, 10, 15 * 60_000) || !rateLimit(`login:${email.toLowerCase()}`, 3, 15 * 60_000)) {
    return json({ error: "Too many requests. Try again in a few minutes." }, 429);
  }
  try {
    const { devLink } = await requestLogin(email);
    return json({ ok: true, devLink });
  } catch (e) {
    if (e instanceof Error && e.message === "invalid email") return json({ error: "Please enter a valid email." }, 400);
    log.error("login_request_failed");
    return json({ error: "Couldn't send the sign-in link. Try again." }, 500);
  }
}
