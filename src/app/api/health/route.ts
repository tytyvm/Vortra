// Lightweight health check for hosting platforms (no database access).
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ ok: true });
}
