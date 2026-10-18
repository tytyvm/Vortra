import { NextResponse } from "next/server";
import { currentUser } from "./auth";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** CSRF defense in depth: mutating requests must come from our own origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers / non-browser clients
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function requireUser(req: Request, { mutating = false } = {}) {
  if (mutating && !sameOrigin(req)) return { error: json({ error: "bad origin" }, 403) } as const;
  const user = await currentUser();
  if (!user) return { error: json({ error: "not signed in" }, 401) } as const;
  return { user } as const;
}
