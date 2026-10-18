import { NextResponse } from "next/server";
import { sessionCookie, verifyLogin } from "@/lib/auth";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const base = config().appUrl;
  const result = token ? await verifyLogin(token) : null;
  if (!result) return NextResponse.redirect(new URL("/?login=expired", base));
  const res = NextResponse.redirect(new URL("/", base));
  res.cookies.set(sessionCookie(result.sessionToken));
  return res;
}
