import { deleteEntry, editEntry, EntryError } from "@/lib/coach/logs";
import { json, requireUser } from "@/lib/http";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req, { mutating: true });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const changes = await req.json().catch(() => null);
  try {
    await editEntry(auth.user.id, auth.user.timezone, id, changes);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof EntryError) return json({ error: e.message }, 400);
    throw e;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req, { mutating: true });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  try {
    await deleteEntry(auth.user.id, id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof EntryError) return json({ error: e.message }, 404);
    throw e;
  }
}
