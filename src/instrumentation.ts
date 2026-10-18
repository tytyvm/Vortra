// Optional in-process recap scheduler (RECAPS_ENABLED=true and RECAPS_SCHEDULER=internal).
// This is the only background loop in the app. With RECAPS_SCHEDULER=external, call
// POST /api/cron/recaps hourly from your platform's cron instead.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRecapScheduler } = await import("./lib/coach/scheduler");
    await startRecapScheduler();
  }
}
