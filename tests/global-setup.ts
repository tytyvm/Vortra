// Creates a fresh SQLite test database before the suite runs. Fully offline.
import { execSync } from "node:child_process";

export default function setup() {
  const env = { ...process.env, DATABASE_URL: "file:./prisma/test.db" };
  if (process.env.TEST_SKIP_DB_PUSH) return; // DB prepared by other means
  execSync("npx prisma db push --force-reset", { stdio: "pipe", env });
}
