// Prisma CLI config (Prisma 7). The app itself connects through a driver adapter in src/lib/db.ts.
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(); // load .env if present (Node 20.12+); real env vars take precedence
} catch {
  /* no .env file */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL || "file:./prisma/dev.db" },
});
