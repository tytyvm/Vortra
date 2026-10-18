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
export const prisma = g.__prisma ?? createClient();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;
