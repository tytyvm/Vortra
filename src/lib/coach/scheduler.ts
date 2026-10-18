import { config } from "../config";
import { runRecaps } from "./recaps";

let started = false;
export async function startRecapScheduler() {
  const c = config().recaps;
  if (started || !c.enabled || c.scheduler !== "internal") return;
  started = true;
  const tick = () => runRecaps().catch(() => {});
  setInterval(tick, 15 * 60_000).unref?.();
}
