import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./prisma/test.db",
      LLM_PROVIDER: "mock",
      NODE_ENV: "test",
    },
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
  },
});
