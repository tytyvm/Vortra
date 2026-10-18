import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Older chat messages for scrollback: ?before=<messageId> */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const before = new URL(req.url).searchParams.get("before");
  const cursor = before ? await prisma.message.findFirst({ where: { id: before, userId: auth.user.id } }) : null;
  const rows = await prisma.message.findMany({
    where: { userId: auth.user.id, ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, role: true, content: true, hasImage: true, kind: true, createdAt: true },
  });
  return json({ messages: rows.reverse() });
}
