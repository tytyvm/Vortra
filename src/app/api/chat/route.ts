import { z } from "zod";
import { runCoachTurn, type CoachEvent } from "@/lib/coach/agent";
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";
import { isValidTimeZone } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  text: z.string().max(20000).default(""),
  image: z
    .object({
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      data: z.string().regex(/^[A-Za-z0-9+/=]+$/),
    })
    .optional(),
  timezone: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const auth = await requireUser(req, { mutating: true });
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const c = config();

  if (!rateLimit(`chat:${user.id}`, c.limits.chatPerMinute)) {
    return json({ error: "You're sending messages quickly. Give it a few seconds and try again." }, 429);
  }
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > c.limits.maxImageBytes * 1.4 + c.limits.maxMessageChars * 4 + 10_000) return json({ error: "Message too large." }, 413);

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid message." }, 400);
  const { text, image, timezone } = parsed.data;
  if (!text.trim() && !image) return json({ error: "Empty message." }, 400);
  if (text.length > c.limits.maxMessageChars) return json({ error: `Messages are limited to ${c.limits.maxMessageChars} characters.` }, 400);
  if (image && (image.data.length * 3) / 4 > c.limits.maxImageBytes) return json({ error: "Photo too large." }, 413);

  if (timezone && timezone !== user.timezone && isValidTimeZone(timezone)) {
    await prisma.user.update({ where: { id: user.id }, data: { timezone } });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: CoachEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        await runCoachTurn({ userId: user.id, text: text.trim(), image, onEvent: send, signal: req.signal });
      } catch {
        log.error("chat_failed", { userId: user.id });
        send({ type: "error", message: "Something went wrong. Please try again." });
        send({ type: "done" });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
