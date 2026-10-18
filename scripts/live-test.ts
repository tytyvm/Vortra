// Manual live test: sends ~10 scripted messages to the REAL configured model and prints
// token usage and estimated cost. This spends real money (usually a few cents).
//
//   npm run live-test -- --confirm
//
// Never runs in tests or CI. Uses a temporary user that is deleted at the end.
try {
  process.loadEnvFile();
} catch {
  /* no .env */
}

const SCRIPT = [
  "Hi! I'm 34, male, 5 ft 10 in, 185 lb. I lift 4x a week at a full gym, intermediate. I want to lose fat but keep muscle. Lightly active job.",
  "No injuries. I don't eat pork. Can you set my targets?",
  "Breakfast: 3 eggs scrambled with a slice of cheddar, 2 slices sourdough toast, black coffee",
  "Lunch was a Chipotle chicken burrito bowl with white rice, black beans, fajita veggies, salsa and cheese",
  "Actually it was brown rice, not white",
  "Weighed in at 184.2 lb this morning",
  "Starting push day. Bench 185x8, 185x7, 185x6",
  "Incline DB press 60s x 10, 10, 9. Then dips bodyweight x 12, 10",
  "Done for today. How much protein do I have left?",
  "Can you make me a 4-day upper/lower plan?",
];

async function main() {
  const args = process.argv.slice(2);
  if (process.env.CI || process.env.VITEST || process.env.NODE_ENV === "test") {
    console.error("Refusing to run in CI or tests.");
    process.exit(1);
  }
  if (!args.includes("--confirm")) {
    console.error(
      "This sends ~10 messages to your configured real model and costs real money.\n" +
        "Re-run with:  npm run live-test -- --confirm",
    );
    process.exit(1);
  }

  const { config } = await import("../src/lib/config");
  const c = config();
  if (c.llm.main.provider === "mock") console.warn("LLM_PROVIDER is mock: no real model will be called.\n");
  console.log(`Provider: ${c.llm.main.provider}   Model: ${c.llm.main.model}\n`);

  const { prisma } = await import("../src/lib/db");
  const { runCoachTurn } = await import("../src/lib/coach/agent");
  const user = await prisma.user.create({
    data: { email: `live-test-${Date.now()}@example.invalid`, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });

  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;
  try {
    for (const [i, text] of SCRIPT.entries()) {
      console.log(`\n[${i + 1}/${SCRIPT.length}] You: ${text}`);
      process.stdout.write("Vortra: ");
      const since = new Date();
      await runCoachTurn({
        userId: user.id,
        text,
        onEvent: (e) => {
          if (e.type === "text") process.stdout.write(e.delta);
          if (e.type === "tool") process.stdout.write(`\n  [tool ${e.name}${e.ok ? "" : " FAILED"}]\n`);
          if (e.type === "notice" || e.type === "error") process.stdout.write(`\n  [${e.type}] ${"text" in e ? e.text : e.message}\n`);
        },
      });
      const rows = await prisma.usage.findMany({ where: { userId: user.id, createdAt: { gte: since } } });
      const inT = rows.reduce((n, r) => n + r.inputTokens, 0);
      const outT = rows.reduce((n, r) => n + r.outputTokens, 0);
      const cost = rows.reduce((n, r) => n + r.costUsd, 0);
      totalIn += inT;
      totalOut += outT;
      totalCost += cost;
      console.log(`\n  -- ${rows.length} call(s), ${inT} in / ${outT} out tokens, ~$${cost.toFixed(5)}`);
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
  console.log(`\nTOTAL: ${totalIn} input + ${totalOut} output tokens, estimated $${totalCost.toFixed(4)} (from config/prices.json)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Live test failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
