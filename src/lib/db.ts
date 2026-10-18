import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Prisma 7 uses driver adapters (no native query engine). SQLite for local dev,
// Postgres when DATABASE_URL starts with postgres:// (the schema provider must match; see README).
function createClient() {
  const url = process.env.DATABASE_URL || "file:./prisma/dev.db";
  const adapter = /^postgres(ql)?:\/\//.test(url) ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url });
  // Query logging stays off on purpose: queries can contain health data.
  return new PrismaClient({ adapter, log: [] });
}

const g = globalThis as unknown as { __prisma?: PrismaClient };

function client(): PrismaClient {
  g.__prisma ??= createClient();
  return g.__prisma;
}

// Created on first use, not at import time, so `next build` works without DATABASE_URL
// (hosts like Railway often only provide it at runtime).
export const prisma = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = client();
    const v = Reflect.get(c, prop, c);
    return typeof v === "function" ? v.bind(c) : v;
  },
});
