#!/usr/bin/env node
// One command to run Vortra locally in mock mode (no API keys, no network calls to AI providers):
//   npm run mock
// Uses SQLite at prisma/dev.db, the mock AI provider, and prints sign-in links to this terminal.
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";

try {
  process.loadEnvFile(); // honor .env if present
} catch {
  /* no .env */
}

const env = {
  ...process.env,
  LLM_PROVIDER: "mock",
  LLM_RECAP_PROVIDER: "",
  LLM_PHOTO_PROVIDER: "",
  EMAIL_PROVIDER: "console",
  STRIPE_ENABLED: "false",
  DATABASE_URL: process.env.DATABASE_URL?.startsWith("file:") ? process.env.DATABASE_URL : "file:./prisma/dev.db",
  APP_URL: process.env.APP_URL || "http://localhost:3000",
};

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args) => {
  const r = spawnSync(npx, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!fs.existsSync("node_modules")) {
  console.error("Run `npm install` first.");
  process.exit(1);
}
console.log("\n> Preparing the database (prisma generate + db push)...\n");
run(["prisma", "generate"]);
run(["prisma", "db", "push"]);
console.log("\n> Starting Vortra in mock mode at " + env.APP_URL + "\n  Sign in with any email; the sign-in link appears on the page and in this terminal.\n");
const child = spawn(npx, ["next", "dev"], { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
