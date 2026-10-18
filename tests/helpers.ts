import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { setProviderOverride } from "@/lib/llm";

export async function resetDb() {
  setProviderOverride(null);
  await prisma.usage.deleteMany();
  await prisma.user.deleteMany();
  await prisma.loginToken.deleteMany();
}

let n = 0;
export async function makeUser(timezone = "America/New_York") {
  n++;
  return prisma.user.create({ data: { email: `user${n}-${Date.now()}@example.com`, timezone } });
}

export function fixture(name: string) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

/** A fetch stand-in that records requests and replies with a recorded SSE body. */
export function fakeFetch(bodies: string[], status = 200) {
  const requests: { url: string; init: RequestInit; body: any }[] = [];
  const f = async (url: string, init: RequestInit) => {
    requests.push({ url, init, body: JSON.parse(String(init.body)) });
    const text = bodies.shift() ?? "";
    // Split into small chunks to exercise the streaming parser.
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < text.length; i += 37) c.enqueue(enc.encode(text.slice(i, i + 37)));
        c.close();
      },
    });
    return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
  };
  return { fetch: f, requests };
}

// 2026-10-18 14:00 in New York (EDT, UTC-4)
export const NOW = new Date("2026-10-18T18:00:00Z");
